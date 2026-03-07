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
  getOrderSummaryByCustomerOrderId,
  placeLimitOrder,
  placeMarketOrderByQuote,
  cancelOrderById,
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── VALR order polling constants ─────────────────────────────────────────────
const POLL_INTERVAL_MS    = 5_000;  // 5 seconds between status checks
const POLL_MAX_ROUNDS     = 24;     // 24 × 5 s = 120 s max before market fallback
const PRICE_MOVE_LIMIT    = 0.0025; // 0.25% adverse price move triggers early cancel

// ── Helpers ───────────────────────────────────────────────────────────────────
type OrderStatus = "Placed" | "Failed" | "Cancelled" | "Filled" | "PartiallFilled" | string;

async function pollUntilFilled(
  customerOrderId: string,
  pair: string,
  limitPrice: number,
  subaccountId: string | null,
  creds: { apiKey: string; apiSecret: string } | null,
): Promise<{ filled: boolean; fillPrice?: number; fillQty?: number; valrOrderId?: string }> {
  for (let round = 0; round < POLL_MAX_ROUNDS; round++) {
    await sleep(POLL_INTERVAL_MS);

    let summary: any;
    try {
      summary = await getOrderSummaryByCustomerOrderId(customerOrderId, pair, subaccountId, creds);
    } catch (e) {
      console.warn(`Poll round ${round + 1}: summary fetch failed — ${e.message}`);
      continue;
    }

    const status: OrderStatus = summary?.orderStatusType;
    console.log(`Poll ${round + 1}/${POLL_MAX_ROUNDS}: ${customerOrderId} → ${status}`);

    if (status === "Filled") {
      return {
        filled: true,
        fillPrice: Number(summary.averagePrice ?? summary.price),
        fillQty: Number(summary.originalQuantity ?? summary.quantity),
        valrOrderId: summary.orderId ?? summary.id,
      };
    }

    if (status === "Cancelled" || status === "Failed") {
      return { filled: false };
    }

    // Check for adverse price move
    if (round % 4 === 0 && round > 0) {
      try {
        const book = await getOrderBook(pair);
        const currentAsk = Number(book.Asks[0]?.price);
        if (currentAsk > 0 && (currentAsk - limitPrice) / limitPrice > PRICE_MOVE_LIMIT) {
          console.log(`Price moved ${((currentAsk - limitPrice) / limitPrice * 100).toFixed(2)}% — cancelling LIMIT`);
          return { filled: false };
        }
      } catch (_) { /* non-fatal */ }
    }
  }

  // Timeout — caller should cancel + market
  return { filled: false };
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

  // ── 3. Get USDTZAR best ask price ──────────────────────────────────────────
  const pair = "USDTZAR";
  let bestAsk: number;
  try {
    const book = await getOrderBook(pair);
    bestAsk = Number(book.Asks[0]?.price);
    if (!bestAsk || bestAsk <= 0) throw new Error("No ask in order book");
  } catch (e) {
    await logAlert(sb, "ef_convert_zar_to_usdt", "error", `Order book fetch failed: ${e.message}`, { conversion_id }, ORG_ID, customerId);
    return json({ error: "Failed to fetch USDTZAR order book" }, 502);
  }

  // ── 4. Calculate LIMIT order quantities ────────────────────────────────────
  // USDTZAR BUY: spending ZAR, receiving USDT
  // quantity = USDT to receive = ZAR_amount / ask_price
  const limitPrice = bestAsk;
  const qtyUsdt = zarAmount / limitPrice;

  console.log(`ZAR ${zarAmount} ÷ ${limitPrice} = ${qtyUsdt.toFixed(6)} USDT`);

  // ── 5. Place LIMIT BUY (or mock in test mode) ─────────────────────────────
  const customerOrderId = `zar-conv-${conversion_id}`;
  let limitOrderId: string | undefined;

  if (TEST_MODE) {
    console.log("TEST_MODE: skipping LIMIT order placement");
  } else {
    try {
      const orderRes: any = await placeLimitOrder(
        {
          side: "BUY",
          pair,
          price: limitPrice.toFixed(4),
          quantity: qtyUsdt.toFixed(6),
          customerOrderId,
          timeInForce: "GTC",
          postOnly: false,
        },
        subaccountId,
        creds,
      );
      limitOrderId = orderRes?.id ?? orderRes?.orderId;
    } catch (e) {
      await logAlert(sb, "ef_convert_zar_to_usdt", "error", `LIMIT order failed: ${e.message}`, { conversion_id, zarAmount }, ORG_ID, customerId);
      return json({ error: `LIMIT order placement failed: ${e.message}` }, 502);
    }
  }

  // ── 6. Update pending_zar_conversions → limit_placed ──────────────────────
  await sb
    .from("pending_zar_conversions")
    .update({
      status: "limit_placed",
      order_id: limitOrderId ?? customerOrderId,
      pair,
      order_side: "BUY",
      limit_price: limitPrice,
      order_type: "limit",
    })
    .eq("id", conversion_id);

  // ── 7. Poll for fill ───────────────────────────────────────────────────────
  let fillResult: { filled: boolean; fillPrice?: number; fillQty?: number; valrOrderId?: string };

  if (TEST_MODE) {
    // Simulate instant fill in test mode
    fillResult = { filled: true, fillPrice: limitPrice, fillQty: qtyUsdt };
  } else {
    fillResult = await pollUntilFilled(customerOrderId, pair, limitPrice, subaccountId, creds);
  }

  // ── 8. Market fallback if not filled ──────────────────────────────────────
  if (!fillResult.filled) {
    // Cancel LIMIT
    if (limitOrderId && !TEST_MODE) {
      try {
        await cancelOrderById(limitOrderId, pair, subaccountId, creds);
      } catch (e) {
        console.warn(`Cancel LIMIT failed: ${e.message}`);
      }
    }

    await sb
      .from("pending_zar_conversions")
      .update({ status: "market_placed", order_type: "market" })
      .eq("id", conversion_id);

    // Place MARKET BUY (quoteAmount = ZAR spend)
    if (!TEST_MODE) {
      try {
        const mktOrderId = `zar-conv-mkt-${conversion_id}`;
        await placeMarketOrderByQuote(pair, "BUY", zarAmount.toFixed(2), mktOrderId, subaccountId, creds);

        // Wait briefly then poll once for market fill
        await sleep(3_000);
        const mktSummary: any = await getOrderSummaryByCustomerOrderId(mktOrderId, pair, subaccountId, creds).catch(() => null);
        if (mktSummary?.orderStatusType === "Filled") {
          fillResult = {
            filled: true,
            fillPrice: Number(mktSummary.averagePrice ?? mktSummary.price),
            fillQty: Number(mktSummary.originalQuantity ?? mktSummary.quantity),
            valrOrderId: mktSummary.orderId ?? mktSummary.id,
          };
        }
      } catch (e) {
        await logAlert(sb, "ef_convert_zar_to_usdt", "error", `MARKET fallback failed: ${e.message}`, { conversion_id }, ORG_ID, customerId);
        return json({ error: `MARKET order failed: ${e.message}` }, 502);
      }
    } else {
      fillResult = { filled: true, fillPrice: limitPrice, fillQty: qtyUsdt };
    }
  }

  // ── 9. Record fill ─────────────────────────────────────────────────────────
  if (fillResult.filled) {
    const convertedUsdt = fillResult.fillPrice != null && fillResult.fillQty != null
      ? fillResult.fillQty
      : qtyUsdt;

    await sb
      .from("pending_zar_conversions")
      .update({
        status: "filled",
        converted_amount: convertedUsdt,
        remaining_amount: 0,
        converted_at: new Date().toISOString(),
        order_id: fillResult.valrOrderId ?? limitOrderId ?? customerOrderId,
      })
      .eq("id", conversion_id);

    // Log to exchange_orders
    await sb.from("exchange_orders").insert({
      org_id: ORG_ID,
      customer_id: customerId,
      pair,
      side: "BUY",
      order_type: "limit",
      quantity: qtyUsdt,
      price: limitPrice,
      status: "filled",
      fill_price: fillResult.fillPrice,
      valr_order_id: fillResult.valrOrderId,
      customer_order_id: customerOrderId,
      source: "ef_convert_zar_to_usdt",
      created_at: new Date().toISOString(),
    }).catch((e: Error) => console.warn("exchange_orders insert failed:", e.message));

    return json({
      success: true,
      conversion_id,
      converted_usdt: convertedUsdt,
      fill_price: fillResult.fillPrice,
    });
  }

  // If still not filled after market attempt
  return json({ error: "Order not filled — manual intervention required" }, 500);
});
