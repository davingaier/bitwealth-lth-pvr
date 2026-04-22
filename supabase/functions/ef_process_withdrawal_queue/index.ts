// Edge Function: ef_process_withdrawal_queue
// Purpose: 5-minute pg_cron processor that drives the withdrawal state machine.
//
// State machine:
//   pending      → (crypto)  → paying_out  → completed (by ef_sync_valr_transactions)
//   pending      → (ZAR)     → converting  → paying_out → completed
//                                       ↘
//                                        failed | cancelled
//
// For each unhandled row:
//   • Crypto (BTC/USDT) on 'pending'    → call VALR cryptoWithdraw, mark paying_out
//   • ZAR on 'pending'                  → place USDT/BTC sell orders, mark converting
//   • ZAR on 'converting'               → check fills; if all filled, place fiat withdraw + mark paying_out
//                                         (after queue_attempts >= 3, swap unfilled limits for market orders)
//
// Failures flip status='failed', capture failure_reason, and emit logAlert(severity='error').
//
// Deployed with: supabase functions deploy ef_process_withdrawal_queue --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import {
  cryptoWithdraw,
  getMarketPrice,
  getOrderBook,
  placeLimitOrder,
  placeMarketOrder,
  cancelOrderById,
  getOrderSummaryByCustomerOrderId,
  zarWithdraw,
} from "../_shared/valrClient.ts";
import { sendEmail } from "../_shared/smtp.ts";
import { getWithdrawalOutcomeEmail } from "../_shared/email-templates.ts";
import { logAlert } from "../_shared/alerting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID       = Deno.env.get("ORG_ID");
const TEST_MODE    = Deno.env.get("VALR_TEST_MODE") === "true";
const FROM_EMAIL   = Deno.env.get("FROM_EMAIL") ?? "noreply@bitwealth.co.za";

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const sbLthPvr = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "lth_pvr" } });

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

// Threshold above which we swap a stale limit order for a market order
const MARKET_FALLBACK_AFTER_ATTEMPTS = 3; // ≈ 15 minutes

// ────────────────────────────────────────────────────────────────────────────
type Row = {
  request_id: string;
  org_id: string;
  customer_id: number;
  currency: string;
  amount_usdt: number | null;
  amount_zar: number | null;
  withdrawal_address: string | null;
  status: string;
  source_asset: string | null;
  conversion_order_id_usdt: string | null;
  conversion_order_id_btc: string | null;
  usdt_sold: number | null;
  btc_sold: number | null;
  zar_received_from_usdt: number | null;
  zar_received_from_btc: number | null;
  valr_conversion_fee_usdt: number | null;
  valr_withdrawal_fee_zar: number | null;
  net_amount: number | null;
  queue_attempts: number;
  dispatched_at: string | null;
};

type CustomerCtx = {
  customerId: number;
  email: string;
  firstName: string;
  bankValrId: string | null;
  withdrawalType: "normal" | "fast";
  creds: { apiKey: string; apiSecret: string };
  subaccountId: string | null;
};

// ────────────────────────────────────────────────────────────────────────────
async function loadCustomerCtx(row: Row): Promise<CustomerCtx | null> {
  const { data: cust } = await sb
    .schema("public")
    .from("customer_details")
    .select("customer_id, email, first_names")
    .eq("customer_id", row.customer_id)
    .single();

  const { data: strat } = await sb
    .schema("public")
    .from("customer_strategies")
    .select("exchange_account_id")
    .eq("customer_id", row.customer_id)
    .limit(1)
    .single();

  const { data: ex } = strat?.exchange_account_id
    ? await sb
        .schema("public")
        .from("exchange_accounts")
        .select("subaccount_id, bank_valr_id")
        .eq("exchange_account_id", strat.exchange_account_id)
        .single()
    : { data: null };

  let creds: { apiKey: string; apiSecret: string };
  let subaccountId: string | null;
  try {
    const r = await resolveCustomerCredentials(sbLthPvr, row.customer_id);
    creds = { apiKey: r.apiKey, apiSecret: r.apiSecret };
    subaccountId = r.subaccountId;
  } catch (e) {
    await logAlert(sbLthPvr, "ef_process_withdrawal_queue", "error",
      `Credential resolution failed: ${(e as Error).message}`,
      { request_id: row.request_id, customer_id: row.customer_id }, ORG_ID, row.customer_id);
    return null;
  }

  return {
    customerId: row.customer_id,
    email: cust?.email ?? "",
    firstName: cust?.first_names ?? "Customer",
    bankValrId: ex?.bank_valr_id ?? null,
    withdrawalType: "normal",
    creds,
    subaccountId,
  };
}

