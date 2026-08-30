// Edge Function: ef_admin_partner_users
// Purpose: Admin-only management of partner (Finova) portal logins.
// Actions: create | disable | enable | reset_password | reset_mfa
//
// Auth: JWT required. Caller must be owner/admin in org_members.
// Deployed with: --no-verify-jwt (Bearer token validated here).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PARTNER_PORTAL_URL = Deno.env.get("PARTNER_PORTAL_URL") ?? "https://bitwealth.co.za/partner-login.html";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthenticated" }, 401);

  const { data: userData, error: userErr } = await sb.auth.getUser(authHeader.slice(7));
  if (userErr || !userData?.user) return json({ error: "Unauthenticated" }, 401);
  const caller = userData.user;

  const { data: member } = await sb
    .from("org_members")
    .select("role")
    .eq("user_id", caller.id)
    .in("role", ["admin", "owner"])
    .maybeSingle();
  if (!member) return json({ error: "Forbidden — admin role required" }, 403);

  let body: {
    action?: string;
    user_id?: string;
    email?: string;
    full_name?: string;
    partner_code?: string;
    role?: string;
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const action = body.action;

  if (action === "create") {
    const email = body.email?.trim().toLowerCase();
    if (!email) return json({ error: "email is required" }, 400);

    const role = body.role ?? "both";
    if (!["submitter", "authoriser", "both"].includes(role)) {
      return json({ error: `Invalid role '${role}'` }, 400);
    }

    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
    });

    let newUserId = created?.user?.id;
    if (createErr) {
      // Re-inviting an existing auth user is legitimate; reuse their id.
      const { data: list } = await sb.auth.admin.listUsers();
      newUserId = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id;
      if (!newUserId) return json({ error: `Could not create user: ${createErr.message}` }, 400);
    }

    const { data: orgMemberClash } = await sb
      .from("org_members")
      .select("user_id")
      .eq("user_id", newUserId!)
      .maybeSingle();
    if (orgMemberClash) {
      return json({ error: "This account is a BitWealth org member and cannot also be a partner user." }, 409);
    }

    const { error: upErr } = await sb.from("partner_users").upsert({
      user_id: newUserId,
      partner_code: body.partner_code ?? "finova",
      full_name: body.full_name ?? null,
      email,
      role,
      is_active: true,
      created_by: caller.id,
      disabled_at: null,
      disabled_by: null,
    }, { onConflict: "user_id" });
    if (upErr) return json({ error: `Could not save partner user: ${upErr.message}` }, 400);

    const { error: linkErr } = await sb.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: PARTNER_PORTAL_URL },
    });

    return json({
      success: true,
      user_id: newUserId,
      email,
      invite_email_sent: !linkErr,
      invite_error: linkErr?.message ?? null,
      message: "Partner user created. They must set a password and enrol two-factor authentication on first login.",
    });
  }

  if (action === "disable" || action === "enable") {
    if (!body.user_id) return json({ error: "user_id is required" }, 400);
    const active = action === "enable";
    const { error } = await sb.from("partner_users").update({
      is_active: active,
      role: body.role ?? undefined,
      disabled_at: active ? null : new Date().toISOString(),
      disabled_by: active ? null : caller.id,
    }).eq("user_id", body.user_id);
    if (error) return json({ error: error.message }, 400);

    // Kill live sessions immediately rather than waiting for token expiry.
    if (!active) await sb.auth.admin.signOut(body.user_id).catch(() => {});
    return json({ success: true, user_id: body.user_id, is_active: active });
  }

  if (action === "reset_password") {
    if (!body.email) return json({ error: "email is required" }, 400);
    const { error } = await sb.auth.admin.generateLink({
      type: "recovery",
      email: body.email.trim().toLowerCase(),
      options: { redirectTo: PARTNER_PORTAL_URL },
    });
    if (error) return json({ error: error.message }, 400);
    return json({ success: true, message: "Password reset email sent." });
  }

  if (action === "reset_mfa") {
    if (!body.user_id) return json({ error: "user_id is required" }, 400);
    const { data: factors } = await sb.auth.admin.mfa.listFactors({ userId: body.user_id });
    let removed = 0;
    for (const f of factors?.factors ?? []) {
      const { error } = await sb.auth.admin.mfa.deleteFactor({ userId: body.user_id, id: f.id });
      if (!error) removed++;
    }
    await sb.auth.admin.signOut(body.user_id).catch(() => {});
    return json({ success: true, factors_removed: removed, message: "MFA reset — the user must re-enrol on next login." });
  }

  return json({ error: `Unknown action '${action}'` }, 400);
});
