// Edge Function: ef_collect_annual_fees
// Purpose: Collect accrued annual platform + performance fees for customers
//          on anniversary-based billing schedule.
// Schedule: pg_cron daily at 06:00 UTC (collects mature periods)
// Deployed with: --no-verify-jwt (called by pg_cron / internal)
//
// Anniversary-based: each customer's annual period runs from their
// customer_strategies.effective_from anniversary to the next anniversary.
// Collection triggers when period_end < today (the period has matured).
//
// Flow:
// 1. Read unsettled accrual rows where period_end < today
// 2. For each, calculate annual performance fee via HWM (if applicable)
// 3. Create fee ledger entries (deductions from customer balance)
// 4. Transfer fees via withdrawFeeFromCustomerAccount() (both models)
// 5. Mark accrual rows as settled

import { getServiceClient } from "./client.ts";
import { withdrawFeeFromCustomerAccount } from "../_shared/valrTransfer.ts";
import { logAlert } from "../_shared/alerting.ts";

interface AccrualRow {
  accrual_id: string;
  customer_id: number;
  accrual_year: number;
  period_start: string;
  period_end: string;
  accrued_platform_fee_btc: number;
  accrued_platform_fee_usdt: number;
  accrued_performance_fee_usdt: number;
}

interface CustomerState {
  state_id: string;
  customer_id: number;
  date: string;
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
  const sb = getServiceClient();
  const orgId = Deno.env.get("ORG_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!orgId) {
    return new Response(JSON.stringify({ error: "Missing ORG_ID" }), { status: 500 });
  }

