// Edge Function: ef_calculate_management_fees
// Purpose: Monthly management fee (NAV x annual_rate / 12) for customers on the
//          MANAGEMENT fee plan. Runs on the 1st for the previous month.
//            - monthly schedule   -> deduct immediately
//            - quarterly schedule -> accrue; settle at calendar quarter end (Mar/Jun/Sep/Dec)
//            - annual schedule    -> accrue; settle at calendar year end (Dec)
// The governing plan for the charged month is resolved as-of the FIRST day of
// that month via public.get_customer_fee_rates_asof (plan switches take effect
// at the start of the next calendar month, so a mid-month switch never applies
// retroactively). Management fee is independent of the HWM (performance fee).
// Schedule: pg_cron on 1st of month at 00:07 UTC. Deploy with --no-verify-jwt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withdrawFeeFromCustomerAccount } from "../_shared/valrTransfer.ts";
import { logAlert } from "../_shared/alerting.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");

if (!supabaseUrl || !supabaseKey || !orgId) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey, { db: { schema: "lth_pvr" } });

function ymd(d: Date): string {
  return d.toISOString().split("T")[0];
}

Deno.serve(async () => {
  try {
    console.log("Starting monthly management fee calculation...");

    const now = new Date();
    // Previous calendar month
    const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastMonthLast = new Date(firstOfThisMonth.getTime() - 24 * 3600 * 1000);
    const lastMonthStr = ymd(lastMonthFirst).substring(0, 7); // YYYY-MM
    const lastMonthFirstDay = ymd(lastMonthFirst);            // YYYY-MM-01
    const lastDayStr = ymd(lastMonthLast);                    // YYYY-MM-DD (period end)
    const lastMonthIdx = lastMonthFirst.getUTCMonth();        // 0..11
    const lastMonthYear = lastMonthFirst.getUTCFullYear();

    const isQuarterEnd = [2, 5, 8, 11].includes(lastMonthIdx); // Mar/Jun/Sep/Dec
    const isYearEnd = lastMonthIdx === 11;                     // Dec

    console.log(`Management fees for ${lastMonthStr} (period end ${lastDayStr}); quarterEnd=${isQuarterEnd} yearEnd=${isYearEnd}`);

    // All active, live LTH_PVR customers (plan resolved per-customer as-of the month).
    const { data: activeStrategies, error: strategyError } = await supabase
      .schema("public")
      .from("customer_strategies")
      .select("customer_id")
      .eq("org_id", orgId)
      .eq("strategy_code", "LTH_PVR")
      .eq("status", "active")
      .eq("live_enabled", true);

    if (strategyError) throw strategyError;

    const results = { processed: 0, fees_charged: 0, accrued: 0, total_fees_usd: 0, errors: 0, skipped: 0 };

    for (const strat of activeStrategies ?? []) {
      const customerId = strat.customer_id;
      try {
        // Resolve the plan/rate/schedule in force for the charged month.
        const { data: asofRows, error: asofErr } = await supabase
          .schema("public")
          .rpc("get_customer_fee_rates_asof", { p_customer_id: customerId, p_as_of: lastMonthFirstDay });
        if (asofErr) throw asofErr;
        const asof = asofRows?.[0];
        if (!asof || asof.fee_plan !== "management") { results.skipped++; continue; }
        const rate = Number(asof.management_fee_rate ?? 0.01);
        const schedule = String(asof.management_fee_schedule ?? "monthly");
        if (!(rate > 0)) { results.skipped++; continue; }

        // Idempotency: skip if already processed this month.
        const { data: stateRows } = await supabase
          .from("customer_state_daily")
          .select("state_id, date, last_management_fee_period")
          .eq("customer_id", customerId)
          .order("date", { ascending: false })
          .limit(1);
        const state = stateRows?.[0];
        if (state?.last_management_fee_period && String(state.last_management_fee_period).startsWith(lastMonthStr)) {
          console.log(`Management fee already processed for customer ${customerId} in ${lastMonthStr}`);
          results.skipped++;
          continue;
        }

        // Month-end NAV
        const { data: balRows, error: balErr } = await supabase
          .from("balances_daily")
          .select("btc_balance, usdt_balance, nav_usd")
          .eq("org_id", orgId)
          .eq("customer_id", customerId)
          .lte("date", lastDayStr)
          .order("date", { ascending: false })
          .limit(1);
        if (balErr) throw balErr;
        const balance = balRows?.[0];
        if (!balance) { results.skipped++; continue; }

        const navUsd = Number(balance.nav_usd || 0);
        const monthFee = Math.max(0, navUsd * rate / 12);
        const monthFeeR = Math.round(monthFee * 100) / 100;

        const markProcessed = async () => {
          if (state?.state_id) {
            await supabase.from("customer_state_daily")
              .update({ last_management_fee_period: lastMonthFirstDay })
              .eq("state_id", state.state_id);
          }
        };

        if (monthFeeR <= 0) { await markProcessed(); results.processed++; continue; }

        // ------- ACCRUE-ONLY schedules (quarterly / annual) -------
        if (schedule === "quarterly" || schedule === "annual") {
          // Calendar accrual period.
          let periodStart: string, periodEnd: string, accrualYear: number;
          if (schedule === "quarterly") {
            const qStartMonth = Math.floor(lastMonthIdx / 3) * 3;
            periodStart = ymd(new Date(Date.UTC(lastMonthYear, qStartMonth, 1)));
            periodEnd = ymd(new Date(Date.UTC(lastMonthYear, qStartMonth + 3, 0)));
          } else {
            periodStart = ymd(new Date(Date.UTC(lastMonthYear, 0, 1)));
            periodEnd = ymd(new Date(Date.UTC(lastMonthYear, 11, 31)));
          }
          accrualYear = lastMonthYear;

          // Upsert the accrual row for this period (add this month's fee).
          const { data: existing } = await supabase
            .from("annual_fee_accrual")
            .select("accrual_id, accrued_management_fee_usdt, settled_at")
            .eq("org_id", orgId)
            .eq("customer_id", customerId)
            .eq("period_start", periodStart)
            .eq("period_end", periodEnd)
            .is("settled_at", null)
            .limit(1);
          let accrualId = existing?.[0]?.accrual_id as string | undefined;
          const priorAccrued = Number(existing?.[0]?.accrued_management_fee_usdt || 0);
          const newAccrued = Math.round((priorAccrued + monthFeeR) * 100) / 100;

          if (accrualId) {
            await supabase.from("annual_fee_accrual")
              .update({ accrued_management_fee_usdt: newAccrued, updated_at: new Date().toISOString() })
              .eq("accrual_id", accrualId);
          } else {
            const { data: ins } = await supabase.from("annual_fee_accrual")
              .insert({ org_id: orgId, customer_id: customerId, accrual_year: accrualYear,
                period_start: periodStart, period_end: periodEnd, accrued_management_fee_usdt: newAccrued })
              .select("accrual_id").single();
            accrualId = ins?.accrual_id;
          }

          const settleNow = schedule === "quarterly" ? isQuarterEnd : isYearEnd;
          if (!settleNow) {
            console.log(`Accrued management fee $${monthFeeR} for customer ${customerId} (total $${newAccrued}, ${schedule} period ${periodStart}..${periodEnd})`);
            await markProcessed();
            results.accrued++;
            results.processed++;
            continue;
          }

          // Settle the full accrued amount now.
          const settleAmt = newAccrued;
          const ledgerId = await bookAndCollect(customerId, settleAmt, lastDayStr,
            `Management fee settlement (${schedule}) ${periodStart}..${periodEnd}`);
          if (accrualId) {
            await supabase.from("annual_fee_accrual")
              .update({ settled_at: new Date().toISOString(),
                settlement_ledger_ids: ledgerId ? [ledgerId] : null,
                settlement_notes: `Settled ${settleAmt} USDT` })
              .eq("accrual_id", accrualId);
          }
          await markProcessed();
          results.fees_charged++;
          results.total_fees_usd += settleAmt;
          results.processed++;
          continue;
        }

        // ------- MONTHLY schedule: deduct immediately -------
        await bookAndCollect(customerId, monthFeeR, lastDayStr,
          `Management fee ${lastMonthStr}: ${(rate * 100).toFixed(2)}% p.a. on NAV $${navUsd.toFixed(2)}`);
        await markProcessed();
        results.fees_charged++;
        results.total_fees_usd += monthFeeR;
        results.processed++;

      } catch (e) {
        console.error(`Error processing customer ${customerId}:`, e);
        await logAlert(supabase, "ef_calculate_management_fees", "error",
          `Management fee failed for customer ${customerId}: ${e.message}`,
          { customer_id: customerId, month: lastMonthStr }, orgId, customerId);
        results.errors++;
      }
    }

    console.log(`Management fee run complete:`, results);
    return new Response(JSON.stringify({ success: true, month: lastMonthStr, ...results }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error in ef_calculate_management_fees:", error);
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Book the management-fee ledger line and transfer the fee to BitWealth.
  // Returns the ledger_id (or undefined on ledger failure).
  async function bookAndCollect(customerId: number, amountUsdt: number, tradeDate: string, note: string): Promise<string | undefined> {
    const { data: ledgerData, error: ledgerError } = await supabase
      .from("ledger_lines")
      .insert({
        org_id: orgId,
        customer_id: customerId,
        trade_date: tradeDate,
        kind: "management_fee",
        amount_usdt: -amountUsdt,           // negative = deduction from client NAV
        management_fee_usdt: amountUsdt,
        note,
      })
      .select("ledger_id")
      .single();
    if (ledgerError) {
      await logAlert(supabase, "ef_calculate_management_fees", "error",
        `Ledger insert failed for customer ${customerId}: ${ledgerError.message}`,
        { customer_id: customerId, amount_usdt: amountUsdt }, orgId, customerId);
      throw ledgerError;
    }
    const ledgerId = ledgerData?.ledger_id;

    // Collect: account-model aware; ensureIdleUsdt (inside) sells USDPC to cover a USDT shortfall.
    const transferResult = await withdrawFeeFromCustomerAccount(
      supabase, customerId, "USDT", amountUsdt, ledgerId, "management_fee");
    if (!transferResult.success) {
      await logAlert(supabase, "ef_calculate_management_fees", "error",
        `Management fee transfer failed: ${transferResult.errorMessage}`,
        { customer_id: customerId, ledger_id: ledgerId, amount_usdt: amountUsdt }, orgId, customerId);
    } else {
      console.log(`✓ Management fee collected for customer ${customerId}: $${amountUsdt.toFixed(2)}`);
    }
    return ledgerId;
  }
});
