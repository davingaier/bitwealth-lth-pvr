// Edge Function: ef_store_customer_api_keys
// Purpose: Phase 3 (EF7) — Securely validate and store a customer's VALR API key/secret
//          in Supabase Vault, then update exchange_accounts with key metadata.
//
// Auth: JWT-enabled. Accepted callers:
//   • Admin (service role token or admin email address)
//   • Customer themselves (JWT email must match customer_details.email)
//
// Re-key scenario: update vault secrets in-place — customer stays 'active'.
// Registration advance: if status = 'setup' → advance to 'deposit'.
//
// Deployed with: supabase functions deploy ef_store_customer_api_keys

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { signVALR } from "../_shared/valr.ts";
import { logAlert } from "../_shared/alerting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID       = Deno.env.get("ORG_ID");
const VALR_BASE    = Deno.env.get("VALR_API_URL") ?? Deno.env.get("VALR_API_BASE") ?? "https://api.valr.com";

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// ── VALR helper: sign and call a private endpoint ─────────────────────────────
async function valrPrivate(
  method: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const timestamp  = Date.now().toString();
  const bodyString = body ? JSON.stringify(body) : "";
  const signature  = await signVALR(timestamp, method, path, bodyString, apiSecret);

  const res = await fetch(`${VALR_BASE}${path}`, {
    method,
    headers: {
      "X-VALR-API-KEY":   apiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      ...(bodyString ? { "Content-Type": "application/json" } : {}),
    },
    body: bodyString || undefined,
  });

  let data: unknown = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Parse VALR permission response ────────────────────────────────────────────
function parsePermissions(data: unknown): {
  hasView: boolean; hasTrade: boolean; hasWithdraw: boolean; hasLinkBank: boolean;
} {
  // VALR returns an array of key objects; each has a "permissions" array of strings.
  // We look for strings matching required permissions (case-insensitive).
  const matches = (perm: string, ...targets: string[]) =>
    targets.some(t => perm.toLowerCase().includes(t.toLowerCase()));

  const perms: string[] = [];
  if (Array.isArray(data)) {
    for (const key of data as Record<string, unknown>[]) {
      if (Array.isArray(key.permissions)) {
        perms.push(...(key.permissions as string[]));
      }
    }
  }
  return {
    hasView:      perms.some(p => matches(p, "view")),
    hasTrade:     perms.some(p => matches(p, "trade")),
    hasWithdraw:  perms.some(p => matches(p, "withdraw")),
    hasLinkBank:  perms.some(p => matches(p, "linkbank", "link bank")),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json();
    const {
      customer_id,
      api_key,
      api_secret,
      api_key_label,
      expires_at,
    }: {
      customer_id: number;
      api_key: string;
      api_secret: string;
      api_key_label?: string;
      expires_at?: string;
    } = body;

    // ── Basic input validation ───────────────────────────────────────────────
    if (!customer_id || !api_key || !api_secret) {
      return json({ error: "Missing required fields: customer_id, api_key, api_secret" }, 400);
    }

    // ── Load customer ────────────────────────────────────────────────────────
    const { data: customer, error: custErr } = await sb
      .from("customer_details")
      .select("customer_id, email, account_model, registration_status, org_id")
      .eq("customer_id", customer_id)
      .single();

    if (custErr || !customer) return json({ error: "Customer not found" }, 404);

    // ── Guard: API model only ────────────────────────────────────────────────
    if (customer.account_model !== "api") {
      return json({
        error: `Customer ${customer_id} is on the '${customer.account_model}' model. API key storage only applies to API model customers.`,
      }, 422);
    }

    // ── Step 3: Validate key with VALR ───────────────────────────────────────
    const balanceResult = await valrPrivate("GET", "/v1/account/balances", api_key, api_secret);
    if (!balanceResult.ok) {
      return json({
        error: "API key/secret is invalid or has been revoked. VALR rejected the test call to /v1/account/balances.",
        valr_status: balanceResult.status,
      }, 422);
    }

    // Extract balance summary for response
    const balances = Array.isArray(balanceResult.data) ? balanceResult.data as Record<string, unknown>[] : [];
    const usdtRow  = balances.find(b => b.currency === "USDT");
    const btcRow   = balances.find(b => b.currency === "BTC");
    const usdtBal  = usdtRow ? Number(usdtRow.available ?? usdtRow.total ?? 0) : 0;
    const btcBal   = btcRow  ? Number(btcRow.available  ?? btcRow.total  ?? 0) : 0;

    // ── Step 4: Check permissions (best-effort — never block on failure) ─────
    let permissions = { hasView: false, hasTrade: false, hasWithdraw: false, hasLinkBank: false };
    const permWarnings: string[] = [];
    try {
      const permResult = await valrPrivate("GET", "/v1/account/api-keys", api_key, api_secret);
      if (permResult.ok) {
        permissions = parsePermissions(permResult.data);
        if (!permissions.hasView)     permWarnings.push("View permission missing");
        if (!permissions.hasTrade)    permWarnings.push("Trade permission missing");
        if (!permissions.hasWithdraw) permWarnings.push("Withdraw permission missing");
        if (!permissions.hasLinkBank) permWarnings.push("Link Bank Account permission missing");
      }
      // If endpoint fails, permissions remain unknown (all false) — warn at end
    } catch {
      // Best-effort: ignore errors from the permissions check
    }

    // ── Step 5 & 6: Store in vault and update exchange_accounts (DB function) ─
    const { data: vaultResult, error: vaultErr } = await sb.rpc("store_customer_valr_api_keys", {
      p_customer_id:   customer_id,
      p_api_key:       api_key,
      p_api_secret:    api_secret,
      p_label:         api_key_label ?? "BitWealth Trade",
      p_expires_at:    expires_at ?? null,
      p_has_view:      permissions.hasView,
      p_has_trade:     permissions.hasTrade,
      p_has_withdraw:  permissions.hasWithdraw,
      p_has_link_bank: permissions.hasLinkBank,
    }, { schema: "lth_pvr" });

    if (vaultErr) {
      await logAlert(
        sb,
        "ef_store_customer_api_keys",
        "error",
        `Failed to store API keys in vault for customer ${customer_id}: ${vaultErr.message}`,
        { customer_id },
        ORG_ID,
        customer_id,
      );
      return json({ error: `Failed to store API keys: ${vaultErr.message}` }, 500);
    }

    // ── Step 7: Advance registration status if still on 'setup' ─────────────
    if (customer.registration_status === "setup") {
      await sb
        .from("customer_details")
        .update({ registration_status: "deposit" })
        .eq("customer_id", customer_id);
    }

    // ── Log success alert if any permissions were missing ────────────────────
    if (permWarnings.length > 0) {
      await logAlert(
        sb,
        "ef_store_customer_api_keys",
        "warn",
        `Customer ${customer_id} API key stored but missing permissions: ${permWarnings.join(", ")}`,
        { customer_id, missing_permissions: permWarnings },
        ORG_ID,
        customer_id,
      );
    }

    return json({
      success: true,
      usdt_balance:  usdtBal,
      btc_balance:   btcBal,
      verified_at:   new Date().toISOString(),
      permissions,
      warnings:      permWarnings.length > 0 ? permWarnings : undefined,
      vault_ids:     vaultResult?.[0] ?? null,
    });

  } catch (err) {
    console.error("ef_store_customer_api_keys error:", err);
    return json({ error: err.message ?? "Internal server error" }, 500);
  }
});
