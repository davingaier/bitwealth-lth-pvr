// Edge Function: ef_partner_submit_subaccount
// Purpose: Finova submits the VALR subaccount they created for a client, together
//          with a subaccount-scoped API key. We validate the key against VALR,
//          enforce the permission policy, vault the credentials and close the request.
//
// Auth: JWT required. Caller must be an active partner_users row on an aal2 (MFA) session.
// Deployed with: --no-verify-jwt (we validate the Bearer token ourselves so we can
//                return precise 401/403 reasons to the portal).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { signVALR } from "../_shared/valr.ts";
import { logAlert } from "../_shared/alerting.ts";
import { ADMIN_EMAIL, emailShell, escHtml, sendLoggedEmail } from "../_shared/partnerEmail.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");
const VALR_BASE = Deno.env.get("VALR_API_URL") ?? Deno.env.get("VALR_API_BASE") ?? "https://api.valr.com";

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

interface SubmitBody {
  request_id?: string;
  subaccount_name?: string;
  subaccount_id?: string;
  zar_deposit_reference?: string;
  api_key_name?: string;
  api_key?: string;
  api_secret?: string;
  bank_link_confirmed?: boolean;
  bank_valr_id?: string;
}

async function valrGet(path: string, apiKey: string, apiSecret: string) {
  const timestamp = Date.now().toString();
  const signature = await signVALR(timestamp, "GET", path, "", apiSecret);
  const res = await fetch(`${VALR_BASE}${path}`, {
    headers: {
      "X-VALR-API-KEY": apiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

/**
 * GET /v1/account/api-keys/current returns a single object:
 *   { label, permissions: string[], addedAt, isSubAccount, ... }
 * Permission strings are VALR's exact labels, e.g. "View access", "Trade",
 * "Withdraw", "Internal Transfer", "Link bank account".
 */
function readPermissions(data: unknown) {
  const obj = (data ?? {}) as Record<string, unknown>;
  const perms: string[] = Array.isArray(obj.permissions) ? (obj.permissions as string[]) : [];
  const has = (...needles: string[]) =>
    perms.some((p) => needles.some((n) => p.toLowerCase().includes(n.toLowerCase())));
  return {
    known: perms.length > 0,
    view: has("view"),
    trade: has("trade"),
    transfer: has("internal transfer", "transfer"),
    withdraw: has("withdraw"),
    isSubAccount: obj.isSubAccount === true,
    label: typeof obj.label === "string" ? obj.label : null,
  };
}

/**
 * The subaccount ID is needed later to sweep fees, but VALR exposes no endpoint
 * that reveals it to a subaccount-scoped key. Try the primary-only listing anyway
 * and match on label — it succeeds only if the key turns out to be primary-scoped.
 * Returns null when it cannot be determined; the caller treats that as non-fatal.
 */
async function discoverSubaccountId(
  apiKey: string,
  apiSecret: string,
  subaccountName: string,
): Promise<string | null> {
  try {
    const res = await valrGet("/v1/account/subaccounts", apiKey, apiSecret);
    if (!res.ok || !Array.isArray(res.data)) return null;
    const wanted = subaccountName.trim().toLowerCase();
    const match = (res.data as Array<{ id?: string; label?: string }>)
      .find((a) => (a.label ?? "").trim().toLowerCase() === wanted);
    return match?.id ?? null;
  } catch {
    return null;
  }
}

/** BitWealth is told about every submission outcome, pass or fail. */
async function notifyBitWealth(
  customerId: number,
  clientName: string,
  outcome: "verified" | "failed",
  partnerEmail: string,
  detail: string,
) {
  const ok = outcome === "verified";
  const html = emailShell({
    title: ok ? "Finova subaccount verified" : "Finova subaccount submission failed",
    intro: ok
      ? "Finova submitted a client subaccount and it passed all checks. The client has been moved to Deposit and sent ZAR deposit instructions."
      : "Finova submitted a client subaccount but it failed verification. Finova has been shown the reason in the portal.",
    rows: [
      ["Client", escHtml(clientName)],
      ["Customer ID", `#${customerId}`],
      ["Submitted by", escHtml(partnerEmail)],
      [ok ? "Notes" : "Reason", escHtml(detail || "—")],
    ],
    footer: "Internal BitWealth notification.",
  });
  await sendLoggedEmail(sb, {
    to: [ADMIN_EMAIL],
    subject: `${ok ? "✅" : "❌"} Finova subaccount ${ok ? "verified" : "failed"} — ${clientName} (#${customerId})`,
    html,
    templateKey: ok ? "partner_subaccount_verified_admin" : "partner_subaccount_failed_admin",
    data: { customer_id: customerId, outcome, detail },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthenticated" }, 401);
  const token = authHeader.slice(7);

  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Unauthenticated" }, 401);
  const user = userData.user;

  const { data: partner } = await sb
    .from("partner_users")
    .select("user_id, partner_code, email, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!partner || !partner.is_active) return json({ error: "Forbidden — not an active partner user" }, 403);

  // MFA is mandatory: re-checked server-side so a tampered client cannot bypass it.
  const aal = (user as unknown as { aal?: string }).aal ??
    (JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (token.split(".")[1].length % 4)) % 4))) as { aal?: string }).aal;
  if (aal !== "aal2") {
    return json({ error: "Two-factor authentication is required before submitting credentials." }, 403);
  }

  let body: SubmitBody;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const {
    request_id, subaccount_name, subaccount_id, zar_deposit_reference,
    api_key_name, api_key, api_secret, bank_link_confirmed, bank_valr_id,
  } = body;

  const missing = [
    !request_id && "request_id",
    !subaccount_name?.trim() && "subaccount_name",
    !zar_deposit_reference?.trim() && "zar_deposit_reference",
    !api_key_name?.trim() && "api_key_name",
    !api_key?.trim() && "api_key",
    !api_secret?.trim() && "api_secret",
    !bank_link_confirmed && "bank_link_confirmed",
  ].filter(Boolean);
  if (missing.length) {
    return json({ error: `Missing required field(s): ${missing.join(", ")}` }, 400);
  }

  const { data: reqRow } = await sb
    .from("subaccount_requests")
    .select("request_id, customer_id, org_id, partner_code, request_type, status, suggested_subaccount_name")
    .eq("request_id", request_id)
    .maybeSingle();

  if (!reqRow) return json({ error: "Request not found" }, 404);
  if (reqRow.partner_code !== partner.partner_code) return json({ error: "Forbidden — request belongs to another partner" }, 403);
  if (reqRow.request_type !== "provision") {
    return json({ error: "This is a bank re-link request — use \"Confirm re-linked\" instead." }, 400);
  }
  if (!["pending", "submitted"].includes(reqRow.status)) {
    return json({ error: `This request is already '${reqRow.status}' and cannot be resubmitted.` }, 409);
  }

  const customerId: number = reqRow.customer_id;
  const { data: cust } = await sb
    .from("customer_details")
    .select("customer_id, email, first_names, last_name, display_name, registration_status, account_model")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (cust?.account_model !== "finova_omnibus") {
    return json({ error: "Forbidden — this client is not held in the partner's omnibus account" }, 403);
  }
  const clientName = cust.display_name ||
    [cust.first_names, cust.last_name].filter(Boolean).join(" ") || `Client ${customerId}`;

  const fail = async (reason: string, status = 422) => {
    await sb.from("subaccount_requests")
      .update({ status: "submitted", verification_error: reason, submitted_at: new Date().toISOString(), submitted_by: user.id, updated_at: new Date().toISOString() })
      .eq("request_id", request_id);
    await sb.from("partner_action_log").insert({
      partner_user_id: user.id, partner_code: partner.partner_code,
      action: "submit_subaccount_failed", entity_type: "subaccount_request",
      entity_id: request_id, customer_id: customerId, detail: { reason },
      ip_address: req.headers.get("x-forwarded-for"), user_agent: req.headers.get("user-agent"),
    });
    await notifyBitWealth(customerId, clientName, "failed", partner.email, reason);
    return json({ error: reason }, status);
  };

  // Reject a key already bound to a different client before it can be vaulted.
  const { data: dupe } = await sb.rpc("find_customer_by_valr_api_key", { p_api_key: api_key!.trim() });
  const dupeId = Array.isArray(dupe) ? dupe[0]?.customer_id : (dupe as { customer_id?: number } | null)?.customer_id;
  if (dupeId && Number(dupeId) !== customerId) {
    return await fail(`This API key is already linked to a different client (#${dupeId}). Please generate a key specific to this subaccount.`, 409);
  }

  // 1. Does the key work at all?
  const balances = await valrGet("/v1/account/balances", api_key!.trim(), api_secret!.trim());
  if (!balances.ok) {
    return await fail(`VALR rejected this API key/secret (HTTP ${balances.status}). Check the key was copied correctly and is enabled.`);
  }

  // 2. Permission policy: View + Trade required, Withdraw forbidden.
  const permResult = await valrGet("/v1/account/api-keys/current", api_key!.trim(), api_secret!.trim());
  const perms = readPermissions(permResult.data);
  const warnings: string[] = [];

  if (perms.known) {
    if (perms.withdraw) {
      return await fail("This key has the Withdraw permission. For client protection BitWealth will not store a key that can withdraw funds — please recreate it with View, Trade and Transfer only.", 422);
    }
    // A primary-account key would give BitWealth access to Finova's entire omnibus.
    if (!perms.isSubAccount) {
      return await fail("This key belongs to your primary account, not to the client's subaccount. Please create the key on the subaccount itself so its access is limited to this client.", 422);
    }
    if (!perms.view) return await fail("This key is missing the View permission.");
    if (!perms.trade) return await fail("This key is missing the Trade permission.");
    if (!perms.transfer) warnings.push("Internal Transfer permission not detected — fee sweeps to the Finova main account will fail until it is added.");
  } else {
    warnings.push("VALR did not report this key's permissions, so they could not be verified automatically.");
  }

  if (subaccount_name!.trim() !== (reqRow.suggested_subaccount_name ?? "").trim()) {
    warnings.push(`Subaccount name differs from the requested "${reqRow.suggested_subaccount_name}".`);
  }

  // Best-effort: Finova is not asked for the subaccount ID, so try to derive it.
  // Unknown is the normal case — fees then fall back to invoice-only (see valrTransfer.ts).
  const discoveredId = subaccount_id?.trim() ||
    await discoverSubaccountId(api_key!.trim(), api_secret!.trim(), subaccount_name!.trim());

  // 3. Vault + link + close the request atomically.
  const { data: stored, error: storeErr } = await sb.rpc("store_partner_subaccount_credentials", {
    p_request_id: request_id,
    p_customer_id: customerId,
    p_api_key: api_key!.trim(),
    p_api_secret: api_secret!.trim(),
    p_subaccount_name: subaccount_name!.trim(),
    p_subaccount_id: discoveredId,
    p_zar_deposit_ref: zar_deposit_reference!.trim(),
    p_api_key_name: api_key_name!.trim(),
    p_bank_valr_id: bank_valr_id?.trim() || null,
    p_has_view: perms.view,
    p_has_trade: perms.trade,
    p_has_withdraw: perms.withdraw,
    p_has_transfer: perms.transfer,
    p_submitted_by: user.id,
  });

  if (storeErr) {
    await logAlert(sb, "ef_partner_submit_subaccount", "error",
      `Failed to store Finova credentials for customer ${customerId}: ${storeErr.message}`,
      { customer_id: customerId, request_id }, reqRow.org_id, customerId);
    return await fail(`Could not save the credentials: ${storeErr.message}`, 500);
  }

  await sb.from("partner_action_log").insert({
    partner_user_id: user.id, partner_code: partner.partner_code,
    action: "submit_subaccount", entity_type: "subaccount_request",
    entity_id: request_id, customer_id: customerId,
    detail: { subaccount_name: subaccount_name!.trim(), api_key_name: api_key_name!.trim(), warnings, subaccount_id_known: !!discoveredId },
    ip_address: req.headers.get("x-forwarded-for"), user_agent: req.headers.get("user-agent"),
  });

  // The client can now fund the account: move them to Deposit and send ZAR-only
  // instructions (VALR's banking details + the reference Finova generated).
  let depositEmailSent = false;
  if (cust.registration_status === "setup") {
    await sb.from("customer_details").update({ registration_status: "deposit" }).eq("customer_id", customerId);
  }
  if (cust.email && ["setup", "deposit"].includes(cust.registration_status ?? "")) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ef_send_email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          template_key: "deposit_instructions_zar_only",
          to_email: cust.email,
          data: {
            first_name: cust.first_names || clientName,
            deposit_ref: zar_deposit_reference!.trim(),
            website_url: "https://bitwealth.co.za",
          },
        }),
      });
      depositEmailSent = res.ok;
      if (!res.ok) {
        await logAlert(sb, "ef_partner_submit_subaccount", "error",
          `Deposit instructions email failed for customer ${customerId} (HTTP ${res.status})`,
          { customer_id: customerId, body: (await res.text()).slice(0, 300) }, reqRow.org_id, customerId);
      }
    } catch (e) {
      await logAlert(sb, "ef_partner_submit_subaccount", "error",
        `Deposit instructions email error for customer ${customerId}: ${(e as Error).message}`,
        { customer_id: customerId }, reqRow.org_id, customerId);
    }
  }

  await notifyBitWealth(customerId, clientName, "verified", partner.email,
    [warnings.join(" "), depositEmailSent ? "Deposit instructions emailed to client." : "Deposit instructions email NOT sent — check alerts."]
      .filter(Boolean).join(" "));

  await logAlert(sb, "ef_partner_submit_subaccount", "info",
    `Finova subaccount verified and linked for customer ${customerId}`,
    { customer_id: customerId, request_id, warnings }, reqRow.org_id, customerId);

  return json({
    success: true,
    message: "Subaccount verified and linked.",
    customer_id: customerId,
    exchange_account_id: Array.isArray(stored) ? stored[0]?.exchange_account_id : null,
    permissions: perms,
    warnings,
  });
});
