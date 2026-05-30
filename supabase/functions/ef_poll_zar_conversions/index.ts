// Edge Function: ef_poll_zar_conversions
// Purpose: Async poller/finisher for admin-triggered ZAR→USDT conversions.
//          ef_convert_zar_to_usdt places a post-only LIMIT and returns immediately
//          (it cannot block 5 minutes — Supabase returns 504 after a 150 s
//          request-idle timeout). This cron-driven function then drives each
//          conversion to completion:
//
//   status='limit_placed'  → watch the resting LIMIT. Fill → record. After 5 min
//                            stale OR a 0.25% adverse upward move on the best bid,
//                            cancel (confirm gone) → 'market_pending'.
//   status='market_pending'→ place a MARKET BUY (quoteAmount = remaining ZAR) → 'market_placed'.
//   status='market_placed' → confirm the MARKET fill → record, else surface failure.
//
// Auth: --no-verify-jwt (cron triggered, runs every minute).
// Idempotent + per-row try/catch so one bad row never blocks the batch.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import {
  getOrderBook,
  getOpenOrders,
  getOrderSummaryByCustomerOrderId,
  placeMarketOrderByQuote,
  cancelOrderById,
} from "../_shared/valrClient.ts";
import { logAlert } from "../_shared/alerting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "lth_pvr" } });

const STALE_LIMIT_MS  = 5 * 60 * 1000; // 5 min before LIMIT → MARKET fallback
const PRICE_MOVE_LIMIT = 0.0025;       // 0.25% adverse upward bid move triggers early cancel

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type Creds = { apiKey: string; apiSecret: string };

interface Conversion {
  id: string;
  customer_id: number;
  zar_amount: number | string;
  remaining_amount: number | string | null;
  status: string;
  order_id: string | null;
  pair: string | null;
  limit_price: number | string | null;
  limit_placed_at: string | null;
}

// ── Record a completed conversion: pending row → 'filled' + exchange_orders row ──
async function recordFill(
  conv: Conversion,
  pair: string,
  valrOrderId: string,
  fillPrice: number,
  fillQty: number,
  orderType: "limit" | "market",
  customerOrderId: string,
) {
  await sb
    .from("pending_zar_conversions")
    .update({
      status: "filled",
      converted_amount: fillQty,
      remaining_amount: 0,
      converted_at: new Date().toISOString(),
      order_id: valrOrderId,
      order_type: orderType,
      error_message: null,
    })
    .eq("id", conv.id);

  // Best-effort exchange_orders audit row. The actual balance credit happens via
  // ef_sync_valr_transactions when it polls VALR history.
  try {
    const { data: ea } = await sb
      .schema("public")
      .from("customer_strategies")
      .select("exchange_account_id")
      .eq("customer_id", conv.customer_id)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    const exchangeAccountId = ea?.exchange_account_id;
    if (exchangeAccountId) {
      await sb.from("exchange_orders").insert({
        org_id: ORG_ID,
        exchange_account_id: exchangeAccountId,
        ext_order_id: valrOrderId,
        pair,
        side: "BUY",
        price: fillPrice,
        qty: fillQty,
        status: "filled",
        submitted_at: new Date().toISOString(),
        raw: {
          source: "ef_poll_zar_conversions",
          customer_order_id: customerOrderId,
          customer_id: conv.customer_id,
          order_type: orderType,
          fill_price: fillPrice,
          zar_amount: Number(conv.zar_amount),
          conversion_id: conv.id,
        },
      });
    }
  } catch (e) {
    console.warn(`[${conv.id}] exchange_orders insert failed:`, (e as Error).message);
  }
}

function fillQtyFromSummary(s: any): number {
  return Number(s?.totalExecutedQuantity ?? s?.originalQuantity ?? s?.quantity ?? 0);
}
function fillPriceFromSummary(s: any, fallback: number): number {
  const p = Number(s?.averagePrice ?? s?.price ?? 0);
  return p > 0 ? p : fallback;
}

