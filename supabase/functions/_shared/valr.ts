/**
 * Shared VALR API utilities
 * Provides HMAC signature generation for VALR API authentication
 */

/**
 * Generate HMAC SHA-512 signature for VALR API requests
 * 
 * @param timestamp - Unix timestamp (milliseconds as string)
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - API endpoint path (e.g., "/v1/account/balances")
 * @param body - Request body (empty string if no body)
 * @param apiSecret - VALR API secret key
 * @param subaccountId - Optional subaccount ID for subaccount requests
 * @returns Hex-encoded HMAC signature
 */
export async function signVALR(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  apiSecret: string,
  subaccountId: string = ""
): Promise<string> {
  // 2026-11-06: secrets live in Vault. When the caller has no secret (subaccount customers / master key), sign
  // server-side via lth_pvr.valr_sign_ts with the caller's own timestamp. Legacy local HMAC only when a secret exists.
  if (!apiSecret) {
    const { signature } = await serverSignWithTimestamp(timestamp, method, path, body, subaccountId || null, null);
    return signature;
  }
  const message = timestamp + method.toUpperCase() + path + body + subaccountId;
  
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
// ── Server-side signing bridge (2026-11-06) ────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getServiceKey } from "./supabaseKeys.ts";
// deno-lint-ignore no-explicit-any
let _sb: any = null;
// deno-lint-ignore no-explicit-any
function sbAdmin(): any {
  if (!_sb) _sb = createClient(Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "", getServiceKey() ?? "", { auth: { persistSession: false } });
  return _sb;
}
/** Sign with the Vault-held key for a caller-supplied timestamp. Returns the matching api_key too. */
export async function serverSignWithTimestamp(
  timestamp: string, method: string, path: string, body: string, subaccountId: string | null, customerId: number | null,
): Promise<{ apiKey: string; signature: string }> {
  const { data, error } = await sbAdmin().schema("lth_pvr").rpc("valr_sign_ts", {
    p_ts: timestamp, p_verb: method.toUpperCase(), p_path: path, p_body: body ?? "", p_subaccount_id: subaccountId, p_customer_id: customerId,
  });
  if (error) throw new Error(`valr_sign_ts failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { api_key: string; signature: string } | undefined;
  if (!row?.signature) throw new Error("valr_sign_ts returned no signature");
  return { apiKey: row.api_key, signature: row.signature };
}
/** The master VALR API key (never the secret) from Vault — fills X-VALR-API-KEY for subaccount-model requests. */
export async function masterApiKey(): Promise<string> {
  const { data, error } = await sbAdmin().schema("lth_pvr").rpc("valr_master_api_key");
  if (error) throw new Error(`valr_master_api_key failed: ${error.message}`);
  return String(data ?? "");
}