async function markPayingOut(row: Row, valrWithdrawalId: string | undefined, extras: Record<string, unknown> = {}) {
  await sbLthPvr
    .from("withdrawal_requests")
    .update({
      status: "paying_out",
      valr_withdrawal_id: valrWithdrawalId ?? null,
      processed_at: new Date().toISOString(),
      ...extras,
    })
    .eq("request_id", row.request_id);
}

async function markConverting(row: Row, extras: Record<string, unknown>) {
  await sbLthPvr
    .from("withdrawal_requests")
    .update({
      status: "converting",
      conversion_status: "limit_placed",
      ...extras,
    })
    .eq("request_id", row.request_id);
}

async function markFailed(row: Row, ctx: CustomerCtx | null, reason: string, valrResponse?: unknown) {
  await sbLthPvr
    .from("withdrawal_requests")
    .update({
      status: "failed",
      failure_reason: reason,
      valr_response: valrResponse ?? { error: reason },
      processed_at: new Date().toISOString(),
    })
    .eq("request_id", row.request_id);

  await logAlert(sbLthPvr, "ef_process_withdrawal_queue", "error",
    `Withdrawal ${row.request_id} failed: ${reason}`,
    {
      request_id: row.request_id,
      customer_id: row.customer_id,
      currency: row.currency,
      queue_attempts: row.queue_attempts,
    },
    ORG_ID, row.customer_id);

  if (ctx?.email) {
    try {
      const tmpl = getWithdrawalOutcomeEmail(
        ctx.firstName, row.currency,
        Number(row.net_amount ?? row.amount_usdt ?? row.amount_zar ?? 0),
        "failed", undefined, reason,
      );
      await sendEmail({
        to: ctx.email, from: FROM_EMAIL,
        subject: "Withdrawal Failed — BitWealth",
        html: tmpl.html, text: tmpl.text,
      });
    } catch (e) {
      console.warn("Failure email send error:", (e as Error).message);
    }
  }
}

async function bumpAttempt(row: Row) {
  await sbLthPvr
    .from("withdrawal_requests")
    .update({
      queue_attempts: (row.queue_attempts ?? 0) + 1,
      dispatched_at: row.dispatched_at ?? new Date().toISOString(),
    })
    .eq("request_id", row.request_id);
}

