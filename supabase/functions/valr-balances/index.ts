// supabase/functions/valr-balances/index.ts
// Deno / Edge Functions
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// --- Project secrets (you configured custom names) ---
const SUPABASE_URL = Deno.env.get("SB_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("SB_URL / SB_SERVICE_ROLE_KEY not set. Falling back to SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
}
// Fallbacks just in case your project uses the default names elsewhere
const URL_FALLBACK = Deno.env.get("SUPABASE_URL");
const KEY_FALLBACK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN = createClient(SUPABASE_URL || URL_FALLBACK, SUPABASE_SERVICE_ROLE_KEY || KEY_FALLBACK, {
  auth: {
    persistSession: false
  }
});
// --- Helpers ---
async function hmacSha512Hex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {
    name: "HMAC",
    hash: "SHA-512"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
function ydayUTC() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function todayUTC() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
// --- Handler ---
serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  try {
    const body = await req.json().catch(()=>({}));
    const customer_id = Number(body?.customer_id);
    // The user-selected date (only for display/echo)
    const scan_date = body?.as_of_date && String(body.as_of_date).slice(0, 10) || ydayUTC();
    // Always write snapshots to the *current* day (UTC)
    const write_date = todayUTC();
    if (!customer_id) {
      return new Response(JSON.stringify({
        error: "customer_id is required"
      }), {
        status: 400,
        headers: CORS
      });
    }
    // 1) Load customer creds
    const { data: rows, error: credErr } = await ADMIN.from("customer_details").select("customer_id, customer_status, exchange_api_name, exchange_api_key, exchange_api_secret").eq("customer_id", customer_id).limit(1);
    if (credErr) {
      console.error("DB error:", credErr);
      return new Response(JSON.stringify({
        error: "Database error"
      }), {
        status: 500,
        headers: CORS
      });
    }
    const cred = rows?.[0];
    if (!cred) return new Response(JSON.stringify({
      error: "Customer not found"
    }), {
      status: 404,
      headers: CORS
    });
    // GUARD: only allow Active customers to snapshot balances
    if ((cred.customer_status || "").toUpperCase() !== "ACTIVE") {
      return new Response(JSON.stringify({
        ok: false,
        skipped: true,
        reason: "Customer is not Active",
        customer_id
      }), {
        status: 200,
        headers: CORS
      });
    }
    if ((cred.exchange_api_name || "").toUpperCase() !== "VALR") {
      return new Response(JSON.stringify({
        error: "Unsupported exchange for this customer"
      }), {
        status: 501,
        headers: CORS
      });
    }
    if (!cred.exchange_api_key || !cred.exchange_api_secret) {
      return new Response(JSON.stringify({
        error: "Missing exchange API credentials"
      }), {
        status: 400,
        headers: CORS
      });
    }
    // 2) Signed VALR balances request
    const ts = Date.now().toString();
    const method = "GET";
    const path = "/v1/account/balances?excludeZeroBalances=true";
    const prehash = ts + method + path; // GET has empty body in signature
    const signature = await hmacSha512Hex(prehash, cred.exchange_api_secret);
    const res = await fetch("https://api.valr.com" + path, {
      method,
      headers: {
        "X-VALR-API-KEY": cred.exchange_api_key,
        "X-VALR-TIMESTAMP": ts,
        "X-VALR-SIGNATURE": signature
      }
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("VALR error:", res.status, text);
      return new Response(JSON.stringify({
        error: "VALR error",
        detail: text
      }), {
        status: 502,
        headers: CORS
      });
    }
    const list = await res.json(); // array of balances
    // Index by currency code (ZAR, USDT, BTC)
    const by = Object.create(null);
    (Array.isArray(list) ? list : []).forEach((b)=>{
      const sym = (b.currency || b.asset || b.symbol || "").toString().toUpperCase();
      if (sym) by[sym] = b;
    });
    const pick = (sym)=>{
      const b = by[sym] || {};
      // VALR typically returns { currency, total, available, reserved, ... }
      const available = b.available != null ? Number(b.available) : null;
      const total = b.total != null ? Number(b.total) : null;
      const updatedAt = b.updatedAt || b.updateTime || null;
      return {
        available,
        total,
        updatedAt
      };
    };
    const btc = pick("BTC");
    const usdt = pick("USDT");
    const zar = pick("ZAR");
    // What we'll return to the UI
    const payload = {
      ok: true,
      customer_id,
      as_of_date: scan_date,
      written_as_of_date: write_date,
      btc,
      usdt,
      zar
    };
    const { data: existed } = await ADMIN.from("exchange_daily_balances").select("id", {
      count: "exact",
      head: true
    }).eq("customer_id", customer_id).eq("as_of_date", write_date);
    const wasExisting = !!existed; // true if row already there
    // ...do the upsert...
    payload.upsert = wasExisting ? "updated" : "inserted";
    payload.customer_status = "Active"; // ADD (purely informational)
    // 3) Snapshot into exchange_daily_balances  (UPSERT by (customer_id, as_of_date))
    const snapshot = {
      as_of_date: write_date,
      customer_id,
      source_exchange: "VALR",
      btc_total: btc.total ?? 0,
      btc_available: btc.available ?? 0,
      usdt_total: usdt.total ?? 0,
      usdt_available: usdt.available ?? 0,
      zar_total: zar.total ?? 0,
      zar_available: zar.available ?? 0,
      note: "snapshot from valr-balances"
    };
    // Requires a unique index on (customer_id, as_of_date) – see SQL below.
    const { error: snapErr } = await ADMIN.from("exchange_daily_balances").upsert(snapshot, {
      onConflict: "customer_id,as_of_date"
    });
    if (snapErr) {
      console.error("Snapshot upsert error:", snapErr);
    }
    return new Response(JSON.stringify(payload), {
      headers: CORS
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({
      error: "Unexpected error",
      detail: String(e?.message || e)
    }), {
      status: 500,
      headers: CORS
    });
  }
});
