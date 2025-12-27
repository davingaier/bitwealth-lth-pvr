// supabase/functions/valr-fees-harvester/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL");
const SB_KEY = Deno.env.get("Secret Key");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json",
};

const IGNORE_PAIR_FILTER = true; // set false once you’re done debugging
const VERSION =
  "valr-fees-harvester v1.4 (fix: /v1/orders/{id}, customerOrderId|clientOrderId, case-insensitive matching, chunked lookups)";

function ydayUTCISO(d?: string | null) {
  if (d) return d;
  const t = new Date(Date.now() - 86_400_000);
  return t.toISOString().slice(0, 10);
}

async function signVALR(ts: string, method: string, path: string, body: string, secret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(ts + method + path + body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function valrGet(path: string, k: string, s: string) {
  const ts = Date.now().toString();
  const sig = await signVALR(ts, "GET", path, "", s);
  const r = await fetch("https://api.valr.com" + path, {
    method: "GET",
    headers: {
      "X-VALR-API-KEY": k,
      "X-VALR-SIGNATURE": sig,
      "X-VALR-TIMESTAMP": ts,
    },
  });
  if (!r.ok) throw new Error(`VALR ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json().catch(() => ({} as any));
    const for_day = ydayUTCISO(body?.for_date || null); // default: yesterday UTC
    const onlyCustomer = body?.customer_id ? Number(body.customer_id) : null;

    const sb = createClient(SB_URL!, SB_KEY!, { auth: { persistSession: false } });

    // 1) Active VALR customers (optionally one, if provided)
    let cq = sb
      .from("customer_details")
      .select("customer_id, exchange_api_key, exchange_api_secret")
      .eq("customer_status", "Active")
      .eq("exchange_api_name", "VALR");
    if (onlyCustomer) cq = cq.eq("customer_id", onlyCustomer);

    const { data: custs, error: cErr } = await cq;
    if (cErr) throw cErr;

    const start = `${for_day}T00:00:00Z`;
    const end   = `${for_day}T23:59:59Z`;

    const PAIRS = new Set(["BTCUSDT", "USDTZAR", "ZARUSDT", "BTCZAR"]);

    let totalUpdated = 0;
    let scanned = 0;

    const dbg: any = { customers: [], summary: { customers_scanned: 0, updated_total: 0 } };

    for (const c of (custs || [])) {
      scanned++;

      const cdbg: any = {
        customer_id: c.customer_id,
        trades_pulled: 0,
        trades_fee_gt0: 0,
        unique_order_ids: 0,
        first_pass_intents_found: 0,
        fallback_intents_found: 0,
        not_found_after_fallback_sample: [] as string[],
        sample_valr_order_ids: [] as string[],
      };

      // 2) Pull trade history for the day (paginate)
      let skip = 0;
      // We'll keep original orderId for DB .in() filters, but do all in-memory keys lowercase
      const agg = new Map<string, { fee_btc: number; fee_usdt: number; fee_zar: number }>();
      const orderIdOriginal = new Map<string, string>(); // lower -> original
      const sampleIds: string[] = [];

      while (true) {
        const LIM = 100; // VALR limit
        const path = `/v1/account/tradehistory?skip=${skip}&limit=${LIM}&startTime=${start}&endTime=${end}`;
        let rows: any[] = [];

        try {
          rows = await valrGet(path, c.exchange_api_key, c.exchange_api_secret);
        } catch (e: any) {
          if (String(e?.message || '').includes('Number of records per request exceeded')) {
            const tiny = `/v1/account/tradehistory?skip=${skip}&limit=50&startTime=${start}&endTime=${end}`;
            rows = await valrGet(tiny, c.exchange_api_key, c.exchange_api_secret);
          } else {
            throw e;
          }
        }

        if (!Array.isArray(rows) || rows.length === 0) break;
        cdbg.trades_pulled += rows.length;

        for (const t of rows) {
          const pair = String(t.currencyPair || "").toUpperCase();
          if (!IGNORE_PAIR_FILTER && !PAIRS.has(pair)) continue;

          const rawOrderId = String(t.orderId || t.orderID || "").trim();
          if (!rawOrderId) continue;

          const orderId = rawOrderId.toLowerCase();
          orderIdOriginal.set(orderId, rawOrderId);

          const feeAmt = Math.abs(Number(t.feeAmount ?? t.fee ?? 0) || 0);
          if (feeAmt === 0) continue;
          cdbg.trades_fee_gt0++;

          const feeCur = String(t.feeCurrency ?? t.feeCurrencyCode ?? "").toUpperCase();

          if (!agg.has(orderId)) agg.set(orderId, { fee_btc: 0, fee_usdt: 0, fee_zar: 0 });
          const bucket = agg.get(orderId)!;

          if (feeCur === "BTC")  bucket.fee_btc  += feeAmt;
          if (feeCur === "USDT") bucket.fee_usdt += feeAmt;
          if (feeCur === "ZAR")  bucket.fee_zar  += feeAmt;

          if (sampleIds.length < 6) sampleIds.push(rawOrderId);
        }

        if (rows.length < LIM) break;
        skip += rows.length;
      }

      cdbg.unique_order_ids = agg.size;
      cdbg.sample_valr_order_ids = sampleIds;

      if (agg.size === 0) {
        dbg.customers.push(cdbg);
        continue;
      }

      // 3) FIRST PASS — match by exchange_order_id (exact in SQL, case-insensitive in-memory)
      const valrIdsOriginal = Array.from(orderIdOriginal.values());
      const batches = chunk(valrIdsOriginal, 1000);
      const byOrder = new Map<string, any>(); // lowercased key

      for (const batch of batches) {
        const { data: intents, error: iErr } = await sb
          .from("exchange_order_intents")
          .select("intent_id, exchange_order_id, fee_btc, fee_usdt, fee_zar")
          .in("exchange_order_id", batch);
        if (iErr) throw iErr;

        for (const i of (intents || [])) {
          const k = String(i.exchange_order_id || "").trim().toLowerCase();
          if (k) byOrder.set(k, i);
        }
      }

      // Apply updates for first-pass matches & collect unmatched ids (lowercased)
      const unmatched: string[] = [];
      for (const [orderIdLower, fees] of agg.entries()) {
        const row = byOrder.get(orderIdLower);
        if (!row) { unmatched.push(orderIdLower); continue; }

        const patch: Record<string, number | string> = {};
        if ((Number(row.fee_btc  || 0) === 0) && fees.fee_btc  > 0) patch["fee_btc"]  = Number(fees.fee_btc.toFixed(8));
        if ((Number(row.fee_usdt || 0) === 0) && fees.fee_usdt > 0) patch["fee_usdt"] = Number(fees.fee_usdt.toFixed(8));
        if ((Number(row.fee_zar  || 0) === 0) && fees.fee_zar  > 0) patch["fee_zar"]  = Number(fees.fee_zar.toFixed(2));

        if (Object.keys(patch).length) {
          patch["notes"] = "Fees harvested from VALR API";
          const { error: updErr } = await sb
            .from("exchange_order_intents")
            .update(patch)
            .eq("intent_id", row.intent_id);
          if (updErr) throw updErr;
          totalUpdated++;
          cdbg.first_pass_intents_found++;
        }
      }

      // 4) FALLBACK — translate VALR orderId -> customer/client order id, then match by exchange_order_id OR customer_order_id
      if (unmatched.length > 0) {
        const toTranslate = unmatched.slice(0, 50); // realistic batch; most days are tiny
        const translated: Array<{ valrLower: string; clientId: string }> = [];

        for (const lower of toTranslate) {
          const original = orderIdOriginal.get(lower)!;
          let det: any = null;

          // Correct endpoint first; legacy path as best-effort fallback
          try {
            det = await valrGet(`/v1/orders/${original}`, c.exchange_api_key, c.exchange_api_secret);
          } catch {
            try { det = await valrGet(`/v1/orders/id/${original}`, c.exchange_api_key, c.exchange_api_secret); } catch {}
          }

          const clientId = String(det?.customerOrderId ?? det?.clientOrderId ?? "").trim();
          if (clientId) translated.push({ valrLower: lower, clientId });
        }

        if (translated.length > 0) {
          const clientIds = translated.map(t => t.clientId);
          const tBatches = chunk(clientIds, 1000);

          // Build case-insensitive lookup over both columns
          const secondLookup = new Map<string, any>(); // lowercased key

          for (const batch of tBatches) {
            const [byEx, byCust] = await Promise.all([
              sb.from("exchange_order_intents")
                .select("intent_id, exchange_order_id, customer_order_id, fee_btc, fee_usdt, fee_zar")
                .in("exchange_order_id", batch),
              sb.from("exchange_order_intents")
                .select("intent_id, exchange_order_id, customer_order_id, fee_btc, fee_usdt, fee_zar")
                .in("customer_order_id", batch),
            ]);

            if (byEx.error) throw byEx.error;
            if (byCust.error) throw byCust.error;

            for (const i of (byEx.data || [])) {
              const k = String(i.exchange_order_id || "").trim().toLowerCase();
              if (k) secondLookup.set(k, i);
            }
            for (const i of (byCust.data || [])) {
              const k = String(i.customer_order_id || "").trim().toLowerCase();
              if (k) secondLookup.set(k, i);
            }
          }

          // Apply patches for fallback matches
          for (const { valrLower, clientId } of translated) {
            const row =
              secondLookup.get(clientId.toLowerCase()) ??
              secondLookup.get(orderIdOriginal.get(valrLower)!.toLowerCase());

            if (!row) {
              if (cdbg.not_found_after_fallback_sample.length < 6) {
                cdbg.not_found_after_fallback_sample.push(`${orderIdOriginal.get(valrLower)}→${clientId}`);
              }
              continue;
            }

            const fees = agg.get(valrLower)!;
            const patch: Record<string, number | string> = {};
            if ((Number(row.fee_btc  || 0) === 0) && fees.fee_btc  > 0) patch["fee_btc"]  = Number(fees.fee_btc.toFixed(8));
            if ((Number(row.fee_usdt || 0) === 0) && fees.fee_usdt > 0) patch["fee_usdt"] = Number(fees.fee_usdt.toFixed(8));
            if ((Number(row.fee_zar  || 0) === 0) && fees.fee_zar  > 0) patch["fee_zar"]  = Number(fees.fee_zar.toFixed(2));

            if (Object.keys(patch).length) {
              patch["notes"] = "Fees harvested from VALR API (matched by client order id)";
              const { error: updErr } = await sb
                .from("exchange_order_intents")
                .update(patch)
                .eq("intent_id", row.intent_id);
              if (updErr) throw updErr;
              totalUpdated++;
              cdbg.fallback_intents_found++;
            }
          }
        }
      }

      dbg.customers.push(cdbg);
    }

    dbg.summary.customers_scanned = scanned;
    dbg.summary.updated_total = totalUpdated;

    return new Response(
      JSON.stringify({
        ok: true,
        day: for_day,
        customers: scanned,
        updated: totalUpdated,
        version: VERSION,
        debug: dbg, // keep for now; remove once you see updates incrementing
      }),
      { headers: CORS },
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e), version: VERSION }),
      { status: 500, headers: CORS },
    );
  }
});
