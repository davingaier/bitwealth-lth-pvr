// Edge Function: ef_partner_complete_withdrawal
// Purpose: The partner (Finova) declares that they have paid a client's ZAR
//          withdrawal out of the client's VALR subaccount.
//
// The declaration alone never closes the withdrawal. We move the row to
// 'paying_out', run a targeted VALR transaction sync, and only mark it
// 'completed' once a matching FIAT_WITHDRAWAL is actually visible on VALR.
// Unmatched rows raise an alert for BitWealth to chase.
//
// Auth: JWT required — active partner_users row on an aal2 (MFA) session.
// Deployed with: --no-verify-jwt (Bearer validated here).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { logAlert } from "../_shared/alerting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");

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

function jwtClaim(token: string, claim: string): string | null {
  try {
    const part = token.split(".")[1];
    const pad = "=".repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad));
    return payload?.[claim] ?? null;
  } catch {
    return null;
  }
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
    .select("user_id, partner_code, email, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!partner?.is_active) return json({ error: "Forbidden — not an active partner user" }, 403);

  if (jwtClaim(token, "aal") !== "aal2") {
    return json({ error: "Two-factor authentication is required before completing a withdrawal." }, 403);
  }

  let body: { request_id?: string; partner_reference?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const requestId = body.request_id;
  const reference = body.partner_reference?.trim();
  if (!requestId) return json({ error: "request_id is required" }, 400);
  if (!reference) return json({ error: "A payment reference is required so the payout can be reconciled." }, 400);

  const { data: wr } = await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .select("request_id, customer_id, org_id, status, amount_zar, net_amount")
    .eq("request_id", requestId)
    .maybeSingle();

  if (!wr) return json({ error: "Withdrawal not found" }, 404);
  if (wr.status !== "awaiting_partner") {
    return json({ error: `This withdrawal is '${wr.status}' and is not awaiting payout.` }, 409);
  }

  const { data: cust } = await sb
    .from("customer_details")
    .select("customer_id, account_model")
    .eq("customer_id", wr.customer_id)
    .maybeSingle();
  if (cust?.account_model !== "finova_omnibus") {
    return json({ error: "Forbidden — this client is not held in the partner's omnibus account" }, 403);
  }

  const expectedZar = Number(wr.net_amount ?? wr.amount_zar ?? 0);
  const now = new Date().toISOString();

  await sb.schema("lth_pvr").from("withdrawal_requests").update({
    status: "paying_out",
    partner_marked_complete_at: now,
    partner_marked_complete_by: user.id,
    partner_reference: reference,
    reconciliation_status: "pending",
    processed_at: now,
  }).eq("request_id", requestId);

  await sb.from("partner_action_log").insert({
    partner_user_id: user.id,
    partner_code: partner.partner_code,
    action: "complete_withdrawal",
    entity_type: "withdrawal_request",
    entity_id: requestId,
    customer_id: wr.customer_id,
    detail: { expected_zar: expectedZar, partner_reference: reference },
    ip_address: req.headers.get("x-forwarded-for"),
    user_agent: req.headers.get("user-agent"),
  });

  // Pull this client's VALR history now so settlement is usually confirmed
  // within seconds rather than waiting for the next scheduled sync.
  let syncOk = false;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ef_sync_valr_transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ customer_id: wr.customer_id }),
    });
    syncOk = res.ok;
  } catch (e) {
    console.error("targeted sync failed:", e);
  }

  const { data: after } = await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .select("status")
    .eq("request_id", requestId)
    .maybeSingle();

  const settled = after?.status === "completed";
  if (settled) {
    await sb.schema("lth_pvr").from("withdrawal_requests")
      .update({ reconciliation_status: "matched" })
      .eq("request_id", requestId);
  }

  await logAlert(
    sb,
    "ef_partner_complete_withdrawal",
    settled ? "info" : "warn",
    settled
      ? `Partner payout confirmed against VALR for customer ${wr.customer_id} (R${expectedZar.toFixed(2)})`
      : `Partner declared a payout that is not yet visible on VALR for customer ${wr.customer_id} (R${expectedZar.toFixed(2)}) — awaiting reconciliation`,
    { request_id: requestId, customer_id: wr.customer_id, expected_zar: expectedZar, partner_reference: reference, sync_ok: syncOk },
    wr.org_id,
    wr.customer_id,
  );

  return json({
    success: true,
    settled,
    message: settled
      ? "Payout confirmed against VALR and the client has been notified."
      : "Recorded. BitWealth will confirm the payout against VALR shortly — no further action needed unless we contact you.",
  });
});
