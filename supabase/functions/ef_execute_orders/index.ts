import { getServiceKey } from "../_shared/supabaseKeys.ts";
import { getServiceClient } from "./client.ts";
import { placeLimitOrder, placeMarketOrder, getOrderBook, getBalances, getOrderSummaryByCustomerOrderId, getMarketPrice } from "./valrClient.ts";
import { logAlert } from "./alerting.ts";
import { resolveCustomerCredentials, toRequestCredentials } from "../_shared/valrCredentials.ts";
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

  // ── USDPC/USDT liquidity model (2026-11-07) ──────────────────────────────────────────────────────────────
  // The pair is a thin market-maker quote (bid ≈ mark − 0.3 %, a few k deep) with a 1.5 % slippage band and a
  // 46 000-base per-order cap. One big MARKET sell is partially filled (IOC) or rejected ("would have matched
  // outside of slippage price band"). Davin's tests: LIMIT sells do not fill. So: MARKET in chunks no larger than
  // the bid depth within USDPC_MAX_SLIPPAGE of the mark, looping while the maker replenishes; whatever is left stays
  // `pending` and is retried by the next run (pipeline guard every 30 min). The dependent BTC buy is sized to the
  // USDT actually raised and likewise stays pending until the conversion completes.
  const USDPC_MAX_SLIPPAGE = Number(Deno.env.get("USDPC_MAX_SLIPPAGE") ?? "0.01");   // vs mark price
  const USDPC_MAX_BASE_PER_ORDER = 46_000;                                            // VALR pair limit
  const USDPC_MIN_CHUNK = 1;                                                          // VALR min base
  const USDPC_MAX_CHUNKS_PER_RUN = 10;
  const BTC_MIN_BUY_USDT = 10;
  const usdpcPairCode = USDPC_PAIR.replace("/", "");
  async function usdpcMarkPrice(): Promise<number> {
    const r = await fetch(`https://api.valr.com/v1/public/${usdpcPairCode}/marketsummary`);
    if (!r.ok) throw new Error(`marketsummary ${r.status}`);
    const j = await r.json();
    const mark = Number(j?.markPrice ?? j?.lastTradedPrice ?? 0);
    if (!(mark > 0)) throw new Error("no mark price");
    return mark;
  }
  /** Bid depth (base units) at or above mark × (1 − slippage). */
  async function usdpcSellDepth(): Promise<{ depth: number; mark: number; floor: number; bestBid: number }> {
    const mark = await usdpcMarkPrice();
    const floor = mark * (1 - USDPC_MAX_SLIPPAGE);
    const book = await getOrderBook(USDPC_PAIR);
    let depth = 0;
    for (const b of book.Bids ?? []) { if (Number(b.price) >= floor) depth += Number(b.quantity); }
    return { depth, mark, floor, bestBid: Number(book.Bids?.[0]?.price ?? 0) };
  }
  /** Poll one order (by customerOrderId) to a final state; returns the VALR summary (executed qty derived). */
  async function waitFinal(customerOrderId: string, subaccountId: string | null, credentials: { apiKey: string; apiSecret: string } | null, maxMs = 15000) {
    const deadline = Date.now() + maxMs;
    await new Promise((r) => setTimeout(r, 400));
    // deno-lint-ignore no-explicit-any
    let last: any = null;
    while (Date.now() < deadline) {
      try {
        const s = await getOrderSummaryByCustomerOrderId(customerOrderId, USDPC_PAIR, subaccountId, credentials);
        last = Array.isArray(s) ? s[0] : s;
        const st = String(last?.orderStatusType ?? last?.orderStatus ?? last?.status ?? "");
        if (st === "Filled" || st === "Cancelled" || st === "Failed") break;
      } catch (_e) { /* 400 while working */ }
      await new Promise((r) => setTimeout(r, 600));
    }
    const orig = Number(last?.originalQuantity ?? 0);
    const rem = Number(last?.remainingQuantity ?? orig);
    return { summary: last, status: String(last?.orderStatusType ?? ""), executed: Math.max(0, orig - rem) };
  }
  // customers whose USDPC→USDT conversion is still incomplete after this run (BTC buy must not be finalised)
  const conversionIncomplete = new Set<number>();
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
      // Look up VALR credentials for this customer (subaccount, API and Finova omnibus models)
      let subaccountId: string | null = null;
      let credentials: { apiKey: string; apiSecret: string } | null = null;
      try {
        const creds = await resolveCustomerCredentials(sb, i.customer_id);
        subaccountId = creds.subaccountId;
        credentials = toRequestCredentials(creds);
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
          if (convSide === "SELL") {
            // ── Chunked USDPC → USDT (see liquidity model above) ──────────────────────────────────
            let remaining = Number(i.amount);
            try {
              const bals = await getBalances(subaccountId, credentials);
              const liveUsdpc = Number(bals["USDPC"] ?? 0);
              if (liveUsdpc >= 0 && remaining > liveUsdpc) remaining = +liveUsdpc.toFixed(8);
            } catch (_balErr) { /* fall back to sized amount */ }
            const { count: priorChunks } = await sb.from("exchange_orders").select("exchange_order_id", { count: "exact", head: true }).eq("intent_id", i.intent_id);
            let n = Number(priorChunks ?? 0);
            let soldThisRun = 0, raisedThisRun = 0, placed = 0;
            let lastDepth = 0, lastMark = 0, lastBestBid = 0;
            await new Promise((r) => setTimeout(r, 1500)); // let the public book reflect the previous intent's fills
            while (remaining >= USDPC_MIN_CHUNK && placed < USDPC_MAX_CHUNKS_PER_RUN) {
              const d = await usdpcSellDepth();
              lastDepth = d.depth; lastMark = d.mark; lastBestBid = d.bestBid;
              const chunk = Math.floor(Math.min(remaining, d.depth, USDPC_MAX_BASE_PER_ORDER) * 100) / 100;
              if (chunk < USDPC_MIN_CHUNK) break;                        // no acceptable depth right now
              n++; placed++;
              const coid = n === 1 ? i.intent_id : `${i.intent_id}-c${n}`;
              // deno-lint-ignore no-explicit-any
              let convResp: any;
              try {
                convResp = await placeMarketOrder(USDPC_PAIR, "SELL", String(chunk), coid, subaccountId, credentials, false);
              } catch (placeErr) {
                // VALR rejects synchronously when the book moved under us ("slippage price band") — that is "no depth
                // right now", not a failure of the intent: stop this run and let the retry cron try again.
                const pm = placeErr instanceof Error ? placeErr.message : String(placeErr);
                console.warn(`USDPC chunk ${n} for intent ${i.intent_id} rejected at placement: ${pm}`);
                n--; placed--;
                break;
              }
              const convExtId = convResp?.orderId ?? convResp?.id;
              const fin = await waitFinal(coid, subaccountId, credentials);
              await sb.from("exchange_orders").insert({
                org_id, exchange_account_id, intent_id: i.intent_id, ext_order_id: convExtId,
                pair: USDPC_PAIR, side: "SELL", price: 0, qty: chunk,
                status: "submitted",  // ef_poll_orders finalises (books partial-cancelled chunks as fills)
                raw: { valr: convResp, subaccountId, order_type: "MARKET", usdpc_conversion: true, reason: i.reason,
                       chunk: n, customer_order_id: coid, depth_at_place: d.depth, mark_at_place: d.mark, first_status: fin.status, first_executed: fin.executed },
              });
              soldThisRun += fin.executed;
              raisedThisRun += fin.executed * Number(fin.summary?.averagePrice ?? d.bestBid ?? d.mark);
              remaining = +(remaining - fin.executed).toFixed(8);
              if (fin.executed < chunk * 0.5) break;                     // book pulled away — stop hammering it
              await new Promise((r) => setTimeout(r, 800));              // let the maker replenish
            }
            const done = remaining < USDPC_MIN_CHUNK;
            const summaryTxt = `sold ${soldThisRun.toFixed(2)} USDPC (≈${raisedThisRun.toFixed(2)} USDT) in ${placed} chunk(s); remaining ${remaining.toFixed(2)}; depth≤${USDPC_MAX_SLIPPAGE * 100}% of mark ${lastMark.toFixed(5)} was ${lastDepth.toFixed(2)} (best bid ${lastBestBid})`;
            if (done) {
              await sb.from("order_intents").update({ status: "executed", note: `${i.note ?? ""} | ${summaryTxt}`.slice(0, 500) }).eq("intent_id", i.intent_id);
              successCount++;
            } else {
              // keep the intent pending with the remaining amount so the next run (pipeline guard, 30 min) continues
              await sb.from("order_intents").update({ amount: remaining, note: `${i.note ?? ""} | ${summaryTxt}`.slice(0, 500) }).eq("intent_id", i.intent_id);
              conversionIncomplete.add(Number(i.customer_id));
              await logAlert(sb, "ef_execute_orders", placed ? "info" : "warn",
                `USDPC conversion for customer ${i.customer_id} incomplete — ${summaryTxt}; will retry`,
                { customer_id: i.customer_id, intent_id: i.intent_id, remaining, sold: soldThisRun, raised_usdt: raisedThisRun, depth: lastDepth, mark: lastMark, best_bid: lastBestBid }, org_id, i.customer_id);
              if (placed) successCount++;
            }
            if (soldThisRun > 0) { convertedThisRun = true; }
            continue;
          }
          // ── BUY USDPC with an exact USDT (quote) amount (sweep) ──
          const amountStr = String(i.amount);
          const useQuote = true;
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
      const isMarketOrder = i.limit_price === null || i.limit_price === undefined;
      // ── Budget a BUY to the USDT actually on the account (2026-11-07) ─────────────────────────────────────
      // When the funding conversion only partly filled, buy what the raised USDT covers, keep the intent pending
      // for the remainder, and never place a buy VALR will reject for insufficient balance.
      let effQty = Number(i.amount);
      let btcPartial = false;
      if (side === "BUY") {
        let liveUsdt = NaN;
        try { const bals = await getBalances(subaccountId, credentials); liveUsdt = Number(bals["USDT"] ?? 0); } catch (_e) { /* unknown → no cap */ }
        if (Number.isFinite(liveUsdt)) {
          const budget = Math.max(0, liveUsdt * 0.999);
          const incomplete = conversionIncomplete.has(Number(i.customer_id));
          if (budget < BTC_MIN_BUY_USDT && incomplete) {
            console.log(`BUY ${i.intent_id}: only ${liveUsdt.toFixed(2)} USDT available and USDPC conversion incomplete — leaving pending`);
            await sb.from("order_intents").update({ note: `${i.note ?? ""} | waiting for USDPC liquidity (USDT ${liveUsdt.toFixed(2)})`.slice(0, 500) }).eq("intent_id", i.intent_id);
            continue;
          }
          let refPx = Number(i.limit_price) > 0 ? Number(i.limit_price) : 0;
          if (!(refPx > 0)) { try { refPx = Number(await getMarketPrice(pair)); } catch (_e) { refPx = 0; } }
          if (refPx > 0) {
            const maxQty = Math.floor((budget / refPx) * 1e8) / 1e8;
            if (maxQty < effQty) {
              console.log(`BUY ${i.intent_id}: qty capped to live USDT budget ${budget.toFixed(2)}: ${effQty} → ${maxQty} BTC`);
              effQty = maxQty;
              btcPartial = incomplete;
            }
          }
        }
      }
      const qtyStr = effQty.toFixed(8);
      // one VALR customerOrderId per attempt (an intent may need several buys across runs)
      const { count: priorBtcOrders } = await sb.from("exchange_orders").select("exchange_order_id", { count: "exact", head: true }).eq("intent_id", i.intent_id);
      if (side === "BUY" && Number(priorBtcOrders ?? 0) > 0) {
        // never stack buys: wait while an earlier order for this intent is still open, and don't chase dust
        const { count: openForIntent } = await sb.from("exchange_orders").select("exchange_order_id", { count: "exact", head: true }).eq("intent_id", i.intent_id).eq("status", "submitted");
        if (Number(openForIntent ?? 0) > 0) { console.log(`BUY ${i.intent_id}: earlier order still open — skipping this run`); continue; }
        const topUpUsdt = effQty * (Number(i.limit_price) > 0 ? Number(i.limit_price) : 0);
        if (topUpUsdt > 0 && topUpUsdt < 500) { console.log(`BUY ${i.intent_id}: top-up ${topUpUsdt.toFixed(2)} USDT below 500 — waiting for more liquidity`); continue; }
      }
      const btcCoid = Number(priorBtcOrders ?? 0) === 0 ? i.intent_id : `${i.intent_id}-r${Number(priorBtcOrders) + 1}`;
      
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
            btcCoid,
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
            qty: effQty,
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
          // Never let a BUY exceed its budget: the intent was sized as qty × decision price (= the USDT actually
          // available). If the best bid is above that price, resting qty × bid would be rejected for insufficient
          // balance (all-in buys have no slack), so shrink the quantity to budget / bid instead.
          let limitQtyStr = qtyStr;
          if (side === "BUY" && Number(i.limit_price) > 0 && Number(orderBookPrice) > Number(i.limit_price)) {
            const budgetUsdt = effQty * Number(i.limit_price);
            const capped = Math.floor((budgetUsdt / Number(orderBookPrice)) * 1e8) / 1e8;
            if (capped > 0 && capped < effQty) {
              console.log(`BUY qty capped to budget: ${qtyStr} → ${capped} BTC (bid ${orderBookPrice} > intent ${i.limit_price})`);
              limitQtyStr = capped.toFixed(8);
            }
          }
          valrResp = await placeLimitOrder({
            side,
            pair,
            price: orderBookPrice,
            quantity: limitQtyStr,
            customerOrderId: btcCoid,
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
              qty: effQty,
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
              btcCoid,
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
              qty: effQty,
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
        qty: effQty,
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
      // Mark intent as executed (handed off to exchange) — or keep it pending for the un-funded remainder
      if (btcPartial && effQty < Number(i.amount)) {
        const rest = +(Number(i.amount) - effQty).toFixed(8);
        await sb.from("order_intents").update({ amount: rest, note: `${i.note ?? ""} | partial: ${effQty.toFixed(8)} BTC placed, ${rest.toFixed(8)} BTC awaiting USDPC liquidity`.slice(0, 500) }).eq("intent_id", i.intent_id);
      } else {
        await sb.from("order_intents").update({ status: "executed" }).eq("intent_id", i.intent_id);
      }
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
                "Authorization": `Bearer ${getServiceKey()}`,
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
