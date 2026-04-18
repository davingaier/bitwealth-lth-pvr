// Edge Function: ef_deposit_scan
// Purpose: Milestone 5 - Hourly scan for customer deposits on VALR
// Supports both subaccount and API model customers.
// Flow: Queries VALR balances → Activates customers when balance > 0 → Sends notification emails
// For API model: also detects ZAR deposits and writes to pending_zar_conversions.
// Deployed with: --no-verify-jwt (called by pg_cron hourly)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import { signVALR } from "../_shared/valr.ts";
import { logAlert } from "../_shared/alerting.ts";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");

if (!supabaseUrl || !supabaseKey || !orgId) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const sbLthPvr = createClient(supabaseUrl, supabaseKey, { db: { schema: "lth_pvr" } });

// Query VALR balances using resolved credentials (supports both models)
async function getBalances(
  apiKey: string,
  apiSecret: string,
  subaccountId: string | null,
): Promise<any[]> {
  const timestamp = Date.now().toString();
  const method = "GET";
  const path = "/v1/account/balances";
  const signature = await signVALR(timestamp, method, path, "", apiSecret, subaccountId ?? "");

  const headers: Record<string, string> = {
    "X-VALR-API-KEY": apiKey,
    "X-VALR-SIGNATURE": signature,
    "X-VALR-TIMESTAMP": timestamp,
  };
  if (subaccountId) {
    headers["X-VALR-SUB-ACCOUNT-ID"] = subaccountId;
  }

  const response = await fetch(`https://api.valr.com${path}`, { method: "GET", headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VALR API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  // CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const results = {
    scanned: 0,
    activated: 0,
    errors: 0,
    activated_customers: [] as any[],
  };

  try {
    console.log("Starting deposit scan...");

    // Get all customers with status='deposit'
    const { data: customers, error: customerError } = await supabase
      .from("customer_details")
      .select("customer_id, first_names, last_name, email, org_id")
      .eq("registration_status", "deposit");

    if (customerError) throw customerError;

    if (!customers || customers.length === 0) {
      console.log("No customers in 'deposit' status");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No customers awaiting deposits",
          ...results 
        }),
        { 
          status: 200, 
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } 
        }
      );
    }

    console.log(`Found ${customers.length} customers in deposit status`);

    // Get exchange accounts for these customers via customer_strategies (consolidated table)
    const customerIds = customers.map(c => c.customer_id);
    const { data: strategies, error: strategyError } = await supabase
      .schema("public")
      .from("customer_strategies")
      .select("customer_id, customer_strategy_id, exchange_account_id")
      .in("customer_id", customerIds)
      .not("exchange_account_id", "is", null);

    if (strategyError) {
      console.error("Error loading customer strategies:", strategyError);
      throw strategyError;
    }

    // Get the actual exchange accounts (both subaccount and API model)
    const exchangeAccountIds = (strategies || []).map(s => s.exchange_account_id);
    const { data: accounts, error: accountError } = await supabase
      .from("exchange_accounts")
      .select("exchange_account_id, subaccount_id, label")
      .eq("exchange", "VALR")
      .in("exchange_account_id", exchangeAccountIds);

    if (accountError) {
      console.error("Error loading exchange accounts:", accountError);
      throw accountError;
    }

    console.log(`Found ${accounts?.length || 0} VALR accounts to check`);

    // Check balances for each customer account (both subaccount and API model)
    for (const account of accounts || []) {
      results.scanned++;

      // Find the strategy and customer for this exchange account
      const strategy = strategies?.find(s => s.exchange_account_id === account.exchange_account_id);
      if (!strategy) continue;

      const customer = customers.find(c => c.customer_id === strategy.customer_id);
      if (!customer) continue;

      try {
        // Resolve credentials via vault (API model) or env (subaccount model)
        const creds = await resolveCustomerCredentials(sbLthPvr, customer.customer_id);
        const modelLabel = creds.accountModel === "api" ? "API-model" : `subaccount ${creds.subaccountId}`;
        console.log(`Checking balances for customer ${customer.customer_id} (${modelLabel})`);

        const balances = await getBalances(creds.apiKey, creds.apiSecret, creds.subaccountId);

        // Check for tradeable balances (BTC or USDT > 0)
        const tradeableBalances = balances.filter((bal: any) => {
          const available = parseFloat(bal.available || "0");
          return available > 0 && ["BTC", "USDT"].includes(bal.currency);
        });

        // For API model: also check for ZAR deposits that need conversion
        const zarBalance = balances.find((bal: any) => {
          const available = parseFloat(bal.available || "0");
          return available > 0 && bal.currency === "ZAR";
        });
        if (zarBalance && creds.accountModel === "api") {
          const zarAmount = parseFloat(zarBalance.available);
          console.log(`ZAR balance detected for API-model customer ${customer.customer_id}: R${zarAmount.toFixed(2)}`);
          // Create a zar_deposit funding event — the DB trigger auto-creates pending_zar_conversions
          try {
            const zarIdempotencyKey = `ZAR_DEPOSIT_SCAN:${customer.customer_id}:${new Date().toISOString().split('T')[0]}`;
            const { error: zarFundingError } = await sbLthPvr
              .from("exchange_funding_events")
              .insert({
                org_id: customer.org_id,
                customer_id: customer.customer_id,
                exchange_account_id: account.exchange_account_id,
                kind: "zar_deposit",
                asset: "ZAR",
                amount: zarAmount,
                ext_ref: `zar_deposit_scan_${customer.customer_id}`,
                occurred_at: new Date().toISOString(),
                idempotency_key: zarIdempotencyKey,
              });
            if (zarFundingError && !zarFundingError.message.includes("duplicate key")) {
              console.error(`Error creating ZAR funding event for customer ${customer.customer_id}:`, zarFundingError);
            } else {
              console.log(`✓ Created ZAR funding event: R${zarAmount.toFixed(2)} (trigger will create pending conversion)`);
            }
          } catch (zarWriteError) {
            console.error(`Exception writing ZAR funding event for ${customer.customer_id}:`, zarWriteError);
          }
        }

        // Also count ZAR as a balance for activation purposes (customer deposited something)
        const hasBalance = tradeableBalances.length > 0 || (zarBalance && parseFloat(zarBalance.available) > 0);

        if (hasBalance) {
          console.log(`✓ Balance detected for customer ${customer.customer_id}`);

          // Update customer status to 'active'
          const { error: updateCustomerError } = await supabase
            .from("customer_details")
            .update({ registration_status: "active" })
            .eq("customer_id", customer.customer_id);

          if (updateCustomerError) {
            console.error(`Error updating customer ${customer.customer_id}:`, updateCustomerError);
            results.errors++;
            continue;
          }

          // Update customer_strategies status to 'active' and enable trading (consolidated table)
          const { error: updateStrategyError } = await supabase
            .schema("public")
            .from("customer_strategies")
            .update({ 
              status: "active",
              live_enabled: true,
              effective_from: new Date().toISOString().split('T')[0] // Today's date (YYYY-MM-DD)
            })
            .eq("customer_id", customer.customer_id);

          if (updateStrategyError) {
            console.error(`Error updating customer_strategies for ${customer.customer_id}:`, updateStrategyError);
          } else {
            console.log(`✓ Updated customer_strategies: status=active, live_enabled=true for customer ${customer.customer_id}`);
          }

          // Set trade_start_date (date first strategy becomes active)
          const { error: tradeStartDateError } = await supabase
            .from("customer_details")
            .update({ trade_start_date: new Date().toISOString().split('T')[0] })
            .eq("customer_id", customer.customer_id)
            .is("trade_start_date", null); // Only set if not already set

          if (tradeStartDateError) {
            console.error(`Error setting trade_start_date for ${customer.customer_id}:`, tradeStartDateError);
          } else {
            console.log(`✓ Set trade_start_date for customer ${customer.customer_id}`);
          }

          // Send admin notification email
          const adminEmail = Deno.env.get("ADMIN_EMAIL") || "admin@bitwealth.co.za";
          try {
            await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": req.headers.get("authorization") || "",
              },
              body: JSON.stringify({
                template_key: "funds_deposited_admin_notification",
                to_email: adminEmail,
                data: {
                  first_name: customer.first_names,
                  last_name: customer.last_name,
                  customer_id: customer.customer_id,
                  email: customer.email,
                  balances: balances
                    .filter((b: any) => parseFloat(b.available || "0") > 0)
                    .map((b: any) => `${b.currency}: ${b.available}`)
                    .join(", "),
                },
              }),
            });
          } catch (emailError) {
            console.error(`Error sending admin email to ${adminEmail}:`, emailError);
          }

          // Send customer welcome email with deposit confirmation
          try {
            const websiteUrl = Deno.env.get("WEBSITE_URL") || supabaseUrl;
            
            // Find the primary deposit asset and amount (largest balance)
            const primaryBalance = balances
              .filter((b: any) => parseFloat(b.available || "0") > 0)
              .sort((a: any, b: any) => parseFloat(b.available) - parseFloat(a.available))[0];
            
            const depositAsset = primaryBalance?.currency || "USDT";
            const depositAmount = primaryBalance?.available || "0";
            const depositDate = new Date().toLocaleDateString("en-ZA", { 
              year: "numeric", 
              month: "long", 
              day: "numeric" 
            });
            
            await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": req.headers.get("authorization") || "",
              },
              body: JSON.stringify({
                template_key: "registration_complete_welcome",
                to_email: customer.email,
                data: {
                  first_name: customer.first_names,
                  amount: depositAmount,
                  asset: depositAsset,
                  deposit_date: depositDate,
                  portal_url: `${websiteUrl}/customer-portal.html`,
                  website_url: websiteUrl,
                },
              }),
            });
          } catch (emailError) {
            console.error("Error sending customer email:", emailError);
          }

          // SELF-CONTAINED ACCOUNTING: Create funding events + ledger entries immediately
          // This ensures customer has complete accounting records at activation time
          console.log(`Creating funding events for customer ${customer.customer_id}...`);
          
          // Create exchange_funding_event for each non-zero balance
          for (const bal of balances) {
            const available = parseFloat(bal.available || "0");
            if (available <= 0) continue;

            const asset = bal.currency;
            if (!["BTC", "USDT"].includes(asset)) continue;

            // Create funding event with idempotency
            const idempotencyKey = `ACTIVATION:${customer.customer_id}:${asset}:${new Date().toISOString()}`;
            
            try {
              const { error: fundingError } = await supabase.schema("lth_pvr")
                .from("exchange_funding_events")
                .insert({
                  org_id: customer.org_id,
                  customer_id: customer.customer_id,
                  exchange_account_id: account.exchange_account_id,
                  kind: "deposit",
                  asset: asset,
                  amount: available,
                  ext_ref: `initial_deposit_${customer.customer_id}_${asset}`,
                  occurred_at: new Date().toISOString(),
                  idempotency_key: idempotencyKey,
                });

              if (fundingError) {
                // Ignore duplicate key errors (already processed)
                if (!fundingError.message.includes("duplicate key")) {
                  console.error(`Error creating funding event for ${customer.customer_id}:`, fundingError);
                }
              } else {
                console.log(`✓ Created funding event: ${asset} ${available}`);
              }
            } catch (fundingCreateError) {
              console.error(`Exception creating funding event for ${customer.customer_id}:`, fundingCreateError);
            }
          }

          // Call ef_post_ledger_and_balances to create ledger lines and balances_daily
          console.log(`Posting ledger and balances for customer ${customer.customer_id}...`);
          try {
            const ledgerResponse = await fetch(`${supabaseUrl}/functions/v1/ef_post_ledger_and_balances`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": req.headers.get("authorization") || "",
              },
              body: JSON.stringify({
                from_date: new Date().toISOString().split('T')[0],
                to_date: new Date().toISOString().split('T')[0],
              }),
            });

            if (ledgerResponse.ok) {
              const ledgerResult = await ledgerResponse.json();
              console.log(`✓ Ledger posted:`, ledgerResult);
            } else {
              console.error(`Error posting ledger for ${customer.customer_id}:`, await ledgerResponse.text());
            }
          } catch (ledgerError) {
            console.error(`Exception posting ledger for ${customer.customer_id}:`, ledgerError);
          }

          results.activated++;
          results.activated_customers.push({
            customer_id: customer.customer_id,
            name: `${customer.first_names} ${customer.last_name}`,
            email: customer.email,
          });
        } else {
          console.log(`No balance yet for customer ${customer.customer_id}`);
        }
      } catch (balanceError) {
        console.error(`Error checking balance for customer ${customer.customer_id}:`, balanceError);
        await logAlert(sbLthPvr, "ef_deposit_scan", "error",
          `Balance check failed for customer ${customer.customer_id}: ${balanceError instanceof Error ? balanceError.message : String(balanceError)}`,
          { customer_id: customer.customer_id, exchange_account_id: account.exchange_account_id },
          customer.org_id, customer.customer_id);
        results.errors++;
      }
    }

    console.log(`Deposit scan complete: ${results.activated} activated, ${results.errors} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Scanned ${results.scanned} accounts, activated ${results.activated} customers`,
        ...results,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Error in ef_deposit_scan:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        ...results 
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
