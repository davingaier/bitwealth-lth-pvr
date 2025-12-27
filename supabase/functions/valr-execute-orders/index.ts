// supabase/functions/valr-execute-orders/index.ts
// Place limit orders OR cancel a single intent when { cancel_intent_id } is provided
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const cors = (req)=>{
  const reqHeaders = req.headers.get("access-control-request-headers") || "authorization, apikey, content-type, prefer, x-client-info";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": reqHeaders,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json"
  };
};
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("Secret Key");
const PAIR = "BTCUSDT";
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
async function fetchTopOfBook(symbol) {
  const r = await fetch(`https://api.valr.com/v1/public/${symbol}/orderbook?limit=1`);
  if (!r.ok) throw new Error(`VALR /public/${symbol}/orderbook ${r.status}`);
  const ob = await r.json();
  const bestBid = Number(ob?.Bids?.[0]?.price ?? ob?.Bids?.[0]?.Price ?? 0);
  const bestAsk = Number(ob?.Asks?.[0]?.price ?? ob?.Asks?.[0]?.Price ?? 0);
  return {
    bestBid,
    bestAsk
  };
}
const floorToStep = (v, step)=>isFinite(v) && step > 0 ? Math.floor(v / step) * step : 0;
const roundToTick = (v, tick)=>isFinite(v) && tick > 0 ? Math.round(v / tick) * tick : v;
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors(req)
  });
  try {
    const { for_date, intent_ids, cancel_intent_id } = await req.json().catch(()=>({}));
    const asOf = for_date || new Date().toISOString().slice(0, 10);
    const limitIds = Array.isArray(intent_ids) && intent_ids.length ? intent_ids.map(String) : null;
    const sb = createClient(SB_URL, SB_KEY, {
      auth: {
        persistSession: false
      }
    });
    // ---- CANCEL PATH ----
    if (cancel_intent_id) {
      const iid = String(cancel_intent_id);
      const { data: row } = await sb.from("exchange_order_intents").select("intent_id, customer_id, symbol, exchange_order_id, valr_order_id, status").eq("intent_id", iid).maybeSingle();
      if (!row) return new Response(JSON.stringify({
        ok: false,
        error: "intent not found"
      }), {
        status: 404,
        headers: cors(req)
      });
      const orderId = String(row.exchange_order_id || row.valr_order_id || "");
      if (!orderId) {
        await sb.from("exchange_order_intents").update({
          status: "error",
          notes: "no order id to cancel"
        }).eq("intent_id", iid);
        return new Response(JSON.stringify({
          ok: false,
          error: "no order id"
        }), {
          status: 400,
          headers: cors(req)
        });
      }
      const { data: cred } = await sb.from("customer_details").select("exchange_api_key, exchange_api_secret, exchange_api_name").eq("customer_id", row.customer_id).maybeSingle();
      const exName = String(cred?.exchange_api_name ?? "").trim().toUpperCase();
      if (!cred || !(exName === "VALR" || exName.includes("VALR"))) {
        await sb.from("exchange_order_intents").update({
          status: "error",
          notes: "missing VALR creds"
        }).eq("intent_id", iid);
        return new Response(JSON.stringify({
          ok: false,
          error: "missing creds"
        }), {
          status: 400,
          headers: cors(req)
        });
      }
      // Prefer cancelling with an explicit pair; VALR DELETE needs the pair
      const localPair = String(row?.symbol || "BTCUSDT").toUpperCase();
      const trySigned = async (method, path)=>{
        const ts = Date.now().toString();
        const sig = await signVALR(ts, method, path, "", cred.exchange_api_secret);
        return fetch("https://api.valr.com" + path, {
          method,
          headers: {
            "X-VALR-API-KEY": cred.exchange_api_key,
            "X-VALR-TIMESTAMP": ts,
            "X-VALR-SIGNATURE": sig
          }
        });
      };
      // try delete with our local pair first
      let res = await trySigned("DELETE", `/v1/orders/${encodeURIComponent(localPair)}/${encodeURIComponent(orderId)}`);
      let body = await res.text().catch(()=>"");
      // 1) discover authoritative pair via history summary (more reliable) -> fall back to id-only
      let jSum: any = null;
      let discoveredPair = "";
      if (!res.ok && (/Unsupported Currency Pair/i.test(body) || res.status === 404)) {
        let lookup = await trySigned("GET", `/v1/orders/history/summary/orderid/${encodeURIComponent(orderId)}`);
        try { jSum = await lookup.json(); } catch {}
        if (!lookup.ok || !jSum) {
          lookup = await trySigned("GET", `/v1/orders/${encodeURIComponent(orderId)}`);
          try { jSum = await lookup.json(); } catch {}
        }
        discoveredPair = String(jSum?.currencyPair || jSum?.currencyPairSymbol || "").toUpperCase();
        if (discoveredPair) {
          res = await trySigned("DELETE", `/v1/orders/${encodeURIComponent(discoveredPair)}/${encodeURIComponent(orderId)}`);
          body = await res.text().catch(()=>"" );
        }
      }

      // 2) If DELETE still failed (wrong state, already filled, etc.), probe current status with a pair-scoped GET
      let jPair: any = null;
      if (!res.ok) {
        const probePair = discoveredPair || localPair;
        try {
          const g = await trySigned("GET", `/v1/orders/${encodeURIComponent(probePair)}/${encodeURIComponent(orderId)}`);
          jPair = await g.json().catch(()=>null);
        } catch {}
      }

      // success → mark cancelled
      if (res.ok) {
        await sb.from("exchange_order_intents").update({
          status: "cancelled",
          notes: "user-cancelled",
          closed_at: new Date().toISOString()
        }).eq("intent_id", iid);
        return new Response(JSON.stringify({ ok: true, cancelled: iid }), { headers: cors(req) });
      }

      // derive status from whichever payload we have
      const sTxt  = String(jSum?.orderStatus ?? jPair?.orderStatus ?? jSum?.status ?? jPair?.status ?? "").toLowerCase();
      const sType = String(jSum?.orderStatusType ?? jPair?.orderStatusType ?? "").toLowerCase();

      const origQty      = Number(jPair?.originalQuantity ?? jPair?.orderQuantity ?? jPair?.quantity ?? 0) || 0;
      const filledQty    = Number(jPair?.filledQuantity ?? jPair?.totalFilledQuantity ?? 0) || 0;
      const remainingQty = Number(jPair?.remainingQuantity ?? jPair?.openQuantity ?? (Number.isFinite(origQty) && Number.isFinite(filledQty) ? Math.max(0, origQty - filledQty) : NaN));

      const isFilled    = /filled|complete|completed|done/.test(sTxt) || sType === "filled" || (Number.isFinite(remainingQty) && remainingQty <= 0);
      const isCancelled = /cancel|canceled|cancelled|voided|expired/.test(sTxt) || /cancel|expired/.test(sType);

      if (isFilled) {
        await sb.from("exchange_order_intents").update({
          status: "filled",
          notes: "filled before cancel",
          closed_at: new Date().toISOString()
        }).eq("intent_id", iid);
        return new Response(JSON.stringify({ ok: true, filled: iid }), { headers: cors(req) });
      }
      if (isCancelled) {
        await sb.from("exchange_order_intents").update({
          status: "cancelled",
          notes: "already cancelled",
          closed_at: new Date().toISOString()
        }).eq("intent_id", iid);
        return new Response(JSON.stringify({ ok: true, cancelled: iid }), { headers: cors(req) });
      }

      // still active but delete failed → surface detail (409/400 included)
      await sb.from("exchange_order_intents").update({
        status: "error",
        notes: `cancel failed: ${body.slice(0, 200)}`
      }).eq("intent_id", iid);
      return new Response(JSON.stringify({
        ok: false,
        error: "cancel failed",
        detail: body
      }), { status: 500, headers: cors(req) });
    }
    // ---- EXECUTE PATH ----
    // 1) Load preview intents
    let q = sb.from("exchange_order_intents").select("intent_id, customer_id, symbol, side, intent_btc, intent_usdt, intent_price, notes, intent_date, date_closing").eq("status", "preview");
    if (limitIds) {
      // when specific rows are requested, do NOT constrain by date
      q = q.in("intent_id", limitIds);
    } else {
      q = q.eq("date_closing", asOf);
    }
    const { data: intents, error: iErr } = await q;
    if (iErr) throw iErr;
    if (!intents?.length) {
      return new Response(JSON.stringify({
        ok: true,
        as_of: asOf,
        submitted: 0,
        note: "no preview rows",
        submitted_intents: []
      }), {
        headers: cors(req)
      });
    }
    // 2) Creds
    const uniqueCids = Array.from(new Set(intents.map((r)=>Number(r.customer_id))));
    const { data: creds, error: cErr } = await sb.from("customer_details").select("customer_id, exchange_api_name, exchange_api_key, exchange_api_secret").in("customer_id", uniqueCids);
    if (cErr) throw cErr;
    const credByCid = new Map();
    (creds || []).forEach((c)=>{
      const name = String(c.exchange_api_name ?? "").trim().toUpperCase();
      if ((name === "VALR" || name.includes("VALR")) && c.exchange_api_key && c.exchange_api_secret) {
        credByCid.set(Number(c.customer_id), c);
      }
    });
    const metaCache = new Map();
    const topCache = new Map();
    const getMeta = async (symbol)=>{
      const key = symbol.toUpperCase();
      if (!metaCache.has(key)) metaCache.set(key, await fetchPairMeta(key));
      return metaCache.get(key);
    };
    const getTop = async (symbol)=>{
      const key = symbol.toUpperCase();
      if (!topCache.has(key)) topCache.set(key, await fetchTopOfBook(key));
      return topCache.get(key);
    };
    let submitted = 0, errors = 0;
    const submitted_intents = [];
    for (const it of intents){
      const cid = Number(it.customer_id);
      const cred = credByCid.get(cid);
      if (!cred) {
        await sb.from("exchange_order_intents").update({
          status: "error",
          notes: "Missing VALR credentials"
        }).eq("intent_id", it.intent_id);
        errors++;
        continue;
      }
      const side = String(it.side).toUpperCase() === "SELL" ? "SELL" : "BUY";
      const pair = String(it.symbol || PAIR).toUpperCase();
      const meta = await getMeta(pair);
      // live quote
      let execPrice = roundToTick(Number(it.intent_price) || 0, meta.tick);
      let top1 = null;
      try {
        top1 = await getTop(pair);
        const live = side === "SELL" ? top1.bestAsk : top1.bestBid;
        if (Number.isFinite(live) && live > 0) execPrice = roundToTick(live, meta.tick);
      } catch  {}
      // qty: prefer intent_btc; else derive from intent_usdt
      let qty = floorToStep(Number(it.intent_btc) || 0, meta.baseStep);
      if (!qty && Number(it.intent_usdt) > 0 && execPrice > 0) {
        qty = floorToStep(Number(it.intent_usdt) / execPrice, meta.baseStep);
      }
      qty = Math.max(meta.minBase, qty);
      const notional = qty * execPrice;
      if (qty < meta.minBase || notional < meta.minQuote) {
        await sb.from("exchange_order_intents").update({
          status: "skipped",
          notes: `below min (qty ${qty}, quote ${notional})`
        }).eq("intent_id", it.intent_id);
        continue;
      }
      const tickDp = Math.min(8, Math.max(0, Math.round(Math.log10(1 / (meta.tick || 1)))));
      const qtyDp = Math.min(8, Math.max(0, Math.round(Math.log10(1 / (meta.baseStep || 1e-8)))));
      const bodyObj = {
        pair,
        side,
        quantity: qty.toFixed(qtyDp),
        price: execPrice.toFixed(tickDp),
        timeInForce: "GTC",
        customerOrderId: `intent-${it.intent_id}`
      };
      const body = JSON.stringify(bodyObj);
      const path = "/v1/orders/limit";
      const ts = Date.now().toString();
      const sig = await signVALR(ts, "POST", path, body, cred.exchange_api_secret);
      const res = await fetch("https://api.valr.com" + path, {
        method: "POST",
        headers: {
          "X-VALR-API-KEY": cred.exchange_api_key,
          "X-VALR-TIMESTAMP": ts,
          "X-VALR-SIGNATURE": sig,
          "Content-Type": "application/json"
        },
        body
      });
      let j = null;
      try {
        j = await res.json();
      } catch  {}
      // Try JSON first, then headers (X-Order-Id / Location) as fallback
      let orderId = j?.id || j?.orderId || null;
      if (!orderId) {
        const hdr = res.headers;
        orderId = hdr.get("X-VALR-ORDER-ID") || hdr.get("X-Order-Id") || hdr.get("x-order-id") || null;
        const loc = hdr.get("Location") || hdr.get("location");
        if (!orderId && loc) {
          const m = loc.match(/\/orders\/([^/]+)/);
          if (m) orderId = m[1];
        }
      }
      const ok = res.ok && !!orderId;
      const patch = {
        status: ok ? "submitted" : "error",
        exchange_order_id: orderId,
        valr_order_id: orderId,
        submitted_at: new Date().toISOString(),
        symbol: pair,
        intent_date: it.intent_date || asOf,
        intent_price: execPrice,
        best_bid: top1?.bestBid ?? null,
        best_ask: top1?.bestAsk ?? null,
        notes: ok ? it.notes || null : `VALR: ${res.status} ${res.statusText} ${j ? JSON.stringify(j) : ""}`.slice(0, 300)
      };
      // 1) primary update by intent_id
      const { data: upd1, error: uErr1, count: cnt1 } = await sb.from("exchange_order_intents").update(patch).eq("intent_id", it.intent_id).select("intent_id", {
        count: "exact",
        head: true
      });
      if (uErr1) throw uErr1;
      // 2) fallback: if nothing updated (race with preview reinsert), promote by keys
      if ((!cnt1 || cnt1 === 0) && ok) {
        const { data: upd2, error: uErr2 } = await sb.from("exchange_order_intents").update(patch).eq("customer_id", it.customer_id).eq("date_closing", asOf).eq("side", it.side).is("exchange_order_id", null).is("valr_order_id", null).eq("status", "preview").select("intent_id", {
          count: "exact",
          head: true
        });
        if (uErr2) throw uErr2;
      }
      if (ok) {
        submitted++;
        submitted_intents.push({
          intent_id: String(it.intent_id),
          exchange_order_id: String(orderId)
        });
      } else {
        errors++;
      }
    }
    return new Response(JSON.stringify({
      ok: true,
      as_of: asOf,
      submitted,
      errors,
      submitted_intents
    }), {
      headers: cors(req)
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: String(e?.message || e)
    }), {
      status: 500,
      headers: cors(req)
    });
  }
});