// ────────────────────────────────────────────────────────────────────────────
// Crypto path: pending → paying_out via VALR cryptoWithdraw
async function processCryptoPending(row: Row, ctx: CustomerCtx) {
  const amount = Number(row.amount_usdt ?? 0);
  if (!row.withdrawal_address || amount <= 0) {
    return await markFailed(row, ctx, "Missing withdrawal_address or amount");
  }
  try {
    const wdRes: any = TEST_MODE
      ? { id: `test-crypto-${row.request_id}` }
      : await cryptoWithdraw(
          row.currency,
          amount.toFixed(row.currency === "BTC" ? 8 : 2),
          row.withdrawal_address,
          ctx.subaccountId,
          ctx.creds,
        );
    const valrWithdrawalId: string | undefined = wdRes?.id ?? wdRes?.withdrawalId;
    await markPayingOut(row, valrWithdrawalId, { source_asset: row.currency });
    console.log(`✅ ${row.currency} withdraw dispatched: ${row.request_id} (valr=${valrWithdrawalId})`);
  } catch (e) {
    await markFailed(row, ctx, (e as Error).message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ZAR path step 1: pending → converting (place sell orders)
async function processZarPending(row: Row, ctx: CustomerCtx, trace: string[]) {
  trace.push(`zar_pending:start targetZar=${row.amount_zar}`);
  const targetZar = Number(row.amount_zar ?? 0);
  if (!ctx.bankValrId || targetZar <= 0) {
    trace.push(`zar_pending:missing_bank_or_amount bank=${ctx.bankValrId} target=${targetZar}`);
    return await markFailed(row, ctx, "Missing bank_valr_id or amount_zar");
  }

  // 1. Live rates
  let usdtzar: number, btczar: number, btcUsdtBid: number;
  try {
    usdtzar = TEST_MODE ? 18.5 : await getMarketPrice("USDTZAR");
    btczar  = TEST_MODE ? 1_350_000 : await getMarketPrice("BTCZAR");
    btcUsdtBid = btczar / usdtzar;
    void btcUsdtBid;
    trace.push(`zar_pending:rates usdtzar=${usdtzar} btczar=${btczar}`);
  } catch (e) {
    trace.push(`zar_pending:rate_fetch_failed ${(e as Error).message}`);
    return await markFailed(row, ctx, `Rate fetch failed: ${(e as Error).message}`);
  }

  // 2. Live withdrawable balance (USDT/BTC)
  const { data: bal, error: balErr } = await sbLthPvr
    .rpc("get_withdrawable_balance", { p_customer_id: row.customer_id });
  if (balErr) trace.push(`zar_pending:bal_rpc_err ${balErr.message}`);
  const b = Array.isArray(bal) ? bal[0] : bal;
  const availUsdt = Number(b?.withdrawable_usdt ?? 0);
  const availBtc  = Number(b?.withdrawable_btc ?? 0);
  trace.push(`zar_pending:bal availUsdt=${availUsdt} availBtc=${availBtc}`);

  // 3. Compute split: USDT first, BTC for shortfall
  const convFeeRate = Number(row.valr_conversion_fee_usdt ?? 0) > 0 ? 0.0018 : 0.0018;
  const usdtZarCovered = availUsdt * usdtzar; // gross ZAR achievable from selling all USDT
  const usdtToSellZar  = Math.min(targetZar, usdtZarCovered);
  const btcToSellZar   = Math.max(0, targetZar - usdtToSellZar);

  const usdtToSell = usdtToSellZar > 0 ? (usdtToSellZar / usdtzar) * (1 + convFeeRate) : 0;
  const btcToSell  = btcToSellZar  > 0 ? btcToSellZar / btczar : 0;

  if (btcToSell > 0 && btcToSell > availBtc) {
    trace.push(`zar_pending:insufficient_btc need=${btcToSell} have=${availBtc}`);
    return await markFailed(row, ctx,
      `Insufficient BTC after USDT exhaustion: need ${btcToSell.toFixed(8)} BTC, have ${availBtc.toFixed(8)}`);
  }

  // NOTE: wr_source_asset_check constraint currently does NOT include 'BTC+USDT'.
  // For mixed sales we record 'BTC' (the leg that determines settlement timing) and
  // rely on usdt_sold / btc_sold columns to capture the true split.
  // TODO: once migration to extend the check constraint is applied, restore 'BTC+USDT'.
  const sourceAsset = btcToSell > 0 ? "BTC" : "USDT";
  const sourceAsset = btcToSell > 0
    ? (usdtToSell > 0 ? "BTC+USDT" : "BTC")
    : "USDT";
  trace.push(`zar_pending:split usdtToSell=${usdtToSell} btcToSell=${btcToSell} src=${sourceAsset}`);

  // 4. Place LIMIT SELL orders at best bid.
  // CRITICAL idempotency rule: each leg's customerOrderId is deterministic
  // (`wd-usdt-{request_id}` / `wd-btc-{request_id}`). Before placing we probe
  // VALR's order summary by customerOrderId; if it already exists we reuse it
  // instead of double-placing. Each placed order is persisted IMMEDIATELY so
  // that even if the next step fails the row carries the order ID and the next
  // tick will pick it up via processZarConverting.

  // Persist source_asset + initial converting state up front so that even a
  // crash mid-way leaves the row in a recoverable state.
  await sbLthPvr
    .from("withdrawal_requests")
    .update({ status: "converting", conversion_status: "limit_placed", source_asset: sourceAsset })
    .eq("request_id", row.request_id);

  if (usdtToSell > 0) {
    const customerOrderId = `wd-usdt-${row.request_id}`;
    let orderId: string | null = row.conversion_order_id_usdt ?? null;
    if (!orderId) {
      // Idempotency probe: did a previous tick already place this leg?
      try {
        const existing: any = await getOrderSummaryByCustomerOrderId(customerOrderId, "USDTZAR", ctx.subaccountId, ctx.creds);
        if (existing?.orderId || existing?.id) {
          orderId = existing.orderId ?? existing.id;
          trace.push(`zar_pending:usdt_already_exists id=${orderId} status=${existing.orderStatusType}`);
        }
      } catch { /* 404 = doesn't exist, continue to place */ }
    }
    if (!orderId) {
      try {
        const book = await getOrderBook("USDTZAR");
        const bid  = Number(book.Bids?.[0]?.price);
        if (!bid || bid <= 0) throw new Error("USDTZAR no bid");
        const res: any = TEST_MODE
          ? { id: `test-usdt-${row.request_id}` }
          : await placeLimitOrder(
              { side: "SELL", pair: "USDTZAR", price: bid.toFixed(4), quantity: usdtToSell.toFixed(6), customerOrderId },
              ctx.subaccountId, ctx.creds);
        orderId = (res?.id ?? res?.orderId ?? customerOrderId);
        trace.push(`zar_pending:usdt_order_placed id=${orderId}`);
      } catch (e) {
        trace.push(`zar_pending:usdt_order_failed ${(e as Error).message}`);
        return await markFailed(row, ctx, `USDTZAR limit order failed: ${(e as Error).message}`);
      }
    }
    // Persist order id IMMEDIATELY before placing the next leg.
    await sbLthPvr
      .from("withdrawal_requests")
      .update({ conversion_order_id_usdt: orderId })
      .eq("request_id", row.request_id);
  }

  if (btcToSell > 0) {
    const customerOrderId = `wd-btc-${row.request_id}`;
    let orderId: string | null = row.conversion_order_id_btc ?? null;
    if (!orderId) {
      try {
        const existing: any = await getOrderSummaryByCustomerOrderId(customerOrderId, "BTCZAR", ctx.subaccountId, ctx.creds);
        if (existing?.orderId || existing?.id) {
          orderId = existing.orderId ?? existing.id;
          trace.push(`zar_pending:btc_already_exists id=${orderId} status=${existing.orderStatusType}`);
        }
      } catch { /* 404 = doesn't exist, continue to place */ }
    }
    if (!orderId) {
      try {
        const book = await getOrderBook("BTCZAR");
        const bid  = Number(book.Bids?.[0]?.price);
        if (!bid || bid <= 0) throw new Error("BTCZAR no bid");
        const res: any = TEST_MODE
          ? { id: `test-btc-${row.request_id}` }
          : await placeLimitOrder(
              { side: "SELL", pair: "BTCZAR", price: bid.toFixed(2), quantity: btcToSell.toFixed(8), customerOrderId },
              ctx.subaccountId, ctx.creds);
        orderId = (res?.id ?? res?.orderId ?? customerOrderId);
        trace.push(`zar_pending:btc_order_placed id=${orderId}`);
      } catch (e) {
        trace.push(`zar_pending:btc_order_failed ${(e as Error).message}`);
        return await markFailed(row, ctx, `BTCZAR limit order failed: ${(e as Error).message}`);
      }
    }
    await sbLthPvr
      .from("withdrawal_requests")
      .update({ conversion_order_id_btc: orderId })
      .eq("request_id", row.request_id);
  }

  trace.push(`zar_pending:done`);
  console.log(`🔄 ZAR withdrawal converting: ${row.request_id} (USDT=${usdtToSell.toFixed(6)}, BTC=${btcToSell.toFixed(8)})`);
}

// ZAR path step 2: converting → paying_out (check fills, dispatch fiat withdraw)
async function processZarConverting(row: Row, ctx: CustomerCtx) {
  if (!ctx.bankValrId) return await markFailed(row, ctx, "Missing bank_valr_id at converting stage");

  const checkLeg = async (
    customerOrderId: string | null,
    pair: string,
  ): Promise<{ filled: boolean; fillQty?: number; fillPrice?: number; status?: string; valrOrderId?: string }> => {
    if (!customerOrderId) return { filled: true };
    if (TEST_MODE) return { filled: true, fillQty: 0, fillPrice: 0 };
    try {
      const summary: any = await getOrderSummaryByCustomerOrderId(customerOrderId, pair, ctx.subaccountId, ctx.creds);
      const status: string = summary?.orderStatusType ?? "";
      const valrOrderId: string = summary?.orderId ?? summary?.id;
      if (status === "Filled") {
        return {
          filled: true,
          fillQty: Number(summary.originalQuantity ?? summary.quantity ?? 0),
          fillPrice: Number(summary.averagePrice ?? summary.price ?? 0),
          valrOrderId,
        };
      }
      if (status === "Cancelled" || status === "Failed") {
        return { filled: false, status };
      }
      return { filled: false, status };
    } catch (e) {
      console.warn("Order status check failed:", (e as Error).message);
      return { filled: false };
    }
  };

  const usdtRes = await checkLeg(row.conversion_order_id_usdt ? `wd-usdt-${row.request_id}` : null, "USDTZAR");
  const btcRes  = await checkLeg(row.conversion_order_id_btc  ? `wd-btc-${row.request_id}`  : null, "BTCZAR");

  // Hard failure if either leg was cancelled/failed externally
  if (usdtRes.status === "Cancelled" || usdtRes.status === "Failed" ||
      btcRes.status  === "Cancelled" || btcRes.status  === "Failed") {
    return await markFailed(row, ctx, `Conversion order rejected by VALR (USDT=${usdtRes.status ?? "n/a"}, BTC=${btcRes.status ?? "n/a"})`);
  }

  // Both filled → dispatch ZAR fiat withdrawal
  if (usdtRes.filled && btcRes.filled) {
    const zarFromUsdt = (usdtRes.fillQty ?? 0) * (usdtRes.fillPrice ?? 0);
    const zarFromBtc  = (btcRes.fillQty  ?? 0) * (btcRes.fillPrice  ?? 0);
    const grossZar    = zarFromUsdt + zarFromBtc;
    const netZar      = Number(row.amount_zar ?? 0) - Number(row.valr_withdrawal_fee_zar ?? 0);
    // Use the smaller of (grossZar - fees, requested netZar) so we never overdraw
    const payoutZar   = Math.min(grossZar - Number(row.valr_withdrawal_fee_zar ?? 0), netZar);
    if (payoutZar <= 0) {
      return await markFailed(row, ctx, `Computed payout amount is non-positive (gross=${grossZar.toFixed(2)})`);
    }

    try {
      const fast = ctx.withdrawalType === "fast";
      const wdRes: any = TEST_MODE
        ? { id: `test-zar-${row.request_id}` }
        : await zarWithdraw(ctx.bankValrId, payoutZar.toFixed(2), fast, ctx.subaccountId, ctx.creds);
      await markPayingOut(row, wdRes?.id ?? wdRes?.withdrawalId, {
        usdt_sold:                usdtRes.fillQty ?? 0,
        btc_sold:                 btcRes.fillQty  ?? 0,
        zar_received_from_usdt:   zarFromUsdt,
        zar_received_from_btc:    zarFromBtc,
        conversion_status:        "filled",
      });
      console.log(`💸 ZAR withdraw dispatched: ${row.request_id} R${payoutZar.toFixed(2)}`);
    } catch (e) {
      await markFailed(row, ctx, `ZAR fiat withdraw failed: ${(e as Error).message}`);
    }
    return;
  }

  // Not all filled. Decide whether to fall back to market.
  const attemptsAfterDispatch = (row.queue_attempts ?? 0) + 1;
  if (attemptsAfterDispatch >= MARKET_FALLBACK_AFTER_ATTEMPTS) {
    console.log(`⏱️  Market fallback for ${row.request_id} (attempt ${attemptsAfterDispatch})`);
    if (!usdtRes.filled && row.conversion_order_id_usdt) {
      try {
        if (!TEST_MODE) await cancelOrderById(String(row.conversion_order_id_usdt), "USDTZAR", ctx.subaccountId, ctx.creds);
        // Estimate USDT to sell from original split (re-use stored fields if absent: from rate × amount_zar share)
        const usdtZarRate = TEST_MODE ? 18.5 : await getMarketPrice("USDTZAR");
        const targetZar   = Number(row.amount_zar ?? 0);
        const availUsdt   = Math.max(targetZar / usdtZarRate, 0); // approximation; market order tries by base qty
        if (!TEST_MODE) {
          await placeMarketOrder("USDTZAR", "SELL", availUsdt.toFixed(6), `wd-usdt-mkt-${row.request_id}`, ctx.subaccountId, ctx.creds);
        }
      } catch (e) {
        return await markFailed(row, ctx, `USDTZAR market fallback failed: ${(e as Error).message}`);
      }
    }
    if (!btcRes.filled && row.conversion_order_id_btc) {
      try {
        if (!TEST_MODE) await cancelOrderById(String(row.conversion_order_id_btc), "BTCZAR", ctx.subaccountId, ctx.creds);
        const btczar  = TEST_MODE ? 1_350_000 : await getMarketPrice("BTCZAR");
        const targetZar = Number(row.amount_zar ?? 0);
        const btcQty  = Math.max(targetZar / btczar, 0);
        if (!TEST_MODE) {
          await placeMarketOrder("BTCZAR", "SELL", btcQty.toFixed(8), `wd-btc-mkt-${row.request_id}`, ctx.subaccountId, ctx.creds);
        }
      } catch (e) {
        return await markFailed(row, ctx, `BTCZAR market fallback failed: ${(e as Error).message}`);
      }
    }
    // Stay in 'converting'; next tick will re-check using customerOrderIds
    // (note: market order customerOrderId differs — we'll need to update conversion_order_id_*)
    const upd: Record<string, unknown> = {};
    if (!usdtRes.filled && row.conversion_order_id_usdt) upd.conversion_order_id_usdt = `wd-usdt-mkt-${row.request_id}`;
    if (!btcRes.filled  && row.conversion_order_id_btc)  upd.conversion_order_id_btc  = `wd-btc-mkt-${row.request_id}`;
    if (Object.keys(upd).length > 0) {
      await sbLthPvr.from("withdrawal_requests").update(upd).eq("request_id", row.request_id);
    }
  } else {
    console.log(`⌛ ${row.request_id} still converting (USDT=${usdtRes.filled}, BTC=${btcRes.filled}, attempt=${attemptsAfterDispatch})`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Pull rows that need processing
  const { data: rows, error } = await sbLthPvr
    .from("withdrawal_requests")
    .select(
      "request_id, org_id, customer_id, currency, amount_usdt, amount_zar, withdrawal_address, status, source_asset, " +
      "conversion_order_id_usdt, conversion_order_id_btc, usdt_sold, btc_sold, zar_received_from_usdt, zar_received_from_btc, " +
      "valr_conversion_fee_usdt, valr_withdrawal_fee_zar, net_amount, queue_attempts, dispatched_at"
    )
    .eq("org_id", ORG_ID)
    .in("status", ["pending", "converting"])
    .order("requested_at", { ascending: true })
    .limit(50);

  if (error) {
    console.error("Queue query failed:", error.message);
    return json({ success: false, error: error.message }, 500);
  }

  const results = { processed: 0, failed: 0, skipped: 0, details: [] as unknown[] };

  for (const row of (rows ?? []) as Row[]) {
    // Hard retry cap: if a row keeps re-entering the queue without progressing
    // (e.g. silent DB failure), auto-fail it so we never retry-loop and
    // accidentally place duplicate exchange orders.
    const MAX_QUEUE_ATTEMPTS = 6;
    if ((row.queue_attempts ?? 0) >= MAX_QUEUE_ATTEMPTS) {
      await sbLthPvr
        .from("withdrawal_requests")
        .update({
          status: "failed",
          failure_reason: `Auto-failed after ${row.queue_attempts} queue attempts without progress`,
          processed_at: new Date().toISOString(),
        })
        .eq("request_id", row.request_id);
      await logAlert(sbLthPvr, "ef_process_withdrawal_queue", "critical",
        `Withdrawal ${row.request_id} auto-failed after ${row.queue_attempts} attempts`,
        { request_id: row.request_id, customer_id: row.customer_id, status: row.status, queue_attempts: row.queue_attempts },
        ORG_ID, row.customer_id);
      results.failed++;
      results.details.push({ request_id: row.request_id, outcome: "retry_cap_exceeded" });
      continue;
    }

    const ctx = await loadCustomerCtx(row);
    if (!ctx) {
      results.failed++;
      results.details.push({ request_id: row.request_id, outcome: "ctx_load_failed" });
      continue;
    }

    await bumpAttempt(row);

    try {
      if (row.currency === "BTC" || row.currency === "USDT") {
        if (row.status === "pending") {
          await processCryptoPending(row, ctx);
          results.processed++;
        } else {
          // Crypto rows shouldn't sit in 'converting'; treat as no-op
          results.skipped++;
        }
      } else if (row.currency === "ZAR") {
        const trace: string[] = [];
        if (row.status === "pending")        await processZarPending(row, ctx, trace);
        else if (row.status === "converting") await processZarConverting(row, ctx);
        results.processed++;
        results.details.push({ request_id: row.request_id, currency: row.currency, prior_status: row.status, trace });
        continue;
      } else {
        results.skipped++;
      }
    } catch (e) {
      await markFailed(row, ctx, `Unhandled queue exception: ${(e as Error).message}`);
      results.failed++;
    }

    results.details.push({ request_id: row.request_id, currency: row.currency, prior_status: row.status });
  }

  return json({ success: true, results });
});
