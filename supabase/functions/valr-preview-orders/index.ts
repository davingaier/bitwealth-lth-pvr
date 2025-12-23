// supabase/functions/valr-preview-orders/index.ts
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, prefer, x-client-info",
  Vary: "Origin",
  "Content-Type": "application/json"
};
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL");
const SB_SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SYMBOL = "BTCUSDT";
const json = (p, s = 200)=>new Response(JSON.stringify(p), {
    status: s,
    headers: CORS_HEADERS
  });
const floorToStep = (v, step)=>isFinite(v) && step > 0 ? Math.floor(v / step) * step : 0;
const roundToTick = (v, tick)=>isFinite(v) && tick > 0 ? Math.round(v / tick) * tick : v;
// ---- market meta ------------------------------------------------------------
let _pairMeta = null;
async function fetchPairMeta() {
  const now = Date.now();
  if (_pairMeta && now - _pairMeta.at < 10 * 60_000) return _pairMeta;
  const r = await fetch("https://api.valr.com/v1/public/pairs");
  if (!r.ok) throw new Error(`VALR /public/pairs ${r.status}`);
  const arr = await r.json();
  const p = (Array.isArray(arr) ? arr : []).find((x)=>String(x?.symbol).toUpperCase() === SYMBOL);
  if (!p) throw new Error(`Pair ${SYMBOL} not found`);
  const minBase = Number(p.minBaseAmount ?? 0);
  const minQuote = Number(p.minQuoteAmount ?? 0);
  const tick = Number(p.tickSize ?? 0.01);
  const baseDp = Number(p.baseDecimalPlaces ?? 8);
  const baseStep = Number.isFinite(baseDp) && baseDp >= 0 ? Math.pow(10, -baseDp) : 1e-8;
  _pairMeta = {
    at: now,
    minBase,
    minQuote,
    tick,
    baseStep
  };
  return _pairMeta;
}
// ---- internal preflight: ensure we have a snapshot for a given day ----
const FUNCTIONS_ORIGIN = (SB_URL || "").replace(".supabase.co", ".functions.supabase.co");
async function ensureSnapshot(customer_id, as_of_date) {
  try {
    const r = await fetch(`${FUNCTIONS_ORIGIN}/valr-balances`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // allow internal call even if the function requires auth
        "apikey": SB_SERVICE_ROLE_KEY,
        "authorization": `Bearer ${SB_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        customer_id,
        as_of_date
      })
    });
    if (!r.ok) return null;
    return await r.json().catch(()=>null);
  } catch (_e) {
    return null;
  }
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
  if (req.method !== "POST") return json({
    error: "Method not allowed"
  }, 405);
  // ---- read payload ----
  const body = await req.json().catch(()=>({}));
  const for_date = (body?.for_date || body?.date_closing || body?.as_of_date || "").toString().slice(0, 10) || new Date(Date.now() - 86_400_000) // UTC today - 1 day
  .toISOString().slice(0, 10);
  const preview_limit = Number(body?.preview_limit) || 100;
  const sb = createClient(SB_URL, SB_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
  try {
    // Active VALR customers only
    const { data: custs, error: custErr } = await sb.from("customer_details").select("customer_id").eq("customer_status", "Active").eq("exchange_api_name", "VALR");
    if (custErr) return json({
      ok: false,
      date: for_date,
      error: `customers: ${custErr.message}`
    }, 500);
    if (!custs?.length) return json({
      ok: true,
      date: for_date,
      inserted: 0,
      cust_count: 0,
      info: "no active VALR customers"
    });
    // Opening balances snapshot (same day as for_date)
    // B1: most recent snapshot up to the trade date
    const custIds = (custs || []).map((c)=>Number(c.customer_id));
    // use your view so we always get the latest row per customer <= for_date
    const { data: snaps, error: snapErr } = await sb.from("v_exchange_daily_balances_latest").select("customer_id, btc_total, usdt_total, as_of_date").in("customer_id", custIds).lte("as_of_date", for_date);
    if (snapErr) return json({
      ok: false,
      date: for_date,
      error: `snapshots: ${snapErr.message}`
    }, 500);
    const snapsArr = Array.isArray(snaps) ? snaps : [];
    // Rules for for_date
    const { data: rules, error: rulesErr } = await sb.from("adv_dca_buy_sell_rules").select("customer_id,omega_threshold_id,omega_on_off,omega_buy_signal,omega_sell_signal,omega_buy_days_between_signal,omega_sell_days_between_signal,omega_buy_step_percent,omega_sell_step_percent,sab_buy_signal,sab_dca_unpause_buy_signal").eq("date_closing", for_date);
    if (rulesErr) {
      return json({
        ok: false,
        date: for_date,
        error: `rules: ${rulesErr.message}`
      }, 500);
    }
    const rulesArr = Array.isArray(rules) ? rules : [];
    // BTC close
    const { data: dd } = await sb.from("daily_data").select("btc_closing_price_usd").eq("date_closing", for_date).limit(1).maybeSingle();
    const pxClose = Number(dd?.btc_closing_price_usd ?? NaN);
    if (!isFinite(pxClose) || pxClose <= 0) {
      return json({
        ok: false,
        error: `No BTC close for ${for_date}`
      }, 400);
    }
    const { minBase, minQuote, tick, baseStep } = await fetchPairMeta();
    const pair_meta = {
      minBase,
      minQuote,
      tick,
      baseStep
    }; // debug helper
    // --- Top of book for SYMBOL (best bid/ask) -------------------------------
    async function fetchTopOfBook(symbol) {
      const r = await fetch(`https://api.valr.com/v1/public/${symbol}/orderbook`);
      if (!r.ok) return {
        bestBid: null,
        bestAsk: null
      };
      const ob = await r.json().catch(()=>null);
      // before:
      // const bestBid = ob?.Bids?.[0]?.Price ? Number(ob.Bids[0].Price) : null;
      // const bestAsk = ob?.Asks?.[0]?.Price ? Number(ob.Asks[0].Price) : null;
      // after:
      let bestBid = Number(ob?.Bids?.[0]?.price ?? NaN);
      let bestAsk = Number(ob?.Asks?.[0]?.price ?? NaN);
      if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) {
        try {
          const ms = await fetch("https://api.valr.com/v1/public/marketsummary");
          if (ms.ok) {
            const list = await ms.json();
            const m = Array.isArray(list) ? list.find((x)=>String(x.currencyPair).toUpperCase() === symbol) : null;
            if (!Number.isFinite(bestBid) && m?.bestBidPrice) bestBid = Number(m.bestBidPrice);
            if (!Number.isFinite(bestAsk) && m?.bestAskPrice) bestAsk = Number(m.bestAskPrice);
          }
        } catch  {}
      }
      return {
        bestBid,
        bestAsk
      };
    }
    const { bestBid, bestAsk } = await fetchTopOfBook(SYMBOL);
    const pxBuy = Number.isFinite(bestBid) ? bestBid : pxClose; // price to use for BUYs
    const pxSell = Number.isFinite(bestAsk) ? bestAsk : pxClose; // price to use for SELLs
    // ---- Sizers -------------------------------------------------------------
    function sizeBuy(usdtWanted, price) {
      if (usdtWanted < minQuote) {
        return {
          btc: 0,
          usdt: usdtWanted,
          price,
          status: "skipped",
          note: `below minQuote ${minQuote}`
        };
      }
      const qtyWanted = usdtWanted / price;
      if (qtyWanted < minBase) {
        return {
          btc: 0,
          usdt: usdtWanted,
          price,
          status: "skipped",
          note: `below minBase ${minBase}`
        };
      }
      const p = roundToTick(price, tick);
      const qtyRounded = Math.max(minBase, floorToStep(qtyWanted, baseStep));
      const usdtFinal = qtyRounded * p;
      if (usdtFinal < minQuote) {
        return {
          btc: 0,
          usdt: usdtWanted,
          price: p,
          status: "skipped",
          note: `post-round < minQuote ${minQuote}`
        };
      }
      return {
        btc: qtyRounded,
        usdt: usdtFinal,
        price: p,
        status: "preview",
        note: ""
      };
    }
    function sizeSell(btcWanted, price) {
      if (btcWanted < minBase) {
        return {
          btc: 0,
          usdt: 0,
          price,
          status: "skipped",
          note: `below minBase ${minBase}`
        };
      }
      const p = roundToTick(price, tick);
      const qtyRounded = Math.max(minBase, floorToStep(btcWanted, baseStep));
      const usdtFinal = qtyRounded * p;
      if (usdtFinal < minQuote) {
        return {
          btc: 0,
          usdt: 0,
          price: p,
          status: "skipped",
          note: `post-round < minQuote ${minQuote}`
        };
      }
      return {
        btc: qtyRounded,
        usdt: usdtFinal,
        price: p,
        status: "preview",
        note: ""
      };
    }
    // ---- Helpers for SAB month (trade-morning) ------------------------------
    // We budget against the month of the TRADE day = for_date + 1 (morning after the close)
    function addDaysUTC(iso, n) {
      const d = new Date(iso + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + n);
      return d;
    }
    function yyyymm(d) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    const intents = [];
    for (const c of custs){
      const cid1 = Number(c.customer_id);
      let snap = snapsArr.filter((s)=>Number(s.customer_id) === cid1).sort((a, b)=>new Date(b.as_of_date).getTime() - new Date(a.as_of_date).getTime())[0];
      // If we don't have a snapshot for this exact for_date, create one now
      if (!snap || String(snap.as_of_date) !== for_date) {
        const fresh = await ensureSnapshot(cid1, for_date);
        if (fresh && typeof fresh === "object") {
          // prefer totals if present, else available
          const fbBtc = Number(fresh?.btc?.total ?? fresh?.btc?.available ?? NaN);
          const fbUsdt = Number(fresh?.usdt?.total ?? fresh?.usdt?.available ?? NaN);
          if (Number.isFinite(fbBtc)) snap = {
            ...snap || {},
            btc_total: fbBtc,
            as_of_date: for_date
          };
          if (Number.isFinite(fbUsdt)) snap = {
            ...snap || {},
            usdt_total: fbUsdt,
            as_of_date: for_date
          };
        }
      }
      const balBtc = Number(snap?.btc_total ?? 0);
      const balUsdt = Number(snap?.usdt_total ?? 0);
      // Pull today’s rule row
      const r = rulesArr.find((x)=>Number(x.customer_id) === cid1);
      if (!r) {
        intents.push({
          intent_id: crypto.randomUUID(),
          customer_id: cid1,
          date_closing: for_date,
          symbol: 'BTCUSDT',
          side: 'BUY',
          intent_usdt: 0,
          intent_btc: 0,
          source_signal: 'SAB',
          status: 'skipped',
          notes: 'No rules for this date'
        });
        continue;
      }
      const omegaOn = !!r.omega_on_off;
      // ---- SAB DAILY (ledger-driven; trade for date_closing + 1) ------------
      // Read the persisted ledger row for this customer + close date
      const { data: sabRow } = await sb.from("sab_dca_daily").select("daily_dca_intent_usdt, banked_usdt_before, is_sab_release_day, omega_on_off").eq("customer_id", cid1).eq("date_closing", for_date).maybeSingle();
      // SAB may only trade when gates are open AND omega is OFF
      const sabEligible = !!r.sab_buy_signal && !!r.sab_dca_unpause_buy_signal && !omegaOn;
      // Budget comes from the ledger:
      //  - normal open day: use today's intent
      //  - release day: release all banked + today's intent
      const sabDailyUsdtBudget = sabEligible && sabRow ? Number(sabRow.daily_dca_intent_usdt || 0) + (sabRow.is_sab_release_day ? Number(sabRow.banked_usdt_before || 0) : 0) : 0;
      const sabBuy = sabDailyUsdtBudget > 0 ? sizeBuy(sabDailyUsdtBudget, pxBuy) : {
        btc: 0,
        usdt: 0,
        price: pxBuy,
        status: "skipped",
        note: sabEligible ? "no budget" : "SAB gate false"
      };
      // Reserve USDT used by SAB before Ω
      const freeUsdt = Math.max(0, balUsdt - (sabBuy.status === "preview" ? sabBuy.usdt : 0));
      // ---- Ω (strict gate & days-between) — ALWAYS WRITE A ROW --------------
      const buyGate = !!r.omega_buy_signal && !!r.omega_buy_days_between_signal;
      const sellGate = !!r.omega_sell_signal && !!r.omega_sell_days_between_signal;
      const omegaBuyPct = Math.max(0, Number(r.omega_buy_step_percent ?? 0));
      const omegaSellPct = Math.max(0, Number(r.omega_sell_step_percent ?? 0));
      const omBuyRow = (()=>{
        if (!buyGate) return {
          btc: 0,
          usdt: 0,
          price: pxBuy,
          status: "skipped",
          note: "Omega buy gate false"
        };
        if (freeUsdt <= 0) return {
          btc: 0,
          usdt: 0,
          price: pxBuy,
          status: "skipped",
          note: "no free USDT"
        };
        const bud = freeUsdt * omegaBuyPct;
        if (bud <= 0) return {
          btc: 0,
          usdt: 0,
          price: pxBuy,
          status: "skipped",
          note: "no budget"
        };
        return sizeBuy(bud, pxBuy);
      })();
      const omSellRow = (()=>{
        if (!sellGate) return {
          btc: 0,
          usdt: 0,
          price: pxSell,
          status: "skipped",
          note: "Omega sell gate false"
        };
        if (balBtc <= 0) return {
          btc: 0,
          usdt: 0,
          price: pxSell,
          status: "skipped",
          note: "no BTC"
        };
        const bud = balBtc * omegaSellPct;
        if (bud <= 0) return {
          btc: 0,
          usdt: 0,
          price: pxSell,
          status: "skipped",
          note: "no budget"
        };
        return sizeSell(bud, pxSell);
      })();
      const baseRow = {
        customer_id: cid1,
        date_closing: for_date,
        symbol: SYMBOL
      };
      intents.push({
        ...baseRow,
        intent_id: crypto.randomUUID(),
        side: "BUY",
        intent_usdt: sabBuy.usdt,
        intent_btc: sabBuy.btc,
        source_signal: "SAB_DAILY",
        price_tick: tick ?? 0.01,
        qty_step: baseStep ?? 1e-8,
        min_notional: minQuote ?? 0.52,
        intent_price: sabBuy.price,
        status: sabBuy.status,
        best_bid: Number.isFinite(bestBid) ? bestBid : sabBuy.price,
        best_ask: Number.isFinite(bestAsk) ? bestAsk : sabBuy.price,
        notes: sabBuy.status === "skipped" ? `SAB daily: ${sabBuy.note}` : "SAB daily"
      });
      if (omegaOn) {
        // OMEGA BUY
        intents.push({
          ...baseRow,
          intent_id: crypto.randomUUID(),
          side: "BUY",
          intent_usdt: omBuyRow.usdt,
          intent_btc: omBuyRow.btc,
          source_signal: "OMEGA_BUY",
          price_tick: tick ?? 0.01,
          qty_step: baseStep ?? 1e-8,
          min_notional: minQuote ?? 0.52,
          intent_price: omBuyRow.price,
          status: omBuyRow.status,
          best_bid: Number.isFinite(bestBid) ? bestBid : omBuyRow.price,
          best_ask: Number.isFinite(bestAsk) ? bestAsk : omBuyRow.price,
          notes: omBuyRow.status === "skipped" ? `Omega buy: ${omBuyRow.note}` : "Omega buy"
        });
        // OMEGA SELL
        intents.push({
          ...baseRow,
          intent_id: crypto.randomUUID(),
          side: "SELL",
          intent_usdt: omSellRow.usdt,
          intent_btc: omSellRow.btc,
          source_signal: "OMEGA_SELL",
          price_tick: tick ?? 0.01,
          qty_step: baseStep ?? 1e-8,
          min_notional: minQuote ?? 0.52,
          intent_price: omSellRow.price,
          status: omSellRow.status,
          best_bid: Number.isFinite(bestBid) ? bestBid : omSellRow.price,
          best_ask: Number.isFinite(bestAsk) ? bestAsk : omSellRow.price,
          notes: omSellRow.status === "skipped" ? `Omega sell: ${omSellRow.note}` : "Omega sell"
        });
      } else {
        // Optional: make the reason visible in the UI
        intents.push({
          ...baseRow,
          intent_id: crypto.randomUUID(),
          side: "BUY",
          source_signal: "OMEGA_BUY",
          intent_usdt: 0,
          intent_btc: 0,
          intent_price: pxBuy,
          status: "skipped",
          best_bid: Number.isFinite(bestBid) ? bestBid : pxBuy,
          best_ask: Number.isFinite(bestAsk) ? bestAsk : pxBuy,
          notes: "Omega disabled (omega_on_off = false)"
        });
        intents.push({
          ...baseRow,
          intent_id: crypto.randomUUID(),
          side: "SELL",
          source_signal: "OMEGA_SELL",
          intent_usdt: 0,
          intent_btc: 0,
          intent_price: pxSell,
          status: "skipped",
          best_bid: Number.isFinite(bestBid) ? bestBid : pxSell,
          best_ask: Number.isFinite(bestAsk) ? bestAsk : pxSell,
          notes: "Omega disabled (omega_on_off = false)"
        });
      }
    }
    await sb.from("exchange_order_intents")
      .delete()
      .eq("date_closing", for_date)
      .in("status", ["preview","skipped"])
      // IMPORTANT: keep anything already touched by execute/poller
      .is("exchange_order_id", null)
      .is("valr_order_id", null)
      .is("submitted_at", null);

    if (intents.length) {
      const { error: insErr } = await sb.from("exchange_order_intents").insert(intents);
      if (insErr) throw insErr;
    }
    return json({
      ok: true,
      date: for_date,
      price_used: Number.isFinite(bestBid) || Number.isFinite(bestAsk) ? {
        best_bid: bestBid,
        best_ask: bestAsk
      } : {
        close: pxClose
      },
      inserted: intents.length,
      cust_count: custs.length,
      rules_count: rulesArr.length,
      pair_meta
    });
  } catch (e) {
    console.error("valr-preview-orders failed:", e);
    return json({
      error: String(e?.message || e)
    }, 500);
  }
});
