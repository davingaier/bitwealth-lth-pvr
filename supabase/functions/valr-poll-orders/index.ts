// supabase/functions/valr-poll-orders/index.ts
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
function monthYYYYMM(isoDate) {
  const d = new Date(isoDate + "T00:00:00Z");
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
async function fetchOrderFills(orderId, cred, pair) {
  const tryGet = async (path)=>{
    const ts = Date.now().toString();
    const sig = await signVALR(ts, "GET", path, "", cred.exchange_api_secret);
    return fetch("https://api.valr.com" + path, {
      method: "GET",
      headers: {
        "X-VALR-API-KEY": cred.exchange_api_key,
        "X-VALR-TIMESTAMP": ts,
        "X-VALR-SIGNATURE": sig
      }
    });
  };
  // 1) prefer /{PAIR}/{orderId}/trades if we know the pair
  if (pair) {
    let r = await tryGet(`/v1/orders/${encodeURIComponent(pair)}/${encodeURIComponent(orderId)}/trades`);
    try {
      const j = await r.json();
      if (r.ok && Array.isArray(j)) return j;
    } catch  {}
  }
  // 2) fall back to legacy /{orderId}/trades
  try {
    const r2 = await tryGet(`/v1/orders/${encodeURIComponent(orderId)}/trades`);
    const j2 = await r2.json();
    return r2.ok && Array.isArray(j2) ? j2 : [];
  } catch  {
    return [];
  }
}
function feesFromFills(fills) {
  let fee_usdt = 0, fee_btc = 0, qSum = 0, notionalSum = 0;
  for (const f of Array.isArray(fills) ? fills : []){
    const feeAmt = Number(f?.feeAmount ?? f?.fee ?? 0);
    const feeCur = String(f?.feeCurrency ?? f?.feeCurrencyCode ?? "").toUpperCase();
    if (feeCur === "USDT") fee_usdt += feeAmt;
    if (feeCur === "BTC") fee_btc += feeAmt;
    const q = Number(f?.quantity ?? f?.filledQuantity ?? 0);
    const px = Number(f?.price ?? 0);
    if (q > 0 && px > 0) {
      qSum += q;
      notionalSum += q * px;
    }
  }
  const avg_price = qSum > 0 ? notionalSum / qSum : null;
  return {
    fee_usdt,
    fee_btc,
    avg_price
  };
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors(req)
  });
  try {
    const body = await req.json().catch(()=>({}));
    const for_date = body?.for_date;
    const intent_ids = Array.isArray(body?.intent_ids) ? body.intent_ids.map(String) : undefined;
    // Trade morning by default (day after the closing date)
    // With the generated column, "today" == the natural poll day
    const asOf = for_date || new Date().toISOString().slice(0, 10);
    const sb = createClient(SB_URL, SB_KEY, {
      auth: {
        persistSession: false
      }
    });
    // Intents to check
    // need symbol to derive PAIR for GET/cancel/fills endpoints
    let q = sb.from("exchange_order_intents").select("intent_id, customer_id, side, symbol, status, notes, exchange_order_id, valr_order_id, submitted_at, intent_date");
    if (intent_ids?.length) {
      // poll exactly these rows regardless of current status/date
      q = q.in("intent_id", intent_ids);
    } else {
      // default daily window: match by intent_date OR submitted_at
      const start = new Date(`${asOf}T00:00:00Z`).toISOString();
      const end = new Date(new Date(start).getTime() + 86_400_000).toISOString();
      q = q.in("status", [
        "submitted",
        "executing",
        "partially_filled"
      ]).or(`and(intent_date.gte.${start},intent_date.lt.${end}),` + // TIMESTAMP rows
      `and(submitted_at.gte.${start},submitted_at.lt.${end}),` + // submitted today
      `intent_date.eq.${asOf}` // DATE rows
      );
    }
    let { data: intents, error: iErr } = await q;
    if (iErr) throw iErr;
    // Fallback: if nothing matched the window, poll any stragglers still open (regardless of date)
    if (!intent_ids?.length && (!intents || intents.length === 0)) {
      const q2 = sb.from("exchange_order_intents").select("intent_id, customer_id, side, symbol, status, notes, exchange_order_id, valr_order_id, submitted_at, intent_date").in("status", [
        "submitted",
        "executing",
        "partially_filled"
      ]).not("exchange_order_id", "is", null);
      const { data: intents2, error: iErr2 } = await q2;
      if (iErr2) throw iErr2;
      intents = intents2 || [];
    }
    const checked = intents.length;
    // Declare these BEFORE any early return
    let updated = 0;
    const per_intent = [];
    if (!intents?.length) {
      return new Response(JSON.stringify({
        ok: true,
        for_date: asOf,
        checked,
        updated,
        per_intent
      }), {
        headers: cors(req)
      });
    }
    const uniqueCids = Array.from(new Set(intents.map((r)=>Number(r.customer_id))));
    const { data: creds, error: cErr } = await sb.from("customer_details").select("customer_id, exchange_api_name, exchange_api_key, exchange_api_secret").in("customer_id", uniqueCids);
    if (cErr) throw cErr;
    const credByCid = new Map();
    (creds || []).forEach((c)=>{
      const name = String(c.exchange_api_name ?? "").trim().toUpperCase();
      if ((name === "VALR" || name.includes("VALR")) && c.exchange_api_key && c.exchange_api_secret) {
        credByCid.set(Number(c.customer_id), c);
      } else if (!name && c.exchange_api_key && c.exchange_api_secret) {
        // Accept rows where the name is blank but valid keys exist
        credByCid.set(Number(c.customer_id), c);
      }
    });
    const { data: dd } = await sb.from("daily_data").select("omega_on_off").eq("date_closing", asOf).maybeSingle();
    const omegaOn = !!dd?.omega_on_off;
    for (const it of intents){
      const cid = Number(it.customer_id);
      const cred = credByCid.get(cid);
      // Accept both new and legacy columns
      const orderIdRaw = it.exchange_order_id ?? it.valr_order_id;
      const orderId = orderIdRaw && !/^(null|undefined)$/i.test(String(orderIdRaw)) ? String(orderIdRaw) : "";
      // --- AUTO-PROMOTE SAFEGUARD ---
      // Promote if we see an order id (new/legacy) OR the row already has submitted_at.
      if (String(it.status).toLowerCase() === "preview" && (orderId || it.submitted_at)) {
        await sb.from("exchange_order_intents").update({
          status: "submitted",
          submitted_at: it.submitted_at || new Date().toISOString()
        }).eq("intent_id", it.intent_id);
        updated++;
        per_intent.push({
          intent_id: String(it.intent_id),
          status: "submitted"
        });
        continue;
      }
      // --- /AUTO-PROMOTE ---
      if (!cred || !orderId) {
        per_intent.push({
          intent_id: String(it.intent_id),
          status: String(it.status || "").toLowerCase(),
          filledQuantity: 0,
          originalQuantity: 0,
          filled_quantity: 0,
          original_quantity: 0,
          // debug fields help you spot the problem instantly in Network → Response
          _skipped_reason: !cred ? "no_credentials" : "no_order_id",
          _customer_id: Number(it.customer_id),
          _has_order_id: !!orderId
        });
        continue;
      }
      // Try GET with explicit pair first, then fall back to legacy path
      const pair = String(it.symbol || "BTCUSDT").toUpperCase();
      const tryGet = async (path)=>{
        const ts = Date.now().toString();
        const sig = await signVALR(ts, "GET", path, "", cred.exchange_api_secret);
        return fetch("https://api.valr.com" + path, {
          method: "GET",
          headers: {
            "X-VALR-API-KEY": cred.exchange_api_key,
            "X-VALR-TIMESTAMP": ts,
            "X-VALR-SIGNATURE": sig
          }
        });
      };
      let res = await tryGet(`/v1/orders/${encodeURIComponent(pair)}/${encodeURIComponent(orderId)}`);
      let j = null;
      try {
        j = await res.json();
      } catch  {}
      if (!res.ok || !j) {
        // 1) pair-agnostic history summary to discover authoritative currencyPair
        let resId = await tryGet(`/v1/orders/history/summary/orderid/${encodeURIComponent(orderId)}`);
        let jId = null;
        try { jId = await resId.json(); } catch {}
        if (!resId.ok || !jId) {
          // 2) fall back to legacy id-only lookup
          resId = await tryGet(`/v1/orders/${encodeURIComponent(orderId)}`);
          try { jId = await resId.json(); } catch {}
        }
        if (!resId.ok || !jId) {
          per_intent.push({
            intent_id: String(it.intent_id),
            status: String(it.status || "").toLowerCase(),
            _skipped_reason: "order_lookup_failed",
            _pair_tried: pair
          });
          continue;
        }
        // 3) if a pair was revealed, retry GET with that pair for richer fields

        const discoveredPair = (jId?.currencyPair || jId?.currencyPairSymbol || "").toString().toUpperCase();
        if (discoveredPair) {
          res = await tryGet(`/v1/orders/${encodeURIComponent(discoveredPair)}/${encodeURIComponent(orderId)}`);
          j = null;
          try {
            j = await res.json();
          } catch  {}
          if (!res.ok || !j) {
            // fall back to id-only payload if pair lookup still fails
            j = jId;
          }
        } else {
          // no pair in id-only payload; proceed with it
          j = jId;
        }
      }
      const valrStatus = String(j?.status ?? j?.orderStatus ?? j?.orderStatusType ?? "");
      const statusLower = valrStatus.toLowerCase();
      const typeLower = String(j?.orderStatusType ?? "").toLowerCase();
      // Parse quantities defensively (VALR sometimes omits remainingQuantity)
      const origQty = Number(j?.originalQuantity ?? j?.orderQuantity ?? j?.quantity ?? 0) || 0;
      const filledQty = Number(j?.filledQuantity ?? j?.totalFilledQuantity ?? 0) || 0;
      let remainingQty = Number(j?.remainingQuantity ?? j?.openQuantity ?? (Number.isFinite(origQty) && Number.isFinite(filledQty) ? Math.max(0, origQty - filledQty) : NaN));
      // Normalise terminal states more broadly
      const isCancelled = /(^|[^a-z])(cancel|canceled|cancelled|voided)($|[^a-z])/.test(statusLower);
      const isFullyFilledByTxt = /(^|[^a-z])filled($|[^a-z])/.test(statusLower) && !/partial/.test(statusLower);
      const isCompletedByTxt = /(^|[^a-z])(complete|completed|done)($|[^a-z])/.test(statusLower) && !/partial/.test(statusLower);
      const isFilledByType = typeLower === "filled";
      const noRemaining = Number.isFinite(remainingQty) && remainingQty <= 0;
      // Explicit “error-like” outcomes seen on venues
      const isErrorish = /reject|rejected|fail|failed|expire|expired|invalid/.test(statusLower);
      // VALR sometimes exposes an isActive flag; use it if present
      const isInactive = typeof j?.isActive === "boolean" ? j.isActive === false : undefined;
      let newStatus;
      if (isErrorish) {
        newStatus = "error";
      } else if (isCancelled) {
        newStatus = "cancelled";
      } else if (isFullyFilledByTxt || isCompletedByTxt || isFilledByType || noRemaining || isInactive === true && (noRemaining || origQty > 0 && filledQty >= origQty)) {
        newStatus = "filled";
      } else if (/partial/.test(statusLower) || /partial/.test(typeLower) || origQty > 0 && filledQty > 0 && filledQty < origQty) {
        newStatus = "partially_filled";
      } else {
        newStatus = "executing";
      }
      // Fills/fees/avg (prefer the actual pair reported by VALR for this order)
      let feesPatch = {};
      try {
        const actualPair = (j?.currencyPair || j?.currencyPairSymbol || pair).toString().toUpperCase();
        const fills = await fetchOrderFills(orderId, cred, actualPair);
        const { fee_usdt, fee_btc, avg_price } = feesFromFills(fills);
        if (fee_usdt > 0) feesPatch.fee_usdt = fee_usdt;
        if (fee_btc > 0) feesPatch.fee_btc = fee_btc;
        if (Number.isFinite(avg_price) && avg_price > 0) feesPatch.avg_price = avg_price;
      } catch  {}
      const terminal = newStatus === "filled" || newStatus === "cancelled" || newStatus === "error";
      const { error: uErr } = await sb.from("exchange_order_intents").update({
        status: newStatus,
        notes: JSON.stringify({
          status: valrStatus,
          type: j?.orderStatusType ?? null,
          filled: filledQty,
          original: origQty
        }),
        ...terminal ? {
          closed_at: new Date().toISOString()
        } : {},
        ...feesPatch
      }).eq("intent_id", it.intent_id);
      if (uErr) {
        per_intent.push({
          intent_id: String(it.intent_id),
          status: "error",
          _update_error: uErr.message ?? String(uErr)
        });
        continue;
      }
      updated++;
      per_intent.push({
        intent_id: String(it.intent_id),
        status: String(newStatus || "").toLowerCase(),
        // camelCase (new UI) + snake_case (older UI) for safety
        filledQuantity: filledQty,
        originalQuantity: origQty,
        filled_quantity: filledQty,
        original_quantity: origQty
      });
      // NEW: keep real_exchange_txs in sync when an order reaches terminal "filled"
      if (newStatus === "filled") {
        const fillISO = asOf; // poll is per-day; good enough as the window for sync
        await sb.functions.invoke("real-txs-sync-valr", {
          body: {
            customer_id: cid,
            from: fillISO,
            to: fillISO
          }
        }).catch(()=>{});
      }
      // Omega SAB budget accounting on terminal fill
      if (omegaOn && newStatus === "filled" && origQty > 0 && /omega/i.test(String(it.notes || ""))) {
        const tradePx = Number(j?.price ?? feesPatch?.avg_price ?? 0);
        if (tradePx > 0) {
          const notional = (filledQty > 0 ? filledQty : origQty) * tradePx;
          const m = monthYYYYMM(asOf);
          const incIn = /sell/i.test(String(it.side)) ? notional : 0;
          const incOut = /buy/i.test(String(it.side)) ? notional : 0;
          await sb.rpc("sab_budget_touch", {
            p_customer_id: cid,
            p_exchange: "VALR",
            p_month: m,
            p_usdt_in: incIn,
            p_usdt_out: incOut
          }).catch(()=>{});
        }
      }
    }
    return new Response(JSON.stringify({
      ok: true,
      for_date: asOf,
      checked,
      updated,
      per_intent
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