  // Optional body params: { customer_id } for on-demand single-customer collection
  let forceCustomerId: number | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    forceCustomerId = body.customer_id ?? null;
  } catch { /* no body */ }

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  console.log(`[ef_collect_annual_fees] Running anniversary-based collection (today=${today}${forceCustomerId ? `, forced customer=${forceCustomerId}` : ""})`);

  const results = {
    processed: 0,
    platform_fees_collected: 0,
    performance_fees_collected: 0,
    total_platform_btc: 0,
    total_platform_usdt: 0,
    total_performance_usdt: 0,
    errors: 0,
    skipped: 0,
  };

  try {
    // ─── Step 1: Get mature unsettled accrual rows (period_end < today) ───────
    let query = sb
      .from("annual_fee_accrual")
      .select("*")
      .eq("org_id", orgId)
      .is("settled_at", null)
      .lt("period_end", today);

    if (forceCustomerId) {
      query = query.eq("customer_id", forceCustomerId);
    }

    const { data: accruals, error: accrualErr } = await query;

    if (accrualErr) throw accrualErr;

    if (!accruals || accruals.length === 0) {
      console.log(`[ef_collect_annual_fees] No mature unsettled accruals found`);
      return jsonResponse({ success: true, message: "No mature accrual periods to collect", ...results });
    }

    console.log(`[ef_collect_annual_fees] Found ${accruals.length} mature accrual period(s) to collect`);

    // ─── Step 2: Get annual customer strategies for performance fee calc ──────
    const { data: annualStrategies, error: stratErr } = await sb
      .schema("public")
      .from("customer_strategies")
      .select("customer_id, performance_fee_rate, performance_fee_schedule")
      .eq("org_id", orgId)
      .eq("status", "active")
      .eq("live_enabled", true)
      .eq("performance_fee_schedule", "annual");

    if (stratErr) {
      console.error("[ef_collect_annual_fees] Error fetching annual strategies:", stratErr);
      throw stratErr;
    }

    const perfFeeRateMap = new Map<number, number>();
    for (const s of (annualStrategies ?? [])) {
      if (Number(s.performance_fee_rate) > 0) {
        perfFeeRateMap.set(s.customer_id, Number(s.performance_fee_rate));
      }
    }

    // ─── Step 3: Process each mature accrual period ──────────────────────────
    for (const accrual of accruals as AccrualRow[]) {
      const cid = accrual.customer_id;
      const periodEnd = accrual.period_end;
      const periodLabel = `${accrual.period_start} to ${accrual.period_end}`;
      const ledgerIds: string[] = [];
      const transferIds: string[] = [];

      try {
        console.log(`[ef_collect_annual_fees] Processing customer ${cid} period ${periodLabel}...`);

        // ── 3a. Calculate annual performance fee (HWM-based) ──────────────
        const perfRate = perfFeeRateMap.get(cid);
        let annualPerfFee = 0;

        if (perfRate && perfRate > 0) {
          annualPerfFee = await calculateAnnualPerformanceFee(
            sb, orgId, cid, perfRate, periodEnd,
          );
          console.log(`  Performance fee for customer ${cid}: $${annualPerfFee.toFixed(2)}`);

          const { error: updatePerfErr } = await sb
            .from("annual_fee_accrual")
            .update({
              accrued_performance_fee_usdt: annualPerfFee,
              performance_fee_calculated_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("accrual_id", accrual.accrual_id);

          if (updatePerfErr) {
            console.error(`  Failed to record perf fee for customer ${cid}:`, updatePerfErr.message);
          }
        }

        // ── 3b. Collect platform fee (USDT portion) ──────────────────────
        const platUsdt = Number(accrual.accrued_platform_fee_usdt || 0);
        if (platUsdt > 0) {
          const result = await collectFee(
            sb, orgId, cid, "USDT", platUsdt,
            `Annual platform fee (${periodLabel}) USDT`,
            "annual_platform_fee", periodEnd,
          );
          if (result.ledgerId) ledgerIds.push(result.ledgerId);
          if (result.transferId) transferIds.push(result.transferId);
          if (result.success) {
            results.platform_fees_collected++;
            results.total_platform_usdt += platUsdt;
          } else {
            results.errors++;
          }
        }

        // ── 3c. Collect platform fee (BTC portion) ──────────────────────
        const platBtc = Number(accrual.accrued_platform_fee_btc || 0);
        if (platBtc > 0) {
          const result = await collectFee(
            sb, orgId, cid, "BTC", platBtc,
            `Annual platform fee (${periodLabel}) BTC`,
            "annual_platform_fee", periodEnd,
          );
          if (result.ledgerId) ledgerIds.push(result.ledgerId);
          if (result.transferId) transferIds.push(result.transferId);
          if (result.success) {
            results.platform_fees_collected++;
            results.total_platform_btc += platBtc;
          } else {
            results.errors++;
          }
        }

        // ── 3d. Collect performance fee (USDT) ─────────────────────────
        if (annualPerfFee > 0) {
          const { data: balRow } = await sb
            .from("balances_daily")
            .select("usdt_balance")
            .eq("org_id", orgId)
            .eq("customer_id", cid)
            .lte("date", periodEnd)
            .order("date", { ascending: false })
            .limit(1)
            .single();

          const usdtAvail = Number(balRow?.usdt_balance || 0);
          if (usdtAvail < annualPerfFee && supabaseUrl && supabaseKey) {
            console.log(`  Insufficient USDT for customer ${cid} perf fee: has $${usdtAvail.toFixed(2)}, needs $${annualPerfFee.toFixed(2)}. Triggering auto-conversion.`);
            try {
              const convResp = await fetch(`${supabaseUrl}/functions/v1/ef_auto_convert_btc_to_usdt`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${supabaseKey}`,
                },
                body: JSON.stringify({
                  action: "auto_convert",
                  customer_id: cid,
                  performance_fee: annualPerfFee,
                  usdt_available: usdtAvail,
                  trade_date: periodEnd,
                  fee_type: "annual_performance_fee",
                }),
              });
              if (!convResp.ok) {
                throw new Error(`Auto-conversion failed: ${await convResp.text()}`);
              }
              const convResult = await convResp.json();
              console.log(`  Auto-conversion completed for customer ${cid}:`, convResult);
              results.performance_fees_collected++;
              results.total_performance_usdt += annualPerfFee;
            } catch (convErr) {
              await logAlert(sb, "ef_collect_annual_fees", "error",
                `BTC auto-conversion failed for annual perf fee: ${(convErr as Error).message}`,
                { customer_id: cid, amount: annualPerfFee, period: periodLabel }, orgId, cid,
              );
              results.errors++;
            }
          } else {
            const result = await collectFee(
              sb, orgId, cid, "USDT", annualPerfFee,
              `Annual performance fee (${periodLabel}): ${((perfRate || 0.10) * 100).toFixed(1)}% of profit above HWM`,
              "annual_performance_fee", periodEnd,
            );
            if (result.ledgerId) ledgerIds.push(result.ledgerId);
            if (result.transferId) transferIds.push(result.transferId);
            if (result.success) {
              results.performance_fees_collected++;
              results.total_performance_usdt += annualPerfFee;
            } else {
              results.errors++;
            }
          }

          await updateHWMAfterAnnualFee(sb, orgId, cid, annualPerfFee, periodEnd);
        }

        // ── 3e. Mark accrual row as settled ────────────────────────────
        if (results.errors === 0 || ledgerIds.length > 0) {
          const { error: settleErr } = await sb
            .from("annual_fee_accrual")
            .update({
              settled_at: new Date().toISOString(),
              settlement_ledger_ids: ledgerIds,
              settlement_transfer_ids: transferIds,
              settlement_notes: `Settled by ef_collect_annual_fees at ${new Date().toISOString()} for period ${periodLabel}`,
              updated_at: new Date().toISOString(),
            })
            .eq("accrual_id", accrual.accrual_id);

          if (settleErr) {
            console.error(`  Failed to mark accrual settled for customer ${cid}:`, settleErr.message);
          }
        }

        results.processed++;
      } catch (err) {
        console.error(`[ef_collect_annual_fees] Error processing customer ${cid}:`, err);
        await logAlert(sb, "ef_collect_annual_fees", "error",
          `Annual fee collection failed for customer ${cid}: ${(err as Error).message}`,
          { customer_id: cid, accrual_id: accrual.accrual_id, period: periodLabel }, orgId, cid,
        );
        results.errors++;
      }
    }

    console.log(`[ef_collect_annual_fees] Complete:`, results);
    return jsonResponse({ success: true, ...results });

  } catch (err) {
    console.error("[ef_collect_annual_fees] Fatal error:", err);
    await logAlert(sb, "ef_collect_annual_fees", "critical",
      `Fatal: ${(err as Error).message}`, {}, orgId,
    );
    return jsonResponse({ success: false, error: (err as Error).message }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Calculate annual performance fee using HWM methodology
// ─────────────────────────────────────────────────────────────────────────────
async function calculateAnnualPerformanceFee(
  sb: ReturnType<typeof getServiceClient>,
  orgId: string,
  customerId: number,
  feeRate: number,
  yearEnd: string,
): Promise<number> {
  // Get year-end balance
  const { data: balRow, error: balErr } = await sb
    .from("balances_daily")
    .select("btc_balance, usdt_balance, nav_usd")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .lte("date", yearEnd)
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (balErr || !balRow) {
    console.log(`  No year-end balance for customer ${customerId}, perf fee = 0`);
    return 0;
  }
  const balance = balRow as Balance;

  // Get HWM state
  const { data: stateRows } = await sb
    .from("customer_state_daily")
    .select("*")
    .eq("customer_id", customerId)
    .order("date", { ascending: false })
    .limit(1);

  const currentState = (stateRows?.[0] as CustomerState) ?? null;

  if (!currentState) {
    console.log(`  No HWM state for customer ${customerId}, skipping annual perf fee`);
    return 0;
  }

  // If state was created by ef_generate_decisions (never fee-initialized), treat
  // this as the first annual period: NAV must exceed (total deposits) to charge a fee.
  // We initialize HWM = 0 and contrib = all net deposits so the threshold = total deposits.
  let effectiveHWM = currentState.high_water_mark_usd;
  let effectiveContrib = currentState.hwm_contrib_net_cum;

  if (currentState.last_perf_fee_month === null) {
    // Compute total net contributions up to year-end to use as the baseline threshold
    const { data: allContribData } = await sb
      .from("ledger_lines")
      .select("amount_usdt, amount_btc")
      .eq("org_id", orgId)
      .eq("customer_id", customerId)
      .in("kind", ["topup", "withdrawal"])
      .lte("trade_date", yearEnd);

    const btcSpot = balance.btc_balance > 0 ? balance.nav_usd / balance.btc_balance : 50000;
    let totalContrib = 0;
    for (const line of (allContribData ?? [])) {
      totalContrib += Number(line.amount_usdt || 0);
      totalContrib += Number(line.amount_btc || 0) * btcSpot;
    }
    effectiveHWM = 0;
    effectiveContrib = totalContrib;
  }

  // When already fee-initialized: calculate additional contributions since last HWM date.
  // When first-time (effectiveContrib already covers all contributions), additionalContrib = 0
  // because the query uses currentState.date as the floor — for uninitialized rows we skip
  // the incremental query and use effectiveContrib directly.
  let totalNetContrib = effectiveContrib;

  if (currentState.last_perf_fee_month !== null) {
    // Incremental contributions since last HWM update
    const { data: contribData } = await sb
      .from("ledger_lines")
      .select("amount_usdt, amount_btc")
      .eq("org_id", orgId)
      .eq("customer_id", customerId)
      .in("kind", ["topup", "withdrawal"])
      .gt("trade_date", currentState.date)
      .lte("trade_date", yearEnd);

    let additionalContrib = 0;
    const btcPrice = balance.btc_balance > 0 ? balance.nav_usd / balance.btc_balance : 50000;

    for (const line of (contribData || [])) {
      additionalContrib += Number(line.amount_usdt || 0);
      additionalContrib += Number(line.amount_btc || 0) * btcPrice;
    }

    totalNetContrib = effectiveContrib + additionalContrib;
  }

  const hwmThreshold = effectiveHWM + totalNetContrib;

  console.log(`  Customer ${customerId}: NAV=$${balance.nav_usd.toFixed(2)}, HWM threshold=$${hwmThreshold.toFixed(2)}`);

  if (balance.nav_usd <= hwmThreshold) {
    console.log(`  No annual perf fee for customer ${customerId} (NAV <= HWM threshold)`);
    return 0;
  }

  const profitAboveHWM = balance.nav_usd - hwmThreshold;
  const fee = profitAboveHWM * feeRate;

  console.log(`  Annual perf fee: $${fee.toFixed(2)} (${(feeRate * 100).toFixed(1)}% of $${profitAboveHWM.toFixed(2)} profit)`);
  return fee;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Create ledger entry + transfer fee
// ─────────────────────────────────────────────────────────────────────────────
async function collectFee(
  sb: ReturnType<typeof getServiceClient>,
  orgId: string,
  customerId: number,
  currency: "USDT" | "BTC",
  amount: number,
  note: string,
  transferType: "annual_platform_fee" | "annual_performance_fee",
  tradeDate: string,
): Promise<{ success: boolean; ledgerId?: string; transferId?: string }> {
  // Create deduction ledger entry
  const ledgerPayload: Record<string, unknown> = {
    org_id: orgId,
    customer_id: customerId,
    trade_date: tradeDate,
    kind: transferType === "annual_platform_fee" ? "platform_fee" : "performance_fee",
    note,
  };

  if (currency === "BTC") {
    ledgerPayload.amount_btc = -amount;
    ledgerPayload.platform_fee_btc = amount;
  } else {
    ledgerPayload.amount_usdt = -amount;
    if (transferType === "annual_platform_fee") {
      ledgerPayload.platform_fee_usdt = amount;
    } else {
      ledgerPayload.performance_fee_usdt = amount;
    }
  }

  const { data: ledgerData, error: ledgerErr } = await sb
    .from("ledger_lines")
    .insert(ledgerPayload)
    .select("ledger_id")
    .single();

  if (ledgerErr) {
    console.error(`  Failed to create ledger entry for customer ${customerId}:`, ledgerErr.message);
    await logAlert(sb, "ef_collect_annual_fees", "error",
      `Ledger insert failed: ${ledgerErr.message}`,
      { customer_id: customerId, currency, amount }, orgId, customerId,
    );
    return { success: false };
  }

  const ledgerId = ledgerData?.ledger_id;
  console.log(`  Created ledger entry ${ledgerId} for customer ${customerId}: -${amount} ${currency}`);

  // Transfer fee to BitWealth (handles both subaccount + API models)
  const xferResult = await withdrawFeeFromCustomerAccount(
    sb, customerId, currency, amount, ledgerId, 
    transferType === "annual_platform_fee" ? "platform_fee" : "performance_fee",
  );

  if (!xferResult.success) {
    console.error(`  Transfer failed for customer ${customerId}: ${xferResult.errorMessage}`);
    await logAlert(sb, "ef_collect_annual_fees", "error",
      `Fee transfer failed: ${xferResult.errorMessage}`,
      { customer_id: customerId, currency, amount, ledger_id: ledgerId }, orgId, customerId,
    );
    return { success: false, ledgerId };
  }

  console.log(`  ✓ Transferred ${amount} ${currency} from customer ${customerId}`);
  return { success: true, ledgerId, transferId: xferResult.transferId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Update HWM state after annual performance fee deduction
// ─────────────────────────────────────────────────────────────────────────────
async function updateHWMAfterAnnualFee(
  sb: ReturnType<typeof getServiceClient>,
  orgId: string,
  customerId: number,
  feeAmount: number,
  yearEnd: string,
) {
  const { data: stateRows } = await sb
    .from("customer_state_daily")
    .select("*")
    .eq("customer_id", customerId)
    .order("date", { ascending: false })
    .limit(1);

  const state = stateRows?.[0] as CustomerState | undefined;
  if (!state) return;

  // Get current NAV
  const { data: balRow } = await sb
    .from("balances_daily")
    .select("nav_usd")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .lte("date", yearEnd)
    .order("date", { ascending: false })
    .limit(1)
    .single();

  const nav = Number(balRow?.nav_usd || 0);
  const newNAV = nav - feeAmount;
  const newHWM = newNAV - state.hwm_contrib_net_cum;

  const { error: updateErr } = await sb
    .from("customer_state_daily")
    .update({
      date: yearEnd,
      high_water_mark_usd: newHWM,
      last_perf_fee_month: `${yearEnd.substring(0, 4)}-12-01`, // Mark annual calc done (YYYY-MM-DD)
    })
    .eq("state_id", state.state_id);

  if (updateErr) {
    console.error(`  Failed to update HWM for customer ${customerId}:`, updateErr.message);
  } else {
    console.log(`  ✓ Updated HWM for customer ${customerId}: $${newHWM.toFixed(2)}`);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
