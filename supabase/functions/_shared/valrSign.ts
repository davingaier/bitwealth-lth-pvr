// _shared/valrSign.ts — server-side VALR request signing (2026-11-05 hardening, stage 1).
//
// Edge Functions no longer need VALR API *secrets*: `lth_pvr.valr_sign()` holds them in Vault and returns only
// { api_key, subaccount_id, ts, signature }. During rollout we fall back to local HMAC signing when
//   (a) the RPC says the Vault slot is not configured yet  ("VALR_SECRET_NOT_CONFIGURED"), and
//   (b) a secret is still available locally (credentials.apiSecret or VALR_API_SECRET env).
// Once the Vault slots are filled and VALR_API_SECRET is removed from Edge Function secrets, only the RPC path exists.
//
// Self-check: while both paths are available, the first call per isolate signs both ways and raises a critical
// alert if the signatures disagree — so a mismatch is caught before it costs a trade.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getServiceKey } from "./supabaseKeys.ts";

export interface SignInput {
  customerId?: number | null;      // api/finova customers → their own Vault key; subaccount/null → master key
  subaccountId?: string | null;    // explicit X-VALR-SUB-ACCOUNT-ID (master-key signing only)
  verb: string;
  path: string;
  body: string;                    // JSON string or ""
  /** Local fallback material (legacy). Never required once Vault is populated. */
  localApiKey?: string | null;
  localApiSecret?: string | null;
}

export interface SignedHeaders {
  headers: Record<string, string>;
  mode: "server" | "local";
}

// deno-lint-ignore no-explicit-any
let _sb: any = null;
// deno-lint-ignore no-explicit-any
function sb(): any {
  if (!_sb) {
    const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "";
    _sb = createClient(url, getServiceKey() ?? "", { auth: { persistSession: false } });
  }
  return _sb;
}

const enc = new TextEncoder();
export async function localHmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function scopeForPath(path: string): "trade" | "withdraw" {
  return /\/withdraw(\b|$)/.test(path) ? "withdraw" : "trade";
}

/** Env switch for emergencies: VALR_SIGN_MODE=local forces the legacy path (only works while a secret is local). */
function serverSigningDisabled(): boolean {
  return (Deno.env.get("VALR_SIGN_MODE") ?? "").toLowerCase() === "local";
}

let _selfChecked = false;

export async function signValrRequest(input: SignInput): Promise<SignedHeaders> {
  const verb = input.verb.toUpperCase();
  const body = input.body ?? "";
  const localSecret = input.localApiSecret || Deno.env.get("VALR_API_SECRET") || null;
  // An env API key is only meaningful alongside an env secret (true legacy mode); otherwise the Vault key wins.
  const localKey = input.localApiKey || (localSecret ? Deno.env.get("VALR_API_KEY") : null) || null;

  const local = async (): Promise<SignedHeaders> => {
    if (!localKey || !localSecret) throw new Error("VALR signing: no server-side key in Vault and no local secret available");
    const ts = Date.now().toString();
    const sub = input.subaccountId ?? "";
    const signature = await localHmacHex(localSecret, ts + verb + input.path + body + sub);
    return { headers: build(localKey, signature, ts, body, input.subaccountId ?? null), mode: "local" };
  };

  if (serverSigningDisabled()) return await local();

  const { data, error } = await sb().schema("lth_pvr").rpc("valr_sign", {
    p_customer_id: input.customerId ?? null,
    p_verb: verb,
    p_path: input.path,
    p_body: body,
    p_scope: scopeForPath(input.path),
    p_subaccount_id: input.customerId ? null : (input.subaccountId ?? null),
  });

  if (error) {
    if (/VALR_SECRET_NOT_CONFIGURED/.test(error.message) && localKey && localSecret) return await local();
    throw new Error(`valr_sign RPC failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { api_key: string; subaccount_id: string | null; ts: string; signature: string } | undefined;
  if (!row?.signature) throw new Error("valr_sign RPC returned no signature");

  // One-off self-check while both paths exist: identical inputs must give identical signatures.
  if (!_selfChecked && localSecret && localKey === row.api_key) {
    _selfChecked = true;
    const expect = await localHmacHex(localSecret, row.ts + verb + input.path + body + (row.subaccount_id ?? ""));
    if (expect !== row.signature) {
      try {
        await sb().schema("public").from("alert_events").insert({
          component: "valr_sign", severity: "critical",
          message: "Server-side VALR signature differs from local signature — investigate before trading",
          context: { path: input.path, verb, customer_id: input.customerId ?? null },
        });
      } catch { /* alerting must never block */ }
      if (localKey && localSecret) return await local();
    }
  }

  return { headers: build(row.api_key, row.signature, row.ts, body, row.subaccount_id), mode: "server" };
}

function build(apiKey: string, signature: string, ts: string, body: string, subaccountId: string | null): Record<string, string> {
  const h: Record<string, string> = { "X-VALR-API-KEY": apiKey, "X-VALR-SIGNATURE": signature, "X-VALR-TIMESTAMP": ts };
  if (body) h["Content-Type"] = "application/json";
  if (subaccountId) h["X-VALR-SUB-ACCOUNT-ID"] = subaccountId;
  return h;
}
