// ef_poll_orders/index.ts
// Poll open VALR orders for each exchange_account and:
// 1) Update status (submitted / filled / cancelled)
// 2) If a LIMIT order is older than 5 minutes OR price moved > 0.25%
//    then cancel it and place a fallback MARKET order for the remaining qty.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getOrderSummaryByCustomerOrderId, cancelOrderById, placeMarketOrder, getMarketPrice } from "./valrClient.ts";
import { logAlert } from "./alerting.ts";

// --- Supabase client (lth_pvr schema) ---
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SECRET_KEY");
const supabase = createClient(supabaseUrl, supabaseKey, {
  db: {
    schema: "lth_pvr"
  }
});
const org_id = Deno.env.get("ORG_ID");

// --- Fallback config ---
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const PRICE_MOVE_THRESHOLD = 0.0025; // 0.25%

// Cache subaccount lookups per exchange_account_id so we don't hit the DB
// repeatedly for the same account within a single run.
const subaccountCache = new Map<string, string | null>();

Deno.serve(async (_req: Request)=>{
  // --- ENHANCED: Support for targeted polling and WebSocket fallback ---
  // Query parameters can specify specific order_ids for targeted polling
  const url = new URL(_req.url);
  const targetOrderIdsParam = url.searchParams.get("order_ids");
  const targetOrderIds = targetOrderIdsParam ? targetOrderIdsParam.split(",") : null;

  // 1) Load open exchange_orders requiring polling
  // If WebSocket monitoring is active, we only poll orders that haven't been updated recently
  let query = supabase
    .from("exchange_orders")
    .select(
      `
      exchange_order_id,
      org_id,
      exchange_account_id,
      intent_id,
      ext_order_id,
      pair,
      side,
      price,
      qty,
      status,
      submitted_at,
      ws_monitored_at,
      last_polled_at,
      poll_count,
      raw
    `,
    )
    .eq("status", "submitted");

  // If specific order_ids provided (targeted polling), filter to those
  if (targetOrderIds && targetOrderIds.length > 0) {
    query = query.in("intent_id", targetOrderIds);
    console.log(`ef_poll_orders: Targeted polling for ${targetOrderIds.length} specific orders`);
  } else {
    // Safety net: only poll orders that haven't been polled in last 2 minutes
    // or never polled, to avoid redundant API calls with WebSocket
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    query = query.or(`last_polled_at.is.null,last_polled_at.lt.${twoMinutesAgo}`);
    console.log("ef_poll_orders: Safety net polling for stale orders");
  }

  const { data: orders, error } = await query;

  if (error) {
    console.error("ef_poll_orders: failed to load exchange_orders", error);
    return new Response(JSON.stringify({
      error: "failed to load exchange_orders"
    }), {
      status: 500
    });
  }
  if (!orders || orders.length === 0) {
    return new Response(JSON.stringify({
      processed: 0
    }), {
      status: 200
    });
  }

  let processed = 0;
  for (const o of (orders ?? [])){

    // Look up VALR subaccount_id for this exchange_account_id from the shared
    // public.exchange_accounts table. We cache lookups per run to avoid
    // hammering the DB when multiple orders share the same account.
    let subaccountId: string | null = null;

    if (subaccountCache.has(o.exchange_account_id)) {
      subaccountId = subaccountCache.get(o.exchange_account_id) ?? null;
    } else {
      const { data: exAcc, error: exErr } = await supabase
        .schema("public")
        .from("exchange_accounts")
        .select("subaccount_id")
        .eq("exchange_account_id", o.exchange_account_id)
        .limit(1)
        .single();

      if (exErr) {
        console.error(
          `ef_poll_orders: exchange_accounts lookup failed for exchange_account_id=${o.exchange_account_id}`,
          exErr,
        );
        continue;
      }

      subaccountId = exAcc?.subaccount_id ?? null;
      subaccountCache.set(o.exchange_account_id, subaccountId);
    }

    if (!subaccountId) {
      console.warn(
        `ef_poll_orders: no subaccount_id for exchange_account_id=${o.exchange_account_id}, skipping`,
      );
      continue;
    }

    const pair = o.pair;
    const side = o.side.toUpperCase();
    let summary;
    try {
      summary = await getOrderSummaryByCustomerOrderId(o.intent_id, pair, subaccountId);

    } catch (err) {
      console.error(`ef_poll_orders: VALR poll failed for customerOrderId (intent_id)=${o.intent_id}`, err);
      await logAlert(
        supabase,
        "ef_poll_orders",
        "warn",
        `Failed to fetch order status from VALR`,
        {
          intent_id: o.intent_id,
          exchange_order_id: o.exchange_order_id,
          ext_order_id: o.ext_order_id,
          error: err instanceof Error ? err.message : String(err)
        },
        org_id
      );
      continue;
    }

    const last = Array.isArray(summary) ? summary[0] : summary;
    if (!last) {
      console.warn(`ef_poll_orders: no VALR summary returned for intent_id=${o.intent_id}`);
      continue;
    }

    const valrStatus = last.orderStatusType || last.orderStatus || last.status || "";
    let newStatus = o.status ?? "submitted";
    if (valrStatus === "Cancelled") newStatus = "cancelled";
    else if (valrStatus === "Filled") newStatus = "filled";
    else newStatus = "submitted";

    // Prepare merged raw payload
    const mergedRaw = {
      ...o.raw ?? {},
      valr: {
        ...o.raw?.valr ?? {},
        id: last.id,
        customerOrderId: last.customerOrderId,
        orderStatusType: valrStatus,
        ...last
      },
      valrLast: last
    };

    // ------------------------------------------------------------------
    // 2. Fallback logic: if still submitted AND not already a fallback
    // ------------------------------------------------------------------
    const isFallbackMarket = Boolean(o.raw?.fallbackFrom);
    if (newStatus === "submitted" && !isFallbackMarket) {
      const submittedAt = o.submitted_at ? new Date(o.submitted_at) : null;
      const ageMs = submittedAt ? Date.now() - submittedAt.getTime() : 0;
      let shouldFallback = false;
      let marketPrice = null;

      // (a) Age condition
      if (ageMs >= MAX_AGE_MS) {
        shouldFallback = true;
        console.log(`ef_poll_orders: order ${o.exchange_order_id} older than 5 minutes – converting to market`);
        await logAlert(
          supabase,
          "ef_poll_orders",
          "warn",
          `Order exceeding 5min timeout, triggering market order fallback`,
          {
            intent_id: o.intent_id,
            exchange_order_id: o.exchange_order_id,
            ext_order_id: o.ext_order_id,
            age_minutes: Math.round(ageMs / 60000),
            side,
            pair
          },
          org_id
        );
      } else {
        // (b) Price move condition
        try {
          marketPrice = await getMarketPrice(pair);
          const limitPrice = Number(o.price);
          if (limitPrice > 0 && marketPrice > 0) {
            const relMove = Math.abs(marketPrice - limitPrice) / limitPrice;
            if (relMove >= PRICE_MOVE_THRESHOLD) {
              shouldFallback = true;
              console.log(`ef_poll_orders: order ${o.exchange_order_id} price moved ${(relMove * 100).toFixed(3)}% – converting to market`);
            }
          }
        } catch (err) {
          console.error("ef_poll_orders: failed to fetch market price for fallback check", err);
        }
      }

      if (shouldFallback) {
        const originalQty = Number(last.originalQuantity ?? o.qty ?? 0);
        const executedQty = Number(last.totalExecutedQuantity ?? 0);
        const remainingQty = originalQty - executedQty;

        if (remainingQty > 0) {
          // 2.a Cancel the stale LIMIT order on VALR
          try {
            await cancelOrderById(last.id, pair, subaccountId);
          } catch (err) {
            console.error(`ef_poll_orders: failed to cancel stale limit order ${last.id}`, err);
            await logAlert(
              supabase,
              "ef_poll_orders",
              "error",
              `Failed to cancel stale limit order`,
              {
                intent_id: o.intent_id,
                exchange_order_id: o.exchange_order_id,
                ext_order_id: last.id,
                error: err instanceof Error ? err.message : String(err)
              },
              org_id
            );
          }

          // 2.b Place a MARKET order for the remaining quantity
          const usePrice = marketPrice ?? Number(last.price ?? o.price ?? 0);
          let amount;
          if (side === "BUY") {
            // BUY: amount is quote (USDT)
            amount = (remainingQty * usePrice).toFixed(2);
          } else {
            // SELL: amount is base (BTC)
            amount = remainingQty.toString();
          }

          try {
            const marketOrder = await placeMarketOrder(pair, side, amount, o.intent_id, subaccountId);

            const { error: insertError } = await supabase.from("exchange_orders").insert({
              org_id: o.org_id,
              exchange_account_id: o.exchange_account_id,
              intent_id: o.intent_id,
              ext_order_id: marketOrder.id,
              pair,
              side,
              price: usePrice,
              qty: remainingQty,
              status: "submitted",
              submitted_at: new Date().toISOString(),
              raw: {
                fallbackFrom: o.ext_order_id,
                valr: marketOrder
              }
            });
            if (insertError) {
              console.error("ef_poll_orders: failed to insert fallback market order", insertError);
            }
          } catch (err) {
            console.error("ef_poll_orders: failed to place fallback market order", err);
            await logAlert(
              supabase,
              "ef_poll_orders",
              "critical",
              `Market order fallback failed after cancelling limit order`,
              {
                intent_id: o.intent_id,
                exchange_order_id: o.exchange_order_id,
                original_ext_order_id: o.ext_order_id,
                remaining_qty: remainingQty,
                side,
                pair,
                error: err instanceof Error ? err.message : String(err)
              },
              org_id
            );
          }

          // 2.c Mark the original limit order as cancelled locally
          const { error: updateOldError } = await supabase.from("exchange_orders").update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
            last_polled_at: new Date().toISOString(),
            poll_count: (o.poll_count ?? 0) + 1,
            requires_polling: false, // Order complete
            raw: mergedRaw
          }).eq("exchange_order_id", o.exchange_order_id);
          if (updateOldError) {
            console.error("ef_poll_orders: failed to mark original limit order as cancelled", updateOldError);
          }
          processed++;
          continue;
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. Normal status update (no fallback triggered)
    // ------------------------------------------------------------------
    if (newStatus !== o.status || !o.raw?.valrLast || o.raw?.valrLast?.orderUpdatedAt !== last.orderUpdatedAt) {
      const requiresMorePolling = newStatus === "submitted"; // Only keep polling if still open
      
      const { error: updateError } = await supabase.from("exchange_orders").update({
        status: newStatus,
        updated_at: new Date().toISOString(),
        last_polled_at: new Date().toISOString(),
        poll_count: (o.poll_count ?? 0) + 1,
        requires_polling: requiresMorePolling,
        raw: mergedRaw
      }).eq("exchange_order_id", o.exchange_order_id);
      if (updateError) {
        console.error(`ef_poll_orders: failed to update exchange_order_id=${o.exchange_order_id}`, updateError);
        continue;
      }
      
      if (!requiresMorePolling) {
        console.log(`ef_poll_orders: order ${o.exchange_order_id} complete (${newStatus}), stopped polling`);
      }
    }
    processed++;
  }

  return new Response(JSON.stringify({
    processed
  }), {
    status: 200
  });
});
