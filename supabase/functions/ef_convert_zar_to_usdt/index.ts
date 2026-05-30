// Edge Function: ef_convert_zar_to_usdt (EF9)
// Purpose: Admin-triggered conversion of a pending ZAR deposit into USDT.
//          Reads a pending_zar_conversions row, places a USDTZAR BUY LIMIT order
//          on behalf of the customer, polls for fill (up to 2 min), then falls back
//          to a MARKET order if not filled.
//
// Auth: --no-verify-jwt (admin or cron triggered)
// Request body: { "conversion_id": "<uuid>" }
//
// Limit → 2-min poll (5 s intervals) → cancel + MARKET fallback
// Pair: USDTZAR BUY  (spending ZAR, receiving USDT)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import {
  getOrderBook,
  placeLimitOrder,
} from "../_shared/valrClient.ts";
import { logAlert } from "../_shared/alerting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");
const TEST_MODE = Deno.env.get("VALR_TEST_MODE") === "true";

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "lth_pvr" } });

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let conversion_id: string;
  try {
    ({ conversion_id } = await req.json());
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!conversion_id) return json({ error: "conversion_id required" }, 400);

  // ── 1. Fetch pending conversion record ─────────────────────────────────────
  const { data: conv, error: convErr } = await sb
    .from("pending_zar_conversions")
    .select("*")
    .eq("id", conversion_id)
    .eq("org_id", ORG_ID)
    .single();

  if (convErr || !conv) {
    return json({ error: "Conversion not found" }, 404);
  }

  if (conv.status !== "pending") {
    return json({ error: `Conversion is already '${conv.status}' — cannot re-execute` }, 400);
  }

  const zarAmount = Number(conv.remaining_amount ?? conv.zar_amount);
  if (!zarAmount || zarAmount <= 0) {
    return json({ error: "No remaining ZAR amount to convert" }, 400);
  }

  const customerId: number = conv.customer_id;

  // ── 2. Resolve customer VALR credentials ───────────────────────────────────
  let creds: { apiKey: string; apiSecret: string } | null = null;
  let subaccountId: string | null = null;
  try {
    const resolved = await resolveCustomerCredentials(sb, customerId);
    creds = { apiKey: resolved.apiKey, apiSecret: resolved.apiSecret };
    subaccountId = resolved.subaccountId;
  } catch (e) {
    await logAlert(sb, "ef_convert_zar_to_usdt", "error", `Credential failure: ${e.message}`, { conversion_id, customerId }, ORG_ID, customerId);
    return json({ error: "Failed to resolve customer credentials" }, 500);
  }

  // ── 3. Get USDTZAR best bid price ──────────────────────────────────────────
  // We price the BUY at the best BID (not ask) so the order rests in the book
  // as a MAKER. Posting at/above the ask would lift the offer immediately and
  // get charged the TAKER fee (~0.35% on USDTZAR) instead of the MAKER fee
  // (~0.18%). If the maker order doesn't fill within the 2-min poll window,
  // step 8 cancels it and falls back to a MARKET (taker) order.
  const pair = "USDTZAR";
  let bestBid: number;
  try {
    const book = await getOrderBook(pair);
    bestBid = Number(book.Bids[0]?.price);
    if (!bestBid || bestBid <= 0) throw new Error("No bid in order book");
  } catch (e) {
    await logAlert(sb, "ef_convert_zar_to_usdt", "error", `Order book fetch failed: ${e.message}`, { conversion_id }, ORG_ID, customerId);
    return json({ error: "Failed to fetch USDTZAR order book" }, 502);
  }

  // ── 4. Calculate LIMIT order quantities ────────────────────────────────────
  // USDTZAR BUY: spending ZAR, receiving USDT
  // quantity = USDT to receive = ZAR_amount / bid_price
  // VALR USDTZAR pair specs: tickSize=0.0001 (price 4dp), baseDecimalPlaces=4 (qty 4dp).
  // We must round the quantity DOWN so qty * price never exceeds the available ZAR
  // (otherwise VALR rejects with "Insufficient balance").
  const limitPrice = bestBid;
  const qtyUsdtRaw = zarAmount / limitPrice;
  const qtyUsdt = Math.floor(qtyUsdtRaw * 1e4) / 1e4; // round down to 4 dp
  const priceStr = limitPrice.toFixed(4);
  const qtyStr = qtyUsdt.toFixed(4);

  console.log(`ZAR ${zarAmount} ÷ ${priceStr} (bid, postOnly) = ${qtyStr} USDT (raw ${qtyUsdtRaw.toFixed(8)})`);

  // ── 5. Place LIMIT BUY postOnly (or mock in test mode) ────────────────────
  // postOnly:true → VALR rejects the order rather than crossing the spread,
  // guaranteeing the maker fee tier when it fills. If placement fails (e.g.
  // bid == ask, book moved), we fall straight through to the MARKET fallback
  // in step 8 instead of aborting the conversion.
  const customerOrderId = `zar-conv-${conversion_id}`;
  let limitOrderId: string | undefined;
  let limitPlaced = false;

  if (TEST_MODE) {
    console.log("TEST_MODE: skipping LIMIT order placement");
    limitPlaced = true;
  } else {
    try {
      const orderRes: any = await placeLimitOrder(
        {
          side: "BUY",
          pair,
          price: priceStr,
          quantity: qtyStr,
          customerOrderId,
          timeInForce: "GTC",
          postOnly: true,
        },
        subaccountId,
        creds,
      );
      limitOrderId = orderRes?.id ?? orderRes?.orderId;
      limitPlaced = true;
    } catch (e) {
      // Don't abort — log and let the MARKET fallback below handle it.
      console.warn(`postOnly LIMIT placement failed, will fall back to MARKET: ${e.message}`);
      await logAlert(
        sb,
        "ef_convert_zar_to_usdt",
        "warn",
        `postOnly LIMIT placement failed; using MARKET fallback: ${e.message}`,
        { conversion_id, zarAmount, priceStr, qtyStr },
        ORG_ID,
        customerId,
      );
    }
  }

  // ── 6. Persist state and return immediately ───────────────────────────────
  // This function no longer blocks waiting for the fill. A single HTTP-invoked
  // edge function must respond within Supabase's 150 s request-idle timeout, so
  // a 5-minute maker-order window is impossible synchronously. Instead we record
  // the placed LIMIT (or flag for an immediate MARKET if placement failed) and
  // return; the cron-driven poller `ef_poll_zar_conversions` then:
  //   • watches the resting LIMIT for a fill,
  //   • after 5 minutes stale OR a 0.25% adverse upward move, cancels it
  //     (confirming the cancel) and places a MARKET order,
  //   • records the fill into pending_zar_conversions + exchange_orders.
  const nowIso = new Date().toISOString();

  if (TEST_MODE) {
    // Simulate instant fill so admin tests don't depend on the poller.
    await sb
      .from("pending_zar_conversions")
      .update({
        status: "filled",
        order_id: customerOrderId,
        pair,
        order_side: "BUY",
        limit_price: limitPrice,
        order_type: "limit",
        converted_amount: qtyUsdt,
        remaining_amount: 0,
        converted_at: nowIso,
        limit_placed_at: nowIso,
      })
      .eq("id", conversion_id);
    return json({ success: true, conversion_id, status: "filled", converted_usdt: qtyUsdt, fill_price: limitPrice });
  }

  if (limitPlaced) {
    await sb
      .from("pending_zar_conversions")
      .update({
        status: "limit_placed",
        order_id: limitOrderId ?? customerOrderId,
        pair,
        order_side: "BUY",
        limit_price: limitPrice,
        order_type: "limit",
        limit_placed_at: nowIso,
        error_message: null,
      })
      .eq("id", conversion_id);

    return json({
      success: true,
      conversion_id,
      status: "limit_placed",
      limit_order_id: limitOrderId ?? customerOrderId,
      limit_price: limitPrice,
      qty_usdt: qtyUsdt,
      message: "Limit order placed. The poller will fill it or fall back to MARKET after 5 minutes / on a 0.25% adverse move.",
    });
  }

  // postOnly placement was rejected (e.g. bid == ask). Flag for an immediate
  // MARKET order — the poller picks up 'market_pending' rows on its next run.
  await sb
    .from("pending_zar_conversions")
    .update({
      status: "market_pending",
      pair,
      order_side: "BUY",
      limit_price: limitPrice,
      order_type: "market",
      limit_placed_at: null,
      error_message: null,
    })
    .eq("id", conversion_id);

  return json({
    success: true,
    conversion_id,
    status: "market_pending",
    message: "Limit placement rejected; queued for MARKET order on the next poller run.",
  });
});