// ── Handle a 'limit_placed' conversion ──────────────────────────────────────
async function handleLimitPlaced(conv: Conversion, subaccountId: string | null, creds: Creds) {
  const pair = conv.pair ?? "USDTZAR";
  const customerOrderId = `zar-conv-${conv.id}`;
  const limitPrice = Number(conv.limit_price);

  // Is our LIMIT still resting?
  let stillOpen = false;
  try {
    const open: any = await getOpenOrders(subaccountId, creds);
    stillOpen = Array.isArray(open) &&
      open.some((o: any) => o.orderId === conv.order_id || o.customerOrderId === customerOrderId);
  } catch (e) {
    console.warn(`[${conv.id}] getOpenOrders failed: ${(e as Error).message}`);
    return; // try again next run
  }

  if (!stillOpen) {
    // The order left the book — it either filled or was cancelled. Check history.
    let summary: any = null;
    try {
      summary = await getOrderSummaryByCustomerOrderId(customerOrderId, pair, subaccountId, creds);
    } catch (_) { /* history may lag; retry next run */ }

    const status = summary?.orderStatusType;
    if (status === "Filled") {
      const qty = fillQtyFromSummary(summary);
      const price = fillPriceFromSummary(summary, limitPrice);
      await recordFill(conv, pair, summary.orderId ?? conv.order_id ?? customerOrderId, price, qty, "limit", customerOrderId);
      console.log(`[${conv.id}] LIMIT filled: ${qty} USDT @ ${price}`);
      return;
    }
    if (status === "Cancelled" || status === "Failed") {
      // Externally cancelled/failed — fall back to MARKET.
      await sb.from("pending_zar_conversions").update({ status: "market_pending", order_type: "market" }).eq("id", conv.id);
      console.log(`[${conv.id}] LIMIT ${status} → market_pending`);
      return;
    }
    // Unknown / history lag — leave as-is and retry next run.
    return;
  }

  // Still resting — check the 5-min timeout and adverse-move conditions.
  const placedAt = conv.limit_placed_at ? new Date(conv.limit_placed_at).getTime() : 0;
  const stale = placedAt > 0 && (Date.now() - placedAt) >= STALE_LIMIT_MS;

  let adverse = false;
  try {
    const book = await getOrderBook(pair);
    const currentBid = Number(book.Bids[0]?.price);
    // Adverse = best bid has risen > 0.25% above our resting price (market running
    // away → our maker order will never fill). Same-side comparison: comparing the
    // ASK here would just measure the static bid-ask spread and fire falsely.
    if (currentBid > 0 && limitPrice > 0 && (currentBid - limitPrice) / limitPrice > PRICE_MOVE_LIMIT) {
      adverse = true;
      console.log(`[${conv.id}] best bid +${(((currentBid - limitPrice) / limitPrice) * 100).toFixed(2)}% above limit`);
    }
  } catch (_) { /* non-fatal */ }

  if (!stale && !adverse) return; // keep waiting

  // Cancel the resting LIMIT and CONFIRM it is gone before flagging for MARKET.
  // VALR locks the ZAR while the post-only LIMIT rests, so a MARKET BUY before the
  // cancel settles fails with "Insufficient Balance".
  if (conv.order_id) {
    try {
      await cancelOrderById(conv.order_id, pair, subaccountId, creds);
    } catch (e) {
      console.warn(`[${conv.id}] cancel request failed: ${(e as Error).message}`);
    }
  }
  let cancelConfirmed = false;
  for (let r = 0; r < 6; r++) {
    await sleep(r === 0 ? 1_500 : 2_000);
    try {
      const open: any = await getOpenOrders(subaccountId, creds);
      const open2 = Array.isArray(open) &&
        open.some((o: any) => o.orderId === conv.order_id || o.customerOrderId === customerOrderId);
      if (!open2) { cancelConfirmed = true; break; }
    } catch (_) { /* retry */ }
  }

  if (!cancelConfirmed) {
    // Leave as limit_placed and retry next run rather than risk a double order.
    await logAlert(
      sb, "ef_poll_zar_conversions", "warn",
      "Could not confirm LIMIT cancellation; will retry next run",
      { conversion_id: conv.id, customer_id: conv.customer_id, order_id: conv.order_id },
      ORG_ID, conv.customer_id,
    );
    return;
  }

  await sb.from("pending_zar_conversions").update({ status: "market_pending", order_type: "market" }).eq("id", conv.id);
  console.log(`[${conv.id}] LIMIT cancelled (${stale ? "stale" : "adverse"}) → market_pending`);
}

