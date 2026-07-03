import { getServiceClient } from "./client.ts";
import { placeLimitOrder, placeMarketOrder, getOrderBook, getBalances, getOrderSummaryByCustomerOrderId } from "./valrClient.ts";
import { logAlert } from "./alerting.ts";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import { USDPC_PAIR } from "../_shared/usdpc.ts";

// Poll just-placed USDPC conversion MARKET order(s) until they reach a FINAL
// state (Filled/Cancelled/Failed), so the USDT they raise is actually settled
// and available before the dependent BTC buy is sized/placed. This replaces a
// blind fixed sleep: it returns as soon as the conversions settle (usually well
// under a second for a MARKET order) and is bounded by `maxMs`. VALR's
// order-summary endpoint returns HTTP 400 for a still-working order, so a throw
// is treated as "not settled yet" and we keep polling.
async function waitForConversionsSettled(
  convs: { intentId: string; subaccountId: string | null; credentials: { apiKey: string; apiSecret: string } | null }[],
  maxMs = 12000,
): Promise<void> {
  if (convs.length === 0) return;
  const deadline = Date.now() + maxMs;
  const pending = new Set(convs.map((_, idx) => idx));
  // Brief initial delay so the first status query usually sees a final state.
  await new Promise((r) => setTimeout(r, 500));
  while (pending.size > 0 && Date.now() < deadline) {
    for (const idx of [...pending]) {
      const c = convs[idx];
      try {
        const summary = await getOrderSummaryByCustomerOrderId(
          c.intentId,
          USDPC_PAIR,
          c.subaccountId,
          c.credentials,
        );
        const last = Array.isArray(summary) ? summary[0] : summary;
        const st = String(last?.orderStatusType ?? last?.orderStatus ?? last?.status ?? "");
        if (st === "Filled" || st === "Cancelled" || st === "Failed") {
          pending.delete(idx);
        }
      } catch (_e) {
        // HTTP 400 / order not final yet — keep polling.
      }
    }
    if (pending.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}

Deno.serve(async ()=>{
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  const todayDate = new Date().toISOString().slice(0, 10);
  if (!org_id) return new Response("ORG_ID missing", {
    status: 500
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  // pending intents for today
  const { data: intents, error } = await sb.from("order_intents").select("*").eq("org_id", org_id).eq("status", "pending").eq("trade_date", todayDate);
  if (error) {
    console.error("order_intents select failed", error);
    return new Response(error.message, {
      status: 500
    });
  }
  const count = intents?.length ?? 0;
  console.log(`ef_execute_orders: found ${count} pending intents for org ${org_id} and trade_date ${todayDate}`);
  if (!intents || intents.length === 0) {
    return new Response(`no pending intents for org ${org_id} and trade_date ${todayDate}`, {
      status: 200
    });
  }

  // USDPC conversion intents must execute BEFORE the BTC buys they fund, so
  // order the queue conversions-first.
  const isUsdpcConversion = (row: any) =>
    String(row.pair ?? "").replace("/", "").toUpperCase() === USDPC_PAIR.replace("/", "").toUpperCase();
  intents.sort((a, b) => (isUsdpcConversion(b) ? 1 : 0) - (isUsdpcConversion(a) ? 1 : 0));
  let convertedThisRun = false;
  // USDPC conversion orders placed in this run, awaiting settlement before the
  // first BTC buy is sized/placed.
  const pendingConversions: { intentId: string; subaccountId: string | null; credentials: { apiKey: string; apiSecret: string } | null }[] = [];

  let successCount = 0;
  let errorCount = 0;
  
  for (const i of intents ?? []){
    try {
      // find customer's exchange_account_id (from consolidated table)
      const { data: cs } = await sb.schema("public").from("customer_strategies").select("exchange_account_id").eq("org_id", org_id).eq("customer_id", i.customer_id).order("effective_from", {
        ascending: false
      }).limit(1);
      const exchange_account_id = cs?.[0]?.exchange_account_id ?? null;
      if (!exchange_account_id) {
        console.warn(`No exchange_account_id for customer ${i.customer_id}, skipping intent ${i.intent_id}`);
        await logAlert(
          sb,
          "ef_execute_orders",
          "error",
          `No exchange account configured for customer ${i.customer_id}`,
          {
            customer_id: i.customer_id,
            intent_id: i.intent_id,
            trade_date: todayDate
          },
          org_id,
          i.customer_id
        );
        errorCount++;
        continue;
      }
      // Look up VALR credentials for this customer (supports both subaccount and API model)
      let subaccountId: string | null = null;
      let credentials: { apiKey: string; apiSecret: string } | null = null;
      try {
        const creds = await resolveCustomerCredentials(sb, i.customer_id);
        subaccountId = creds.subaccountId;
        credentials = creds.accountModel === "api" ? { apiKey: creds.apiKey, apiSecret: creds.apiSecret } : null;
      } catch (credErr) {
        const errMsg = credErr instanceof Error ? credErr.message : String(credErr);
        console.error(`Credential resolution failed for customer ${i.customer_id}:`, errMsg);
        await logAlert(sb, "ef_execute_orders", "error",
          `Credential resolution failed: ${errMsg}`,
          { customer_id: i.customer_id, intent_id: i.intent_id, exchange_account_id, error: errMsg },
          org_id, i.customer_id);
        errorCount++;
        continue;
      }
      // --- USDPC CONVERSION PATH (market order on USDPC/USDT) ---
      // Conversion intents fund (or invest) around the BTC trades. They are
      // always MARKET orders and are ordered first in the queue so the USDT
      // they raise is settled before the dependent BTC buy is placed.
      if (isUsdpcConversion(i)) {
        try {
          const convSide = i.side.toUpperCase() === "BUY" ? "BUY" : "SELL";
          let amountStr = String(i.amount);
          let useQuote = false;
          if (convSide === "SELL") {
            // Selling USDPC -> cap baseAmount at the live settled USDPC balance.
            try {
              const bals = await getBalances(subaccountId, credentials);
              const liveUsdpc = Number(bals["USDPC"] ?? 0);
              if (liveUsdpc > 0 && Number(i.amount) > liveUsdpc) {
                amountStr = String(+liveUsdpc.toFixed(8));
              }
            } catch (_balErr) { /* fall back to sized amount */ }
          } else {
            // Buying USDPC with an exact USDT (quote) amount.
            useQuote = true;
          }
          const convResp = await placeMarketOrder(
            USDPC_PAIR,
            convSide,
            amountStr,
            i.intent_id,
            subaccountId,
            credentials,
            useQuote,
          );
          const convExtId = convResp?.orderId ?? convResp?.id;
          await sb.from("exchange_orders").insert({
            org_id,
            exchange_account_id,
            intent_id: i.intent_id,
            ext_order_id: convExtId,
            pair: USDPC_PAIR,
            side: convSide,
            price: 0,
            qty: amountStr,
            status: "submitted",
            raw: { valr: convResp, subaccountId, order_type: "MARKET", usdpc_conversion: true, reason: i.reason },
          });
          await sb.from("order_intents").update({ status: "executed" }).eq("intent_id", i.intent_id);
          convertedThisRun = true;
          pendingConversions.push({ intentId: i.intent_id, subaccountId, credentials });
          successCount++;
        } catch (convErr) {
          const cm = convErr instanceof Error ? convErr.message : String(convErr);
          console.error("USDPC conversion failed", convErr);
          await logAlert(
            sb,
            "ef_execute_orders",
            "error",
            `USDPC conversion order failed: ${cm}`,
            { customer_id: i.customer_id, intent_id: i.intent_id, side: i.side, pair: USDPC_PAIR, amount: i.amount, error: cm },
            org_id,
            i.customer_id,
          );
          await sb.from("order_intents").update({ status: "error", reason: `USDPC conversion failed: ${cm}` }).eq("intent_id", i.intent_id);
          errorCount++;
        }
        continue;
      }
      // Give a just-placed conversion a moment to settle into available USDT
      // before the first BTC buy is sized/placed in this run. Polls the
      // conversion order status (bounded) rather than sleeping a fixed interval,
      // so it proceeds as soon as the USDT is actually settled.
      if (convertedThisRun) {
        await waitForConversionsSettled(pendingConversions);
        pendingConversions.length = 0;
        convertedThisRun = false;
      }
      // --- DETERMINE ORDER TYPE & EXECUTE ---
      const side = i.side.toUpperCase() === "SELL" ? "SELL" : "BUY";
      const pair = "BTCUSDT"; // VALR pair code (vs "BTC/USDT" internal) 
      const qtyStr = String(i.amount);
      const isMarketOrder = i.limit_price === null || i.limit_price === undefined;
      
      let orderBookPrice: string | null = null;
      let valrResp;
      
      if (isMarketOrder) {
        // --- MARKET ORDER PATH ---
        // VALR MARKET orders accept baseAmount (BTC) for both BUY and SELL
        // VALR automatically uses market price to determine quote amount
        console.log(`Placing MARKET ${side} order: ${qtyStr} BTC (intent ${i.intent_id})`);
        try {
          valrResp = await placeMarketOrder(
            pair,
            side,
            qtyStr,
            i.intent_id,
            subaccountId,
            credentials
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error("VALR MARKET order failed", e);
          
          await logAlert(
            sb,
            "ef_execute_orders",
            "error",
            `VALR MARKET order failed: ${errMsg}`,
            {
              customer_id: i.customer_id,
              intent_id: i.intent_id,
              side,
              pair,
              quantity: qtyStr,
              error: errMsg
            },
            org_id,
            i.customer_id
          );
          
          await sb.from("exchange_orders").insert({
            org_id,
            exchange_account_id,
            intent_id: i.intent_id,
            pair: "BTC/USDT",
            side,
            price: 0,
            qty: i.amount,
            status: "error",
            raw: {
              error: errMsg,
              order_type: "MARKET"
            }
          });
          await sb.from("order_intents").update({
            status: "error",
            reason: `MARKET order failed: ${errMsg}`
          }).eq("intent_id", i.intent_id);
          errorCount++;
          continue;
        }
      } else {
        // --- LIMIT ORDER PATH (maker-first) ---
        // Price the LIMIT on OUR side of the book and submit postOnly:true so
        // VALR rests it as a MAKER. Pricing on the opposite side (best ask for
        // a BUY / best bid for a SELL) crosses the spread immediately and gets
        // matched as a TAKER — even though it's submitted via the LIMIT
        // endpoint — which costs roughly 2x the maker fee on BTCUSDT.
        //
        // Trade-off: a maker order may not fill quickly. The existing
        // ef_poll_orders + ef_market_fallback safety nets cancel any LIMIT
        // that's still open after 5 minutes (or 0.25% adverse price move) and
        // replace it with a MARKET order. We additionally fall straight
        // through to a MARKET here if VALR rejects the postOnly placement
        // (e.g. zero spread, book moved between fetch and place) so the
        // intent never strands.
        let isMakerOrder = true;
        try {
          const orderBook = await getOrderBook(pair);
          
          if (side === "BUY") {
            // BUY maker: rest at best BID
            if (!orderBook.Bids || orderBook.Bids.length === 0) {
              throw new Error("No bids available in order book");
            }
            orderBookPrice = orderBook.Bids[0].price;
            console.log(`BUY LIMIT (maker) order: using best bid price ${orderBookPrice}`);
          } else {
            // SELL maker: rest at best ASK
            if (!orderBook.Asks || orderBook.Asks.length === 0) {
              throw new Error("No asks available in order book");
            }
            orderBookPrice = orderBook.Asks[0].price;
            console.log(`SELL LIMIT (maker) order: using best ask price ${orderBookPrice}`);
          }
        } catch (obErr) {
          const obErrMsg = obErr instanceof Error ? obErr.message : String(obErr);
          console.error("Failed to fetch order book, falling back to intent price:", obErrMsg);
          await logAlert(
            sb,
            "ef_execute_orders",
            "warn",
            `Order book fetch failed, using intent price: ${obErrMsg}`,
            {
              customer_id: i.customer_id,
              intent_id: i.intent_id,
              side,
              pair,
              error: obErrMsg
            },
            org_id,
            i.customer_id
          );
          orderBookPrice = String(Math.round(Number(i.limit_price)));
        }
        
        try {
          valrResp = await placeLimitOrder({
            side,
            pair,
            price: orderBookPrice,
            quantity: qtyStr,
            customerOrderId: i.intent_id,
            timeInForce: "GTC",
            postOnly: true,
          }, subaccountId, credentials);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          const isRateLimit = errMsg.toLowerCase().includes("rate limit") || errMsg.includes("429");
          // postOnly rejections are expected when the book has zero spread or
          // moved between our snapshot and our submission. Treat any
          // non-rate-limit failure as a "fall through to MARKET" event rather
          // than a hard error — operationally the intent must still execute.
          if (isRateLimit) {
            console.error("VALR LIMIT order rate-limited", e);
            await logAlert(
              sb,
              "ef_execute_orders",
              "warn",
              `VALR LIMIT order rate-limited: ${errMsg}`,
              {
                customer_id: i.customer_id,
                intent_id: i.intent_id,
                side,
                pair,
                price: orderBookPrice,
                quantity: qtyStr,
                error: errMsg,
                rate_limited: true,
              },
              org_id,
              i.customer_id
            );
            await sb.from("exchange_orders").insert({
              org_id,
              exchange_account_id,
              intent_id: i.intent_id,
              pair: "BTC/USDT",
              side,
              price: Number(orderBookPrice),
              qty: i.amount,
              status: "error",
              raw: { error: errMsg, order_type: "LIMIT", rate_limited: true },
            });
            await sb.from("order_intents").update({
              status: "error",
              reason: `LIMIT rate-limited: ${errMsg}`,
            }).eq("intent_id", i.intent_id);
            errorCount++;
            continue;
          }

          console.warn(`postOnly LIMIT placement failed, falling back to MARKET: ${errMsg}`);
          await logAlert(
            sb,
            "ef_execute_orders",
            "warn",
            `postOnly LIMIT placement failed; using MARKET fallback: ${errMsg}`,
            {
              customer_id: i.customer_id,
              intent_id: i.intent_id,
              side,
              pair,
              price: orderBookPrice,
              quantity: qtyStr,
              error: errMsg,
            },
            org_id,
            i.customer_id
          );

          isMakerOrder = false;
          try {
            valrResp = await placeMarketOrder(
              pair,
              side,
              qtyStr,
              i.intent_id,
              subaccountId,
              credentials
            );
          } catch (mktErr) {
            const mktErrMsg = mktErr instanceof Error ? mktErr.message : String(mktErr);
            console.error("MARKET fallback also failed", mktErr);
            await logAlert(
              sb,
              "ef_execute_orders",
              "error",
              `MARKET fallback after postOnly rejection failed: ${mktErrMsg}`,
              {
                customer_id: i.customer_id,
                intent_id: i.intent_id,
                side,
                pair,
                quantity: qtyStr,
                limit_error: errMsg,
                market_error: mktErrMsg,
              },
              org_id,
              i.customer_id
            );
            await sb.from("exchange_orders").insert({
              org_id,
              exchange_account_id,
              intent_id: i.intent_id,
              pair: "BTC/USDT",
              side,
              price: 0,
              qty: i.amount,
              status: "error",
              raw: {
                error: mktErrMsg,
                order_type: "MARKET",
                fallback_from: "LIMIT_postOnly",
                limit_error: errMsg,
              },
            });
            await sb.from("order_intents").update({
              status: "error",
              reason: `LIMIT+MARKET both failed: ${mktErrMsg}`,
            }).eq("intent_id", i.intent_id);
            errorCount++;
            continue;
          }
        }
        // Mark whether this run actually placed a maker LIMIT (vs MARKET fallback)
        // for the exchange_orders.raw bookkeeping below.
        (i as any)._isMakerOrder = isMakerOrder;
      }
      
      // --- RECORD ORDER IN DATABASE ---
      // Effective order type: MARKET intent OR a LIMIT-postOnly that was
      // rejected and fell back to MARKET above. The maker LIMIT case is the
      // common (and cheap) path; the fallback is recorded for audit.
      const effIsMarket = isMarketOrder || ((i as any)._isMakerOrder === false);
      const extId = valrResp?.orderId ?? valrResp?.id;
      const eo = await sb.from("exchange_orders").insert({
        org_id,
        exchange_account_id,
        intent_id: i.intent_id,
        ext_order_id: extId,
        pair: "BTC/USDT",
        side,
        price: effIsMarket ? 0 : Number(orderBookPrice),
        qty: i.amount,
        status: "submitted",
        raw: {
          valr: valrResp,
          subaccountId,
          order_type: effIsMarket ? "MARKET" : "LIMIT",
          post_only: !effIsMarket,
          fallback_from: (!isMarketOrder && effIsMarket) ? "LIMIT_postOnly" : null,
          order_book_price: orderBookPrice,
          intent_price: i.limit_price,
        },
      });
      if (eo.error) {
        console.error(eo.error);
        await logAlert(
          sb,
          "ef_execute_orders",
          "error",
          `Failed to insert exchange_order: ${eo.error.message}`,
          {
            customer_id: i.customer_id,
            intent_id: i.intent_id,
            ext_order_id: extId,
            error: eo.error.message
          },
          org_id,
          i.customer_id
        );
        errorCount++;
        continue;
      }
      // Mark intent as executed (handed off to exchange)
      await sb.from("order_intents").update({
        status: "executed"
      }).eq("intent_id", i.intent_id);
      successCount++;
    } catch (err) {
      console.error(`Order execution failed for intent ${i.intent_id}:`, err);
      await logAlert(
        sb,
        "ef_execute_orders",
        "error",
        `Order execution failed for intent ${i.intent_id}`,
        {
          customer_id: i.customer_id,
          intent_id: i.intent_id,
          trade_date: todayDate,
          error: err instanceof Error ? err.message : String(err)
        },
        org_id,
        i.customer_id
      );
      errorCount++;
    }
  }
  
  console.info(`ef_execute_orders: success=${successCount}, errors=${errorCount}`);
  
  // --- NEW: Initiate WebSocket monitoring for submitted orders ---
  if (successCount > 0) {
    try {
      // Get all submitted orders from today
      const { data: submittedOrders, error: ordersErr } = await sb
        .from("exchange_orders")
        .select("intent_id, exchange_account_id")
        .eq("org_id", org_id)
        .eq("status", "submitted")
        .gte("submitted_at", todayDate + "T00:00:00Z");

      if (!ordersErr && submittedOrders && submittedOrders.length > 0) {
        // Group orders by exchange_account_id to get subaccount_id
        const accountGroups = new Map<string, string[]>();
        
        for (const order of submittedOrders) {
          const accountId = order.exchange_account_id;
          if (!accountGroups.has(accountId)) {
            accountGroups.set(accountId, []);
          }
          accountGroups.get(accountId)!.push(order.intent_id);
        }

        // Launch WebSocket monitor for each subaccount (subaccount model only)
        for (const [accountId, orderIds] of accountGroups.entries()) {
          const { data: exAcc } = await sb
            .from("exchange_accounts")
            .select("subaccount_id, account_model")
            .eq("exchange_account_id", accountId)
            .single();

          const subaccountId = exAcc?.subaccount_id;

          // WebSocket monitoring only works for subaccount model currently
          if (subaccountId) {
            // Call WebSocket monitor Edge Function (non-blocking)
            const wsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ef_valr_ws_monitor`;
            fetch(wsUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SECRET_KEY")}`,
              },
              body: JSON.stringify({
                order_ids: orderIds,
                subaccount_id: subaccountId,
              }),
            }).catch((err) => {
              console.warn("Failed to initiate WebSocket monitor:", err);
              // Non-critical: polling will handle as fallback
            });

            // Mark orders as WebSocket monitored
            await sb
              .from("exchange_orders")
              .update({
                ws_monitored_at: new Date().toISOString(),
                requires_polling: true, // Still require polling as safety net
              })
              .in("intent_id", orderIds);

            console.log(
              `ef_execute_orders: Initiated WebSocket monitoring for ${orderIds.length} orders (subaccount ${subaccountId.substring(0, 8)}...)`,
            );
          }
        }
      }
    } catch (wsErr) {
      console.warn("WebSocket monitor setup failed (non-critical):", wsErr);
      // Polling will handle as fallback
    }
  }
  
  return new Response("ok");
});
