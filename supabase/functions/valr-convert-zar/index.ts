// Place a USDTZAR order to convert ZAR -> USDT.
// Body: { customer_id: number, mode?: 'limit'|'market', post_only?: boolean, amount_zar?: number, as_of_date?: string }
// - 'limit' default, post-only true by default.
// - amount_zar is the ZAR delta you scanned; if omitted, we use live available.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
async function signVALR(ts, method, path, body, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {
    name: "HMAC",
    hash: "SHA-512"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(ts + method + path + body));
  return Array.from(new Uint8Array(sig)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
async function fetchPairMeta(symbol) {
  const r = await fetch("https://api.valr.com/v1/public/pairs");
  if (!r.ok) throw new Error(`VALR /public/pairs ${r.status}`);
  const arr = await r.json();
  const p = (Array.isArray(arr) ? arr : []).find((x)=>String(x?.symbol).toUpperCase() === symbol);
  if (!p) throw new Error(`Pair ${symbol} not found`);
  const minBase = Number(p.minBaseAmount ?? 0);
  const minQuote = Number(p.minQuoteAmount ?? 0);
  const tick = Number(p.tickSize ?? 0.01);
  const baseDp = Number(p.baseDecimalPlaces ?? 8);
  const baseStep = Number.isFinite(baseDp) && baseDp >= 0 ? Math.pow(10, -baseDp) : 1e-8;
  return {
    minBase,
    minQuote,
    tick,
    baseStep
  };
}
const floorToStep = (v, step)=>isFinite(v) && step > 0 ? Math.floor(v / step) * step : 0;
const roundToTick = (v, tick)=>isFinite(v) && tick > 0 ? Math.round(v / tick) * tick : v;
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  try {
    // ⬇️ added amount_zar & as_of_date
    const { customer_id, mode, post_only, amount_zar, as_of_date } = await req.json();
    const cid = Number(customer_id);
    const useMarket = String(mode || "limit").toLowerCase() === "market";
    const postOnly = useMarket ? false : post_only !== false;
    const sb = createClient(SB_URL, SB_KEY, {
      auth: {
        persistSession: false
      }
    });
    // creds
    const { data: c, error: ce } = await sb.from("customer_details").select("exchange_api_name, exchange_api_key, exchange_api_secret").eq("customer_id", cid).single();
    if (ce) throw ce;
    if ((c.exchange_api_name || "").toUpperCase() !== "VALR") throw new Error("VALR not configured");
    const key = c.exchange_api_key, secret = c.exchange_api_secret;
    if (!key || !secret) throw new Error("Missing VALR API key/secret");
    // live available ZAR
    const balPath = "/v1/account/balances";
    const ts = Date.now().toString();
    const sig = await signVALR(ts, "GET", balPath, "", secret);
    const res = await fetch("https://api.valr.com" + balPath, {
      method: "GET",
      headers: {
        "X-VALR-API-KEY": key,
        "X-VALR-TIMESTAMP": ts,
        "X-VALR-SIGNATURE": sig
      }
    });
    const arr = res.ok ? await res.json() : [];
    const zar = (arr || []).find((x)=>x.currency === "ZAR");
    const liveAvailable = Math.max(0, Number(zar?.available ?? 0));
    // ⬇️ NEW: choose how much to spend
    const requestedZar = Math.max(0, Number(amount_zar ?? 0));
    // if amount not provided (or 0), fall back to using all available
    let toSpend = Math.min(liveAvailable, requestedZar || liveAvailable);
    // keep a tiny dust buffer to avoid fee/rounding rejections (optional)
    toSpend = Math.floor((toSpend - 0.10) * 100) / 100; // keep 10c, 2 dp
    if (!Number.isFinite(toSpend) || toSpend < 15) {
      return new Response(JSON.stringify({
        error: "Insufficient ZAR (>= 15 required)",
        details: {
          requestedZar,
          liveAvailable,
          toSpend
        }
      }), {
        status: 400,
        headers: CORS
      });
    }
    // pair meta & price/qty selection
    const meta = await fetchPairMeta("USDTZAR");
    let price = 0;
    let qty = 0;
    const ms = await (await fetch("https://api.valr.com/v1/public/USDTZAR/marketsummary")).json();
    const bestBid = Number(ms?.bidPrice ?? 0);
    const bestAsk = Number(ms?.askPrice ?? 0);
    // LIMIT (post-only) BUY must be ≤ bestBid; choose bestBid - tick
    if (!useMarket) {
      // start from the top bid, step one tick below to guarantee maker
      let p = bestBid;
      // round to tick and enforce a floor at 1 tick
      p = roundToTick(p, meta.tick);
      price = Math.max(meta.tick, p);
      // compute qty in base (USDT), honoring base step and min base
      qty = floorToStep(toSpend / price, meta.baseStep);
      qty = Math.max(meta.minBase, qty);
      // safety: ensure we don't exceed the ZAR we intend to spend
      while(qty > meta.minBase && qty * price > toSpend){
        qty = floorToStep(qty - meta.baseStep, meta.baseStep);
      }
    } else {
      // MARKET uses quoteAmount = toSpend
      price = 0;
      qty = 0;
    }
    if (useMarket) {
      // Market: buy USDT spending exactly `toSpend` ZAR
      const body = JSON.stringify({
        pair: "USDTZAR",
        side: "BUY",
        baseAmount: null,
        quoteAmount: toSpend
      });
      const path = "/v1/orders/market";
      const ts2 = Date.now().toString();
      const sig2 = await signVALR(ts2, "POST", path, body, secret);
      const r2 = await fetch("https://api.valr.com" + path, {
        method: "POST",
        headers: {
          "X-VALR-API-KEY": key,
          "X-VALR-TIMESTAMP": ts2,
          "X-VALR-SIGNATURE": sig2,
          "Content-Type": "application/json"
        },
        body
      });
      const j = await r2.json().catch(()=>null);
      if (!r2.ok) throw new Error(j ? JSON.stringify(j) : `VALR ${r2.status}`);
      // ⬇️ log action 'convert' → 'open' (same as market branch)
      try {
        await sb.from("cbm_delta_actions").insert({
          customer_id: cid,
          delta_key: String(as_of_date || new Date().toISOString().slice(0, 10)) + "|USDTZAR",
          asset: "ZAR",
          action: "convert",
          status: "open",
          exchange_order_id: j?.id || j?.orderId || null,
          params: {
            mode: useMarket ? "market" : "limit",
            spent_zar: toSpend
          }
        });
      } catch  {}
      return new Response(JSON.stringify({
        ok: true,
        order_id: j?.id || j?.orderId || null,
        qty,
        price,
        spent_zar: toSpend
      }), {
        headers: CORS
      });
    } else {
      // Limit: quantity derived from toSpend and makerish price
      const body = JSON.stringify({
        pair: "USDTZAR",
        side: "BUY",
        quantity: qty.toFixed(8),
        price: price.toFixed(2),
        postOnly: postOnly,
        timeInForce: "GTC"
      });
      const path = "/v1/orders/limit";
      const ts2 = Date.now().toString();
      const sig2 = await signVALR(ts2, "POST", path, body, secret);
      const r2 = await fetch("https://api.valr.com" + path, {
        method: "POST",
        headers: {
          "X-VALR-API-KEY": key,
          "X-VALR-TIMESTAMP": ts2,
          "X-VALR-SIGNATURE": sig2,
          "Content-Type": "application/json"
        },
        body
      });
      const j = await r2.json().catch(()=>null);
      if (!r2.ok) throw new Error(j ? JSON.stringify(j) : `VALR ${r2.status}`);
      // ⬇️ log action 'convert' → 'open' (same as market branch)
      try {
        await sb.from("cbm_delta_actions").insert({
          customer_id: cid,
          delta_key: String(as_of_date || new Date().toISOString().slice(0, 10)) + "|USDTZAR",
          asset: "ZAR",
          action: "convert",
          status: "open",
          exchange_order_id: j?.id || j?.orderId || null,
          params: {
            mode: useMarket ? "market" : "limit",
            spent_zar: toSpend
          }
        });
      } catch  {}
      return new Response(JSON.stringify({
        ok: true,
        order_id: j?.id || j?.orderId || null,
        qty,
        price,
        spent_zar: toSpend
      }), {
        headers: CORS
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({
      error: String(e?.message || e)
    }), {
      status: 500,
      headers: CORS
    });
  }
});