// ── Handle a 'market_pending' conversion: place the MARKET BUY ───────────────
async function handleMarketPending(conv: Conversion, subaccountId: string | null, creds: Creds) {
  const pair = conv.pair ?? "USDTZAR";
  const zarAmount = Number(conv.remaining_amount ?? conv.zar_amount);
  const mktOrderId = `zar-conv-mkt-${conv.id}`;

  try {
    await placeMarketOrderByQuote(pair, "BUY", zarAmount.toFixed(2), mktOrderId, subaccountId, creds);
  } catch (e) {
    await logAlert(
      sb, "ef_poll_zar_conversions", "error",
      `MARKET order placement failed: ${(e as Error).message}`,
      { conversion_id: conv.id, customer_id: conv.customer_id, zarAmount },
      ORG_ID, conv.customer_id,
    );
    await sb.from("pending_zar_conversions").update({ error_message: `MARKET placement failed: ${(e as Error).message}` }).eq("id", conv.id);
    return;
  }

  await sb
    .from("pending_zar_conversions")
    .update({ status: "market_placed", order_type: "market", order_id: mktOrderId })
    .eq("id", conv.id);
  console.log(`[${conv.id}] MARKET placed for R${zarAmount.toFixed(2)}`);

  // Short opportunistic poll so a fast fill is recorded in the same run.
  await confirmMarketFill(conv, pair, subaccountId, creds, 3);
}

// ── Handle a 'market_placed' conversion: confirm the fill ────────────────────
async function handleMarketPlaced(conv: Conversion, subaccountId: string | null, creds: Creds) {
  const pair = conv.pair ?? "USDTZAR";
  await confirmMarketFill(conv, pair, subaccountId, creds, 1);
}

async function confirmMarketFill(
  conv: Conversion, pair: string, subaccountId: string | null, creds: Creds, rounds: number,
) {
  const mktOrderId = `zar-conv-mkt-${conv.id}`;
  for (let r = 0; r < rounds; r++) {
    if (r > 0) await sleep(3_000);
    let summary: any = null;
    try {
      summary = await getOrderSummaryByCustomerOrderId(mktOrderId, pair, subaccountId, creds);
    } catch (_) { continue; /* history lag */ }
    const status = summary?.orderStatusType;
    if (status === "Filled") {
      const qty = fillQtyFromSummary(summary);
      const price = fillPriceFromSummary(summary, Number(conv.limit_price) || 0);
      await recordFill(conv, pair, summary.orderId ?? mktOrderId, price, qty, "market", mktOrderId);
      console.log(`[${conv.id}] MARKET filled: ${qty} USDT @ ${price}`);
      return;
    }
    if (status === "Failed" || status === "Cancelled") {
      await logAlert(
        sb, "ef_poll_zar_conversions", "error",
        `MARKET order ${status}: ${summary?.failedReason ?? "unknown"}`,
        { conversion_id: conv.id, customer_id: conv.customer_id }, ORG_ID, conv.customer_id,
      );
      await sb.from("pending_zar_conversions")
        .update({ status: "failed", error_message: `MARKET ${status}: ${summary?.failedReason ?? "unknown"}` })
        .eq("id", conv.id);
      return;
    }
  }
  // Still processing — leave 'market_placed' for the next run.
}

Deno.serve(async () => {
  const { data: rows, error } = await sb
    .from("pending_zar_conversions")
    .select("id, customer_id, zar_amount, remaining_amount, status, order_id, pair, limit_price, limit_placed_at")
    .eq("org_id", ORG_ID)
    .in("status", ["limit_placed", "market_pending", "market_placed"]);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const results: Record<string, string> = {};
  for (const conv of (rows ?? []) as Conversion[]) {
    try {
      const resolved = await resolveCustomerCredentials(sb, conv.customer_id);
      const creds: Creds = { apiKey: resolved.apiKey, apiSecret: resolved.apiSecret };
      const subaccountId = resolved.subaccountId;

      if (conv.status === "limit_placed") {
        await handleLimitPlaced(conv, subaccountId, creds);
      } else if (conv.status === "market_pending") {
        await handleMarketPending(conv, subaccountId, creds);
      } else if (conv.status === "market_placed") {
        await handleMarketPlaced(conv, subaccountId, creds);
      }
      results[conv.id] = "ok";
    } catch (e) {
      results[conv.id] = `error: ${(e as Error).message}`;
      await logAlert(
        sb, "ef_poll_zar_conversions", "error",
        `Conversion processing failed: ${(e as Error).message}`,
        { conversion_id: conv.id, customer_id: conv.customer_id, status: conv.status },
        ORG_ID, conv.customer_id,
      );
    }
  }

  return new Response(JSON.stringify({ success: true, processed: (rows ?? []).length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
