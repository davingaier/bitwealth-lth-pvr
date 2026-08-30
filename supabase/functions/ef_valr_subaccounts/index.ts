// ef_valr_subaccounts / index.ts
// Lists your VALR sub-accounts so you can see subaccountId / label / etc.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { requireOrgAdmin } from "../_shared/adminAuth.ts";

const API_BASE = Deno.env.get("VALR_API_BASE") ?? "https://api.valr.com";

// --- HMAC helper (same logic as your existing valrClient.ts) ---
async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function valrPrivateRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const apiKey = Deno.env.get("VALR_API_KEY");
  const apiSecret = Deno.env.get("VALR_API_SECRET");

  if (!apiKey || !apiSecret) {
    throw new Error("VALR_API_KEY or VALR_API_SECRET missing");
  }

  const timestamp = Date.now().toString();
  const json = body ? JSON.stringify(body) : "";
  const payloadToSign = timestamp + method.toUpperCase() + path + json;
  const signature = await hmacSha512Hex(apiSecret, payloadToSign);

  const resp = await fetch(API_BASE + path, {
    method,
    headers: {
      "X-VALR-API-KEY": apiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "Content-Type": "application/json",
    },
    body: json || undefined,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `VALR ${method} ${path} failed: ${resp.status} ${resp.statusText} – ${text}`,
    );
  }

  if (resp.status === 204) return undefined;
  return await resp.json();
}

// Simple CORS helper so you can hit this from the browser if you want
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SB_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (SB_URL && SB_KEY) {
    const caller = await requireOrgAdmin(createClient(SB_URL, SB_KEY), req, SB_KEY);
    if (!caller.ok) {
      return new Response(JSON.stringify({ error: caller.error }), {
        status: caller.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    // This is the VALR endpoint that lists all sub-accounts
    const data = await valrPrivateRequest("GET", "/v1/account/subaccounts");

    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    console.error("ef_valr_subaccounts error", e);
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e ?? "unknown") }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
