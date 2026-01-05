// Edge Function: ef_deposit_scan
// Purpose: Milestone 5 - Hourly scan for customer deposits on VALR subaccounts
// Flow: Queries VALR balances → Activates customers when balance > 0 → Sends notification emails
// Deployed with: --no-verify-jwt (called by pg_cron hourly)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");
const valrApiKey = Deno.env.get("VALR_API_KEY");
const valrApiSecret = Deno.env.get("VALR_API_SECRET");

if (!supabaseUrl || !supabaseKey || !orgId || !valrApiKey || !valrApiSecret) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// VALR API: Sign request with HMAC SHA-512
async function signVALR(timestamp: string, method: string, path: string, body: string = "", subaccountId: string = "") {
  const message = timestamp + method.toUpperCase() + path + body + subaccountId;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(valrApiSecret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Query VALR subaccount balances
async function getSubaccountBalances(subaccountId: string) {
  const timestamp = Date.now().toString();
  const method = "GET";
  const path = "/v1/account/balances";
  const signature = await signVALR(timestamp, method, path, "", subaccountId);

  const response = await fetch(`https://api.valr.com${path}`, {
    method: "GET",
    headers: {
      "X-VALR-API-KEY": valrApiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId,
    },
  });

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

    // Get exchange accounts for these customers via customer_portfolios
    const customerIds = customers.map(c => c.customer_id);
    const { data: portfolios, error: portfolioError } = await supabase
      .from("customer_portfolios")
      .select("customer_id, portfolio_id, exchange_account_id")
      .in("customer_id", customerIds)
      .not("exchange_account_id", "is", null);

    if (portfolioError) {
      console.error("Error loading customer portfolios:", portfolioError);
      throw portfolioError;
    }

    // Get the actual exchange accounts with subaccount IDs
    const exchangeAccountIds = (portfolios || []).map(p => p.exchange_account_id);
    const { data: accounts, error: accountError } = await supabase
      .from("exchange_accounts")
      .select("exchange_account_id, subaccount_id, label")
      .eq("exchange", "VALR")
      .in("exchange_account_id", exchangeAccountIds)
      .not("subaccount_id", "is", null);

    if (accountError) {
      console.error("Error loading exchange accounts:", accountError);
      throw accountError;
    }

    console.log(`Found ${accounts?.length || 0} VALR accounts to check`);

    // Check balances for each subaccount
    for (const account of accounts || []) {
      results.scanned++;

      // Find the portfolio and customer for this exchange account
      const portfolio = portfolios?.find(p => p.exchange_account_id === account.exchange_account_id);
      if (!portfolio) continue;

      const customer = customers.find(c => c.customer_id === portfolio.customer_id);
      if (!customer) continue;

      try {
        console.log(`Checking balances for customer ${customer.customer_id} (${account.subaccount_id})`);

        const balances = await getSubaccountBalances(account.subaccount_id);

        // Check if any balance > 0
        const hasBalance = balances.some((bal: any) => {
          const available = parseFloat(bal.available || "0");
          return available > 0;
        });

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

          // Update portfolio status to 'active'
          const { error: updatePortfolioError } = await supabase
            .from("customer_portfolios")
            .update({ status: "active" })
            .eq("customer_id", customer.customer_id);

          if (updatePortfolioError) {
            console.error(`Error updating portfolio for ${customer.customer_id}:`, updatePortfolioError);
          }

          // CRITICAL: Create lth_pvr.customer_strategies row for trading pipeline inclusion
          // Get portfolio details (strategy_version_id, exchange_account_id)
          const { data: portfolioData, error: portfolioDataError } = await supabase
            .from("customer_portfolios")
            .select("portfolio_id, strategy_code")
            .eq("customer_id", customer.customer_id)
            .single();

          if (portfolioDataError) {
            console.error(`Error fetching portfolio data for ${customer.customer_id}:`, portfolioDataError);
          } else {
            // Get strategy_version_id from lth_pvr.strategy_versions
            const { data: strategyVersion, error: strategyVersionError } = await supabase
              .schema("lth_pvr")
              .from("strategy_versions")
              .select("strategy_version_id")
              .eq("strategy_code", portfolioData.strategy_code)
              .eq("is_latest", true)
              .single();

            if (strategyVersionError) {
              console.error(`Error fetching strategy version for ${customer.customer_id}:`, strategyVersionError);
            } else {
              // Create customer_strategies row
              const { error: customerStrategyError } = await supabase
                .schema("lth_pvr")
                .from("customer_strategies")
                .insert({
                  org_id: customer.org_id,
                  customer_id: customer.customer_id,
                  strategy_version_id: strategyVersion.strategy_version_id,
                  exchange_account_id: portfolio.exchange_account_id,
                  live_enabled: true,
                  effective_from: new Date().toISOString().split('T')[0], // Today's date (YYYY-MM-DD)
                  portfolio_id: portfolioData.portfolio_id,
                });

              if (customerStrategyError) {
                console.error(`Error creating customer_strategies for ${customer.customer_id}:`, customerStrategyError);
              } else {
                console.log(`✓ Created customer_strategies row for customer ${customer.customer_id}`);
              }
            }
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

          // Send admin notification emails (to both admin addresses)
          const adminEmails = ["admin@bitwealth.co.za", "davin.gaier@gmail.com"];
          for (const adminEmail of adminEmails) {
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
          }

          // Send customer welcome email
          try {
            const websiteUrl = Deno.env.get("WEBSITE_URL") || supabaseUrl;
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
                  portal_url: `${websiteUrl}/website/portal.html`,
                  website_url: websiteUrl,
                },
              }),
            });
          } catch (emailError) {
            console.error("Error sending customer email:", emailError);
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
        console.error(`VALR error details:`, {
          subaccount_id: account.subaccount_id,
          error_message: balanceError instanceof Error ? balanceError.message : String(balanceError)
        });
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
