// Edge Function: ef_balance_reconciliation
// Purpose: Automated balance reconciliation - detects manual transfers/deposits/withdrawals
// Flow: Query VALR API balances → Compare with balances_daily → Create funding events for discrepancies
// Schedule: Hourly via pg_cron (non-trading hours) or daily after trading window
// Deployed with: --no-verify-jwt (called by pg_cron)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");
const valrApiKey = Deno.env.get("VALR_API_KEY");
const valrApiSecret = Deno.env.get("VALR_API_SECRET");

if (!supabaseUrl || !supabaseKey || !orgId || !valrApiKey || !valrApiSecret) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "lth_pvr" }
});

// VALR API: Sign request with HMAC SHA-512
async function signVALR(
  timestamp: string,
  method: string,
  path: string,
  body: string = "",
  subaccountId: string = ""
): Promise<string> {
  const payload = timestamp + method.toUpperCase() + path + body + subaccountId;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(valrApiSecret);
  const messageData = encoder.encode(payload);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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
    reconciled: 0,
    discrepancies: 0,
    errors: 0,
    details: [] as any[],
  };

  try {
    console.log("Starting balance reconciliation...");
    console.log("Org ID:", orgId);

    // Get all active customers with exchange accounts
    const { data: customers, error: customerError } = await supabase.schema("public")
      .from("customer_details")
      .select("customer_id, first_names, last_name, email")
      .eq("org_id", orgId)
      .eq("registration_status", "active");

    if (customerError) {
      console.error("Error loading customers:", customerError);
      throw new Error(`Customer query failed: ${customerError.message || JSON.stringify(customerError)}`);
    }
    
    console.log(`Found ${customers?.length || 0} active customers`);

    if (!customers || customers.length === 0) {
      console.log("No active customers found");
      return new Response(
        JSON.stringify({ message: "No active customers to reconcile", results }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    const customerIds = customers.map(c => c.customer_id);
    console.log(`Found ${customerIds.length} active customers`);

    // Get customer strategies and exchange accounts (consolidated table)
    const { data: strategies, error: strategyError } = await supabase.schema("public")
      .from("customer_strategies")
      .select("customer_id, customer_strategy_id, exchange_account_id")
      .in("customer_id", customerIds)
      .not("exchange_account_id", "is", null);

    if (strategyError) {
      console.error("Error loading customer strategies:", strategyError);
      throw new Error(`Strategy query failed: ${strategyError.message || JSON.stringify(strategyError)}`);
    }

    const exchangeAccountIds = (strategies || []).map(s => s.exchange_account_id);
    const { data: accounts, error: accountError } = await supabase.schema("public")
      .from("exchange_accounts")
      .select("exchange_account_id, subaccount_id, label")
      .eq("exchange", "VALR")
      .in("exchange_account_id", exchangeAccountIds)
      .not("subaccount_id", "is", null);

    if (accountError) {
      console.error("Error loading exchange accounts:", accountError);
      throw new Error(`Account query failed: ${accountError.message || JSON.stringify(accountError)}`);
    }

    console.log(`Found ${accounts?.length || 0} VALR accounts to reconcile`);

    // Get today's date for balances lookup
    const today = new Date().toISOString().slice(0, 10);

    // Process each account
    for (const account of accounts || []) {
      try {
        results.scanned++;

        // Find customer for this account (from consolidated table)
        const strategy = strategies?.find(s => s.exchange_account_id === account.exchange_account_id);
        if (!strategy) continue;

        const customer = customers.find(c => c.customer_id === strategy.customer_id);
        if (!customer) continue;

        console.log(`Reconciling ${customer.first_names} ${customer.last_name} (${account.label})`);

        // Get VALR API balances
        const valrBalances = await getSubaccountBalances(account.subaccount_id);
        const btcBalance = valrBalances.find((b: any) => b.currency === "BTC");
        const usdtBalance = valrBalances.find((b: any) => b.currency === "USDT");

        const valrBTC = parseFloat(btcBalance?.available || "0");
        const valrUSDT = parseFloat(usdtBalance?.available || "0");

        console.log(`VALR API: BTC=${valrBTC}, USDT=${valrUSDT}`);

        // Get our recorded balances
        const { data: balanceRecord, error: balanceError } = await supabase
          .from("balances_daily")
          .select("btc_balance, usdt_balance, nav_usd, date")
          .eq("org_id", orgId)
          .eq("customer_id", customer.customer_id)
          .eq("date", today)
          .single();

        if (balanceError && balanceError.code !== "PGRST116") { // PGRST116 = no rows
          console.error(`Error loading balance record for customer ${customer.customer_id}:`, balanceError);
          results.errors++;
          continue;
        }

        const recordedBTC = balanceRecord ? parseFloat(balanceRecord.btc_balance) : 0;
        const recordedUSDT = balanceRecord ? parseFloat(balanceRecord.usdt_balance) : 0;

        console.log(`Recorded: BTC=${recordedBTC}, USDT=${recordedUSDT}`);

        // Get accumulated platform fees that are sitting on the subaccount
        // These fees haven't reached the transfer threshold yet
        const { data: accumFees } = await supabase.schema("lth_pvr")
          .from("customer_accumulated_fees")
          .select("accumulated_btc, accumulated_usdt")
          .eq("customer_id", customer.customer_id)
          .single();

        const pendingFeeBTC = parseFloat(accumFees?.accumulated_btc || "0");
        const pendingFeeUSDT = parseFloat(accumFees?.accumulated_usdt || "0");

        console.log(`Accumulated fees: BTC=${pendingFeeBTC}, USDT=${pendingFeeUSDT}`);

        // Expected VALR balance = customer ledger balance + accumulated fees (on subaccount)
        const expectedVALR_BTC = recordedBTC + pendingFeeBTC;
        const expectedVALR_USDT = recordedUSDT + pendingFeeUSDT;

        // Check for discrepancies (allow 0.00000001 BTC and 0.01 USDT tolerance for rounding)
        const btcDiff = Math.abs(valrBTC - expectedVALR_BTC);
        const usdtDiff = Math.abs(valrUSDT - expectedVALR_USDT);

        const hasBTCDiscrepancy = btcDiff > 0.00000001;
        const hasUSDTDiscrepancy = usdtDiff > 0.01;

        if (hasBTCDiscrepancy || hasUSDTDiscrepancy) {
          results.discrepancies++;
          console.log(`⚠️ DISCREPANCY DETECTED for customer ${customer.customer_id}`);

          const detail = {
            customer_id: customer.customer_id,
            customer_name: `${customer.first_names} ${customer.last_name}`,
            btc_valr: valrBTC,
            btc_recorded: recordedBTC,
            btc_expected: expectedVALR_BTC,
            btc_diff: valrBTC - expectedVALR_BTC,
            usdt_valr: valrUSDT,
            usdt_recorded: recordedUSDT,
            usdt_expected: expectedVALR_USDT,
            usdt_diff: valrUSDT - expectedVALR_USDT,
            action: "funding_events_created"
          };
          results.details.push(detail);

          // Create funding events for discrepancies
          const fundingEvents = [];

          if (hasBTCDiscrepancy) {
            const btcChange = valrBTC - expectedVALR_BTC;
            fundingEvents.push({
              org_id: orgId,
              customer_id: customer.customer_id,
              exchange_account_id: account.exchange_account_id,
              kind: btcChange > 0 ? "deposit" : "withdrawal",
              asset: "BTC",
              amount: btcChange,  // Use signed value: positive for deposits, negative for withdrawals
              ext_ref: `AUTO_RECON_${today}_BTC`,
              occurred_at: new Date().toISOString(),
              idempotency_key: `RECON_${customer.customer_id}_${today}_BTC_${Date.now()}`
            });
          }

          if (hasUSDTDiscrepancy) {
            const usdtChange = valrUSDT - expectedVALR_USDT;
            fundingEvents.push({
              org_id: orgId,
              customer_id: customer.customer_id,
              exchange_account_id: account.exchange_account_id,
              kind: usdtChange > 0 ? "deposit" : "withdrawal",
              asset: "USDT",
              amount: usdtChange,  // Use signed value: positive for deposits, negative for withdrawals
              ext_ref: `AUTO_RECON_${today}_USDT`,
              occurred_at: new Date().toISOString(),
              idempotency_key: `RECON_${customer.customer_id}_${today}_USDT_${Date.now()}`
            });
          }

          // Insert funding events
          const { error: fundingError } = await supabase.schema("lth_pvr")
            .from("exchange_funding_events")
            .insert(fundingEvents);

          if (fundingError) {
            console.error("Error creating funding events:", fundingError);
            results.errors++;
            detail.action = "error_creating_events";
          } else {
            console.log(`✅ Created ${fundingEvents.length} funding event(s)`);

            // Update balances_daily to match VALR
            const { error: updateError } = await supabase
              .from("balances_daily")
              .upsert({
                org_id: orgId,
                customer_id: customer.customer_id,
                date: today,
                btc_balance: valrBTC,
                usdt_balance: valrUSDT,
                nav_usd: (valrUSDT + (valrBTC * 95000)).toFixed(2), // Rough estimate, will be corrected by ef_post_ledger_and_balances
                updated_at: new Date().toISOString()
              }, {
                onConflict: "org_id,customer_id,date"
              });

            if (updateError) {
              console.error("Error updating balances:", updateError);
              results.errors++;
            } else {
              results.reconciled++;
              console.log(`✅ Updated balances_daily`);
            }
          }
        } else {
          console.log(`✓ Balances match - no action needed`);
          results.reconciled++;
        }

      } catch (error) {
        console.error(`Error processing account ${account.label}:`, error);
        results.errors++;
        results.details.push({
          account_id: account.exchange_account_id,
          account_label: account.label,
          error: String(error)
        });
      }
    }

    console.log("Balance reconciliation complete:", results);

    // If any funding events were created (discrepancies > 0 and no errors), trigger ledger posting
    if (results.discrepancies > 0 && results.errors === 0) {
      console.log(`Triggering ef_post_ledger_and_balances to process ${results.discrepancies} funding event(s)...`);
      try {
        const ledgerResponse = await fetch(`${supabaseUrl}/functions/v1/ef_post_ledger_and_balances`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({}),
        });

        if (ledgerResponse.ok) {
          const ledgerResult = await ledgerResponse.json();
          console.log("Ledger posting completed:", ledgerResult);
        } else {
          console.error("Ledger posting failed:", await ledgerResponse.text());
        }
      } catch (ledgerError) {
        console.error("Error triggering ledger posting:", ledgerError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Balance reconciliation complete",
        results
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );

  } catch (error) {
    console.error("Fatal error in balance reconciliation:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        results
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
