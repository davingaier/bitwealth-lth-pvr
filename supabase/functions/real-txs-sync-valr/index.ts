// deno-lint-ignore-file no-explicit-any
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { crypto } from 'https://deno.land/std@0.224.0/crypto/mod.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE = Deno.env.get('Secret Key');
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
// ---- CORS (use on absolutely every response) ----
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const ok = (json, status = 200)=>new Response(JSON.stringify(json), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json'
    }
  });
const fail = (message, status = 500)=>new Response(JSON.stringify({
    ok: false,
    error: message
  }), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json'
    }
  });
// Simple HMAC for VALR signing (GET /v1/account/tradehistory?...)
// x-valr-signature = HMAC_SHA512(secret, timestamp + method + path + body)
async function valrAuth(secret, method, path, body = '') {
  const timestamp = String(Date.now());
  const payload = timestamp + method.toUpperCase() + path + body;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {
    name: 'HMAC',
    hash: 'SHA-512'
  }, false, [
    'sign'
  ]);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const signature = Array.from(new Uint8Array(sigBuf)).map((b)=>b.toString(16).padStart(2, '0')).join('');
  return {
    'X-VALR-TIMESTAMP': timestamp,
    'X-VALR-SIGNATURE': signature
  };
}
async function fetchValrHistory(apiKey, apiSecret, from, to) {
  // VALR trade history is paged with skip/limit (max 500). We page until empty.
  const base = 'https://api.valr.com';
  let skip = 0;
  const limit = 100 // <= keep it safe
  ;
  const out = [];
  while(true){
    const path = `/v1/account/tradehistory?skip=${skip}&limit=${limit}`;
    const headers = {
      'X-VALR-API-KEY': apiKey,
      ...await valrAuth(apiSecret, 'GET', path)
    };
    const res = await fetch(base + path, {
      headers
    });
    if (!res.ok) {
      const t = await res.text().catch(()=>'');
      throw new Error(`VALR GET ${path} ${res.status}: ${t}`);
    }
    const page = await res.json();
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < limit) break;
    skip += limit;
  }
  return out;
}
function m(v, d) {
  return v === null || v === undefined ? d : v;
}
function toUTC(ts) {
  // accept number, ISO-ish string, or CSV-style "YYYY/MM/DD HH:mm:ss"
  if (typeof ts === 'number') {
    try {
      return new Date(ts).toISOString();
    } catch  {
      return null;
    }
  }
  const raw = String(ts ?? '').trim();
  if (!raw) return null;
  // normalise: slashes→dashes; space→'T'; force UTC if no offset
  let norm = raw.replace(/\//g, '-').replace(' ', 'T');
  if (!/[zZ]$/.test(norm) && !/[\+\-]\d{2}:\d{2}$/.test(norm)) norm += 'Z';
  const d = new Date(norm);
  return Number.isFinite(+d) ? d.toISOString() : null;
}
Deno.serve(async (req)=>{
  // --- CORS preflight must return 2xx + CORS headers, with no body parsing ---
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders
      }
    });
  }
  // Non-POST guard (also CORS’ed)
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        'content-type': 'application/json'
      }
    });
  }
  // From here on, it's safe to read the body
  let body = {};
  try {
    body = await req.json();
  } catch  {
    body = {};
  }
  try {
    // normalize sloppy inputs like '2025/09/13' → '2025-09-13'
    const normDay = (s)=>s ? s.replace(/\//g, '-').slice(0, 10) : null;
    const from = normDay(body.from);
    const to = normDay(body.to);
    // helpers to parse a UTC midnight/end-of-day safely
    const dayToMs = (s, end = false)=>{
      if (!s) return end ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      const stamp = Date.parse(s + (end ? 'T23:59:59Z' : 'T00:00:00Z'));
      return Number.isFinite(stamp) ? stamp : end ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    };
    // Get 1 customer or all active VALR customers
    let customers = [];
    if (body.customer_id) {
      const { data, error } = await sb.from('customer_details').select('customer_id, exchange_api_key, exchange_api_secret').eq('customer_id', body.customer_id).eq('exchange_api_name', 'VALR').single();
      if (error || !data) throw error ?? new Error('Customer not found or not VALR');
      customers = [
        data
      ];
    } else {
      const { data, error } = await sb.from('customer_details').select('customer_id, exchange_api_key, exchange_api_secret').eq('customer_status', 'Active').eq('exchange_api_name', 'VALR');
      if (error) return fail(`list customers: ${error.message || error.toString?.() || String(error)}`);
      customers = data || [];
    }
    // Debug: return a few raw records from VALR so we can verify mapping
    if (body.debug) {
      if (!customers.length) {
        return fail('No VALR customers found', 400);
      }
      const c0 = customers[0];
      const sample = await fetchValrHistory(c0.exchange_api_key, c0.exchange_api_secret, from || undefined, to || undefined);
      return ok({
        ok: true,
        customers: customers.length,
        sample: sample.slice(0, 5)
      });
    }
    let inserted = 0;
    for (const c of customers){
      if (!c.exchange_api_key || !c.exchange_api_secret) continue;
      const rows = await fetchValrHistory(c.exchange_api_key, c.exchange_api_secret, from || undefined, to || undefined);
      // Map VALR payload → real_exchange_txs rows (adjust property names if your VALR shape differs)
      // Known payload fields from your CSV screenshot:
      //  date, transactionType, debitCurrency, debitValue, creditCurrency, creditValue,
      //  feeCurrency, feeValue, tradeCurrencyPair, tradePriceCurrency, tradePrice, orderId
      // Split 'BTCUSDT' -> { base:'BTC', quote:'USDT' }
      // Split a symbol like 'BTCUSDT' deterministically by known quote codes.
      const splitPair = (pair)=>{
        const p = String(pair || '').toUpperCase();
        const quotes = [
          'USDT',
          'ZAR',
          'BTC'
        ]; // extend if you add more markets later
        for (const q of quotes){
          if (p.endsWith(q) && p.length > q.length) {
            return {
              base: p.slice(0, -q.length),
              quote: q
            };
          }
        }
        return {
          base: null,
          quote: null
        };
      };
      const mapped = rows.map((r)=>{
        // New trade timestamp: tradedAt (fallback to legacy date/timestamp)
        const iso = toUTC(r.tradedAt ?? r.date ?? r.timestamp);
        if (!iso) return null; // drop unparseable rows
        // Pair + side
        const pair = String(r.currencyPair ?? r.tradeCurrencyPair ?? '').trim();
        const { base, quote } = splitPair(pair);
        const side = String(r.side ?? '').toUpperCase() || (String(r.transactionType ?? '').toUpperCase().includes('SELL') ? 'SELL' : String(r.transactionType ?? '').toUpperCase().includes('BUY') ? 'BUY' : '');
        // Price & quantity
        const price = r.price != null ? Number(r.price) : r.tradePrice != null ? Number(r.tradePrice) : null;
        const qty = r.quantity != null ? Number(r.quantity) : null;
        // Compute debit/credit from pair+side+price+qty
        let debit_currency = null;
        let debit_value = 0;
        let credit_currency = null;
        let credit_value = 0;
        if (base && quote && price != null && qty != null && (side === 'BUY' || side === 'SELL')) {
          if (side === 'BUY') {
            debit_currency = quote;
            debit_value = qty * price;
            credit_currency = base;
            credit_value = qty;
          } else {
            debit_currency = base;
            debit_value = qty;
            credit_currency = quote;
            credit_value = qty * price;
          }
        } else {
          // Legacy CSV-like fallbacks if present
          debit_currency = r.debitCurrency ? String(r.debitCurrency) : null;
          debit_value = r.debitValue != null ? Number(r.debitValue) : 0;
          credit_currency = r.creditCurrency ? String(r.creditCurrency) : null;
          credit_value = r.creditValue != null ? Number(r.creditValue) : 0;
        }
        // Fees in the new shape
        const fee_currency = r.feeCurrency ? String(r.feeCurrency) : r.fee_currency ? String(r.fee_currency) : null;
        const fee_value = r.fee != null ? Number(r.fee) : r.feeValue != null ? Number(r.feeValue) : null;
        // Unique id for upsert: trade id (id) > orderId > deterministic fallback
        const tradeId = r.id ? String(r.id) : '';
        const orderId = r.orderId ? String(r.orderId) : String(r.orderIdReference ?? '');
        const exchange_order_id = tradeId || orderId || `fill:${iso}:${pair}:${side}:${qty ?? ''}:${price ?? ''}`;
        // DB computes "kind" (generated column) – do not send from EF

        return {
          customer_id: c.customer_id,
          transaction_timestamp: iso,
          exchange_order_id,
          // VALR trade feed doesn’t include order type (limit/market). We’ll enrich from intent below.
          tx_type: 'TRADE',
          currency_pair: pair || null,
          debit_currency,
          debit_value,
          credit_currency,
          credit_value,
          fee_currency,
          fee_value,
          // Price is in quote currency (USDT for BTCUSDT, ZAR for USDTZAR)
          trade_price_currency: quote || (r.tradePriceCurrency ? String(r.tradePriceCurrency) : null),
          trade_price: price != null ? price : r.tradePrice != null ? Number(r.tradePrice) : null,
          trade_side: side || null,
          source_signal: null,
          manual: true,
          avg_price: null
          
        };
      }).filter(Boolean);
      const fromMs = dayToMs(from, false);
      const toMs = dayToMs(to, true);
      // Collect IDs to match against intents (both VALR orderId and our customerOrderId → intent-<uuid>)
      const orderIds = rows.map((r)=>r.orderId).filter(Boolean);
      const intentIds = rows.map((r)=>String(r.customerOrderId || '').replace(/^intent-/, '')).filter((s)=>!!s && /^[0-9a-f-]{36}$/i.test(s));
      // Fetch intents in two passes and merge
      const intentsByOrderId = new Map();
      const intentsByIntentId = new Map();
      if (orderIds.length) {
        const { data } = await sb.from('exchange_order_intents').select('intent_id, exchange_order_id, type, source_signal, avg_price').in('exchange_order_id', orderIds);
        (data || []).forEach((i)=>intentsByOrderId.set(String(i.exchange_order_id), i));
      }
      if (intentIds.length) {
        const { data } = await sb.from('exchange_order_intents').select('intent_id, exchange_order_id, type, source_signal, avg_price').in('intent_id', intentIds);
        (data || []).forEach((i)=>intentsByIntentId.set(String(i.intent_id), i));
      }
      // Enrich mapped rows with intent data when available
      const enriched = mapped.map((x, idx)=>{
        const raw = rows[idx];
        const oid = raw?.orderId ? String(raw.orderId) : null;
        const iid = raw?.customerOrderId ? String(raw.customerOrderId).replace(/^intent-/, '') : null;
        const intent = oid && intentsByOrderId.get(oid) || iid && intentsByIntentId.get(iid);
        if (!intent) return x;
        return {
          ...x,
          tx_type: (intent.type || 'TRADE').toUpperCase(),
          source_signal: intent.source_signal || x.source_signal,
          manual: false,
          avg_price: intent.avg_price ?? x.avg_price
        };
      });
      const filtered = enriched.filter((r)=>{
        const ms = Date.parse(String(r.transaction_timestamp));
        return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
      });
      // Deduplicate by upsert key within the batch (customer_id + exchange_order_id)
      const dedup = Array.from(new Map(filtered.map((x)=>[
          `${x.customer_id}-${x.exchange_order_id}`,
          x
        ])).values());
      // Sanitize numbers (avoid NaN/Infinity)
      const clean = dedup.map((x)=>({
          ...x,
          debit_value: Number.isFinite(Number(x.debit_value)) ? Number(x.debit_value) : 0,
          credit_value: Number.isFinite(Number(x.credit_value)) ? Number(x.credit_value) : 0,
          fee_value: x.fee_value == null || Number.isFinite(Number(x.fee_value)) ? x.fee_value : null,
          trade_price: x.trade_price == null || Number.isFinite(Number(x.trade_price)) ? x.trade_price : null,
          tx_type: x.tx_type || 'TRADE'
        }));
      // Upsert (unique on (customer_id, exchange_order_id))
      if (clean.length) {
        const { data, error } = await sb.from('real_exchange_txs').upsert(clean, {
          onConflict: 'customer_id,exchange_order_id'
        }).select('id');
        if (error) {
          console.error('UPSERT real_exchange_txs ERROR:', error);
          return fail(`upsert real_exchange_txs: ${error.message || error.details || JSON.stringify(error)}`);
        }
        inserted += data?.length ?? 0;
      }
    }
    return ok({
      ok: true,
      customers: customers.length,
      inserted
    });
  } catch (e) {
    return fail(String(e?.message || e));
  }
});
