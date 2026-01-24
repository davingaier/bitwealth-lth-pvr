// Edge Function: ef_calculate_performance_fees
// Purpose: Calculate monthly performance fees (10% on HWM profits)
// Schedule: pg_cron on 1st of month at 00:05 UTC
// Deployed with: --no-verify-jwt (called by pg_cron)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { transferToMainAccount } from "../_shared/valrTransfer.ts";
import { logAlert } from "../_shared/alerting.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");

if (!supabaseUrl || !supabaseKey || !orgId) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "lth_pvr" }
});

interface CustomerState {
  state_id: string;
  customer_id: number;
  trade_date: string;
  high_water_mark_usd: number;
  hwm_contrib_net_cum: number;
  last_perf_fee_month: string | null;
}

interface Balance {
  btc_balance: number;
  usdt_balance: number;
  nav_usd: number;
}

Deno.serve(async (req) => {
  try {
    console.log("Starting monthly performance fee calculation...");

    // Get previous month (we run on 1st, calculate for previous month)
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStr = lastMonth.toISOString().substring(0, 7); // YYYY-MM
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const lastDayStr = lastDayOfMonth.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`Calculating performance fees for ${lastMonthStr} (last day: ${lastDayStr})`);

    // Get all active customers with strategies
    const { data: activeStrategies, error: strategyError } = await supabase
      .schema("public")
      .from("customer_strategies")
      .select("customer_id, customer_strategy_id, performance_fee_rate")
      .eq("org_id", orgId)
      .eq("status", "active")
      .eq("live_enabled", true)
      .gt("performance_fee_rate", 0);

    if (strategyError) {
      console.error("Error fetching active strategies:", strategyError);
      throw strategyError;
    }

    if (!activeStrategies || activeStrategies.length === 0) {
      console.log("No active customers with performance fees enabled");
      return new Response(
        JSON.stringify({ success: true, message: "No active customers", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${activeStrategies.length} active customers with performance fees`);

    const results = {
      processed: 0,
      fees_charged: 0,
      total_fees_usd: 0,
      errors: 0,
      skipped: 0,
    };

    for (const strategy of activeStrategies) {
      const customerId = strategy.customer_id;
      const feeRate = Number(strategy.performance_fee_rate || 0.10);

      try {
        console.log(`Processing customer ${customerId}...`);

        // Get current HWM state
        const { data: stateRows, error: stateError } = await supabase
          .from("customer_state_daily")
          .select("*")
          .eq("customer_id", customerId)
          .order("trade_date", { ascending: false })
          .limit(1);

        if (stateError) {
          console.error(`Error fetching state for customer ${customerId}:`, stateError);
          throw stateError;
        }

        const currentState = stateRows?.[0] as CustomerState | undefined;

        if (!currentState) {
          console.log(`No HWM state found for customer ${customerId}, initializing...`);
          
          // Initialize HWM state (first month for this customer)
          const { data: latestBalance, error: balanceError } = await supabase
            .from("balances_daily")
            .select("btc_balance, usdt_balance, nav_usd")
            .eq("org_id", orgId)
            .eq("customer_id", customerId)
            .lte("date", lastDayStr)
            .order("date", { ascending: false })
            .limit(1)
            .single();

          if (balanceError || !latestBalance) {
            console.log(`No balance found for customer ${customerId}, skipping`);
            results.skipped++;
            continue;
          }

          const balance = latestBalance as Balance;

          // Calculate cumulative net contributions
          const { data: contribData, error: contribError } = await supabase
            .from("ledger_lines")
            .select("amount_usdt, amount_btc")
            .eq("org_id", orgId)
            .eq("customer_id", customerId)
            .in("kind", ["topup", "withdrawal"])
            .lte("trade_date", lastDayStr);

          if (contribError) throw contribError;

          let netContribUsd = 0;
          const btcPrice = balance.nav_usd / balance.btc_balance || 0;

          for (const line of (contribData || [])) {
            netContribUsd += Number(line.amount_usdt || 0);
            netContribUsd += Number(line.amount_btc || 0) * btcPrice;
          }

          // Initial HWM = NAV - net contributions (profit component only)
          const initialHWM = Math.max(0, balance.nav_usd - netContribUsd);

          const { error: insertStateError } = await supabase
            .from("customer_state_daily")
            .insert({
              org_id: orgId,
              customer_id: customerId,
              trade_date: lastDayStr,
              high_water_mark_usd: initialHWM,
              hwm_contrib_net_cum: netContribUsd,
              last_perf_fee_month: lastMonthStr,
            });

          if (insertStateError) {
            console.error(`Error initializing state for customer ${customerId}:`, insertStateError);
            throw insertStateError;
          }

          console.log(`Initialized HWM for customer ${customerId}: $${initialHWM.toFixed(2)}`);
          results.processed++;
          continue;
        }

        // Check if already processed this month
        if (currentState.last_perf_fee_month === lastMonthStr) {
          console.log(`Performance fee already calculated for customer ${customerId} in ${lastMonthStr}`);
          results.skipped++;
          continue;
        }

        // Get month-end balance
        const { data: monthEndBalance, error: balanceError } = await supabase
          .from("balances_daily")
          .select("btc_balance, usdt_balance, nav_usd")
          .eq("org_id", orgId)
          .eq("customer_id", customerId)
          .lte("date", lastDayStr)
          .order("date", { ascending: false })
          .limit(1)
          .single();

        if (balanceError || !monthEndBalance) {
          console.log(`No balance found for customer ${customerId}, skipping`);
          results.skipped++;
          continue;
        }

        const balance = monthEndBalance as Balance;

        // Calculate cumulative net contributions since HWM established
        const { data: recentContribData, error: recentContribError } = await supabase
          .from("ledger_lines")
          .select("amount_usdt, amount_btc, trade_date")
          .eq("org_id", orgId)
          .eq("customer_id", customerId)
          .in("kind", ["topup", "withdrawal"])
          .gt("trade_date", currentState.trade_date)
          .lte("trade_date", lastDayStr);

        if (recentContribError) throw recentContribError;

        let additionalContrib = 0;
        const btcPrice = balance.nav_usd / balance.btc_balance || 50000; // Fallback price

        for (const line of (recentContribData || [])) {
          additionalContrib += Number(line.amount_usdt || 0);
          additionalContrib += Number(line.amount_btc || 0) * btcPrice;
        }

        const totalNetContrib = currentState.hwm_contrib_net_cum + additionalContrib;
        const hwmThreshold = currentState.high_water_mark_usd + totalNetContrib;

        console.log(`Customer ${customerId}: NAV=$${balance.nav_usd.toFixed(2)}, HWM threshold=$${hwmThreshold.toFixed(2)}`);

        // Calculate performance fee if NAV exceeds HWM + contributions
        if (balance.nav_usd <= hwmThreshold) {
          console.log(`No performance fee for customer ${customerId} (NAV <= HWM threshold)`);
          
          // Update state with new trade date and contributions
          const { error: updateError } = await supabase
            .from("customer_state_daily")
            .update({
              trade_date: lastDayStr,
              hwm_contrib_net_cum: totalNetContrib,
              last_perf_fee_month: lastMonthStr,
            })
            .eq("state_id", currentState.state_id);

          if (updateError) {
            console.error(`Error updating state for customer ${customerId}:`, updateError);
          }

          results.processed++;
          continue;
        }

        const profitAboveHWM = balance.nav_usd - hwmThreshold;
        const performanceFee = profitAboveHWM * feeRate;

        console.log(`Performance fee for customer ${customerId}: $${performanceFee.toFixed(2)} (${(feeRate * 100).toFixed(1)}% of $${profitAboveHWM.toFixed(2)} profit)`);

        // Check if sufficient USDT balance for fee
        if (balance.usdt_balance < performanceFee) {
          console.log(`Insufficient USDT for customer ${customerId}: has $${balance.usdt_balance.toFixed(2)}, needs $${performanceFee.toFixed(2)}`);
          console.log(`Triggering automatic BTC conversion for shortfall: $${(performanceFee - balance.usdt_balance).toFixed(2)}`);
          
          // Trigger automatic BTC conversion (TC1.7 optimized workflow)
          try {
            const convertResponse = await fetch(`${supabaseUrl}/functions/v1/ef_auto_convert_btc_to_usdt`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                action: "auto_convert",
                customer_id: customerId,
                performance_fee: performanceFee,
                usdt_available: balance.usdt_balance,
                trade_date: lastDayStr,
                fee_type: "performance_fee",
              }),
            });

            if (!convertResponse.ok) {
              const errorText = await convertResponse.text();
              throw new Error(`Auto-conversion failed: ${errorText}`);
            }

            const convertResult = await convertResponse.json();
            console.log(`Auto-conversion completed for customer ${customerId}:`, convertResult);
            
            // Fee has been handled by auto-convert function (including ledger entries and HWM update)
            results.processed++;
            continue;
            
          } catch (convertError) {
            await logAlert(
              supabase,
              "ef_calculate_performance_fees",
              "error",
              `Failed to auto-convert BTC for customer ${customerId}: ${convertError.message}`,
              {
                customer_id: customerId,
                performance_fee: performanceFee,
                usdt_available: balance.usdt_balance,
                error: convertError.message,
              },
              orgId,
              customerId
            );
            results.failed++;
            continue;
          }
        }

        // Create ledger entry for performance fee
        const { data: ledgerData, error: ledgerError } = await supabase
          .from("ledger_lines")
          .insert({
            org_id: orgId,
            customer_id: customerId,
            trade_date: lastDayStr,
            kind: "performance_fee",
            amount_usdt: -performanceFee, // Negative = deduction
            performance_fee_usdt: performanceFee,
            note: `Performance fee ${lastMonthStr}: ${(feeRate * 100).toFixed(1)}% of $${profitAboveHWM.toFixed(2)} profit`,
          })
          .select("ledger_id")
          .single();

        if (ledgerError) {
          console.error(`Error creating ledger entry for customer ${customerId}:`, ledgerError);
          throw ledgerError;
        }

        const ledgerId = ledgerData?.ledger_id;

        // Transfer fee to BitWealth main account
        const { data: exchangeAcct, error: exAcctError } = await supabase
          .schema("public")
          .from("exchange_accounts")
          .select("subaccount_id, account_id")
          .eq("customer_id", customerId)
          .eq("exchange", "VALR")
          .single();

        if (exAcctError || !exchangeAcct) {
          await logAlert(
            supabase,
            "ef_calculate_performance_fees",
            "error",
            `No exchange account found for customer ${customerId}`,
            { customer_id: customerId, ledger_id: ledgerId },
            orgId,
            customerId
          );
          console.error(`No exchange account for customer ${customerId}`);
          results.errors++;
          continue;
        }

        const subaccountId = exchangeAcct.subaccount_id;
        const mainAccountId = Deno.env.get("VALR_MAIN_ACCOUNT_ID") || "main";

        const transferResult = await transferToMainAccount(
          supabase,
          {
            fromSubaccountId: subaccountId,
            toAccount: mainAccountId,
            currency: "USDT",
            amount: performanceFee,
            transferType: "performance_fee",
          },
          customerId,
          ledgerId
        );

        if (!transferResult.success) {
          await logAlert(
            supabase,
            "ef_calculate_performance_fees",
            "error",
            `Performance fee transfer failed: ${transferResult.errorMessage}`,
            {
              customer_id: customerId,
              ledger_id: ledgerId,
              amount_usdt: performanceFee,
              error: transferResult.errorMessage,
            },
            orgId,
            customerId
          );
          console.error(`Transfer failed for customer ${customerId}: ${transferResult.errorMessage}`);
          results.errors++;
        } else {
          console.log(`✓ Performance fee transferred for customer ${customerId}: $${performanceFee.toFixed(2)}`);
          results.fees_charged++;
          results.total_fees_usd += performanceFee;
        }

        // Update HWM state (new HWM = NAV after fee - net contributions)
        const newNAV = balance.nav_usd - performanceFee;
        const newHWM = newNAV - totalNetContrib;

        const { error: updateStateError } = await supabase
          .from("customer_state_daily")
          .update({
            trade_date: lastDayStr,
            high_water_mark_usd: newHWM,
            hwm_contrib_net_cum: totalNetContrib,
            last_perf_fee_month: lastMonthStr,
          })
          .eq("state_id", currentState.state_id);

        if (updateStateError) {
          console.error(`Error updating HWM state for customer ${customerId}:`, updateStateError);
          throw updateStateError;
        }

        console.log(`✓ Updated HWM for customer ${customerId}: $${newHWM.toFixed(2)}`);
        results.processed++;

      } catch (error) {
        console.error(`Error processing customer ${customerId}:`, error);
        results.errors++;
      }
    }

    console.log(`Performance fee calculation complete: ${results.fees_charged} fees charged, $${results.total_fees_usd.toFixed(2)} total`);

    return new Response(
      JSON.stringify({
        success: true,
        month: lastMonthStr,
        ...results,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in ef_calculate_performance_fees:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
