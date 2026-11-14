import { getServiceKey } from "../_shared/supabaseKeys.ts";
// Edge Function: ef_admin_partner_users
// Purpose: Admin-only management of partner (Finova) portal logins.
// Actions: create | disable | enable | reset_password | reset_mfa
//
// Auth: JWT required. Caller must be owner/admin in org_members.
// Deployed with: --no-verify-jwt (Bearer token validated here).
//
// Email delivery (2026-11-14): auth.admin.generateLink() only *generates* a link and never
// sends mail, and Auth's own mailer (inviteUserByEmail / resetPasswordForEmail) is rate-limited
// per project per hour — the third invite of the day failed with "email rate limit exceeded".
// We therefore generate the recovery link with the admin API (not rate-limited) and send it
// ourselves through BitWealth's SMTP with the partner email shell. The link still goes through
// Auth's /verify endpoint, so redirectTo must be in Auth → URL Configuration.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { emailShell, escHtml, sendLoggedEmail } from "../_shared/partnerEmail.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = getServiceKey();
const PARTNER_PORTAL_URL = Deno.env.get("PARTNER_PORTAL_URL") ?? "https://bitwealth.co.za/partner-login.html";
// GoTrue has no "permanent" ban; 100 years is the conventional stand-in.
const BAN_FOREVER = "876600h";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

/**
 * Generate a one-time set-password link and email it via our own SMTP (bypasses Auth's
 * per-hour mail quota). `kind` only changes the wording; both land on partner-login.html
 * with #type=recovery, which runs the TOTP challenge first for enrolled users.
 */
async function sendSetPasswordEmail(
  email: string,
  fullName: string | null,
  kind: "invite" | "reset",
): Promise<string | null> {
  const { data, error } = await sb.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: PARTNER_PORTAL_URL },
  });
  const link = (data as { properties?: { action_link?: string } } | null)?.properties?.action_link;
  if (error || !link) return error?.message ?? "Auth did not return a link";

  const name = fullName?.trim() || email;
  const html = emailShell({
    title: kind === "invite" ? "Your BitWealth Partner Portal access" : "Reset your Partner Portal password",
    intro: kind === "invite"
      ? `Hello ${escHtml(name)}, BitWealth has created a Partner Portal login for you. Click the button below to choose a password; you will then be asked to set up two-factor authentication with an authenticator app (Microsoft/Google Authenticator, Authy).`
      : `Hello ${escHtml(name)}, a password reset was requested for your BitWealth Partner Portal login. Click the button below, enter your authenticator code, then choose a new password.`,
    ctaLabel: kind === "invite" ? "Set my password" : "Reset my password",
    ctaUrl: link,
    bodyHtml: `<p style="color:#6b7280;font-size:13px;">This link is for ${escHtml(email)} and can be used once. If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;">${escHtml(link)}</span></p>`,
    footer: kind === "invite"
      ? "If you were not expecting this, please ignore it — no account is active until a password and two-factor authentication have been set."
      : "If you did not request a reset, ignore this email; your password is unchanged.",
  });
  const sent = await sendLoggedEmail(sb, {
    to: [email],
    subject: kind === "invite" ? "BitWealth Partner Portal — set your password" : "BitWealth Partner Portal — password reset",
    html,
    templateKey: kind === "invite" ? "partner_user_invite" : "partner_user_password_reset",
    data: { email },
  });
  return sent.success ? null : (sent.error ?? "send failed");
}

/**
 * Kill every live session for a user. admin.signOut() needs the user's own JWT, which we
 * never hold, so this goes through a service-only RPC that deletes auth.sessions rows
 * (refresh tokens cascade). The access token itself stays valid for ≤1 h, but every partner
 * RPC/EF re-checks partner_users.is_active, so a disabled user is locked out immediately.
 */
async function revokeSessions(userId: string): Promise<number> {
  const { data, error } = await sb.rpc("admin_revoke_user_sessions", { p_user_id: userId });
  if (error) console.error("admin_revoke_user_sessions failed:", error.message);
  return typeof data === "number" ? data : 0;
}

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
  if (!["create", "disable", "enable", "reset_password", "reset_mfa"].includes(action ?? "")) {
    return json({ error: `Unknown action '${action}'` }, 400);
  }

  if (action === "create") {
    const email = body.email?.trim().toLowerCase();
    if (!email) return json({ error: "email is required" }, 400);

    const role = body.role ?? "both";
    if (!["submitter", "authoriser", "both"].includes(role)) {
      return json({ error: `Invalid role '${role}'` }, 400);
    }

    // Accept the code in any case, or the display name ("Finova"), and normalise to the stored code.
    const codeInput = (body.partner_code?.trim() || "finova").toLowerCase();
    const { data: partnerRow } = await sb.from("partners")
      .select("partner_code, is_active")
      .or(`partner_code.ilike.${codeInput},display_name.ilike.${codeInput}`)
      .limit(1)
      .maybeSingle();
    if (!partnerRow?.is_active) return json({ error: `Unknown or inactive partner '${body.partner_code ?? "finova"}'` }, 400);
    const partnerCode: string = partnerRow.partner_code;

    // Create the auth user without any email (no mail quota involved). An existing auth user
    // (re-invite / previously disabled / also a BitWealth client) is simply reused.
    let newUserId: string | undefined;
    let existingAuthUser = false;
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: body.full_name ?? null, partner_code: partnerCode },
    });
    if (!createErr && created?.user?.id) {
      newUserId = created.user.id;
    } else {
      const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
      newUserId = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id;
      if (!newUserId) return json({ error: `Could not create user: ${createErr?.message ?? "unknown error"}` }, 400);
      existingAuthUser = true;
    }

    const { data: orgMemberClash } = await sb
      .from("org_members")
      .select("user_id")
      .eq("user_id", newUserId)
      .maybeSingle();
    if (orgMemberClash) {
      return json({ error: "This account is a BitWealth org member and cannot also be a partner user." }, 409);
    }
    // A partner user may also be a BitWealth client (one Auth identity, two roles): partner data needs an
    // active partner_users row on an aal2 session, client data needs the client's own email, so neither
    // leaks into the other. We only surface it so the admin knows the password/2FA will be shared.
    const { data: customerClash } = await sb
      .from("customer_details")
      .select("customer_id")
      .ilike("email", email)
      .maybeSingle();
    const sharedWithCustomerId: number | null = customerClash?.customer_id ?? null;

    const { error: upErr } = await sb.from("partner_users").upsert({
      user_id: newUserId,
      partner_code: partnerCode,
      full_name: body.full_name ?? null,
      email,
      role,
      is_active: true,
      created_by: caller.id,
      disabled_at: null,
      disabled_by: null,
    }, { onConflict: "user_id" });
    if (upErr) return json({ error: `Could not save partner user: ${upErr.message}` }, 400);

    // Re-enabled / re-invited users may have been banned by a previous "disable".
    await sb.auth.admin.updateUserById(newUserId, { ban_duration: "none" }).catch(() => {});

    const inviteError = await sendSetPasswordEmail(email, body.full_name ?? null, "invite");

    return json({
      success: true,
      user_id: newUserId,
      email,
      invite_email_sent: !inviteError,
      invite_error: inviteError,
      existing_auth_user: existingAuthUser,
      shared_with_customer_id: sharedWithCustomerId,
      message: "Partner user created. They must set a password and enrol two-factor authentication on first login.",
    });
  }

  // Every remaining action targets an existing partner login — never an arbitrary auth user.
  const targetId = body.user_id?.trim();
  const targetEmail = body.email?.trim().toLowerCase();
  if (!targetId && !targetEmail) return json({ error: "user_id or email is required" }, 400);
  let targetQuery = sb.from("partner_users").select("user_id, email, is_active");
  targetQuery = targetId ? targetQuery.eq("user_id", targetId) : targetQuery.eq("email", targetEmail!);
  const { data: target } = await targetQuery.limit(1).maybeSingle();
  if (!target) return json({ error: "Partner user not found" }, 404);

  if (action === "disable" || action === "enable") {
    const active = action === "enable";
    const { error } = await sb.from("partner_users").update({
      is_active: active,
      role: body.role ?? undefined,
      disabled_at: active ? null : new Date().toISOString(),
      disabled_by: active ? null : caller.id,
    }).eq("user_id", target!.user_id);
    if (error) return json({ error: error.message }, 400);

    // Disable = ban at the Auth layer (no new logins, no token refresh) + drop live sessions.
    const { error: banErr } = await sb.auth.admin.updateUserById(target!.user_id, { ban_duration: active ? "none" : BAN_FOREVER });
    const sessionsRevoked = active ? 0 : await revokeSessions(target!.user_id);
    return json({ success: true, user_id: target!.user_id, is_active: active, sessions_revoked: sessionsRevoked, ban_error: banErr?.message ?? null });
  }

  if (action === "reset_password") {
    if (!target!.is_active) return json({ error: "This login is disabled — enable it before resetting the password." }, 409);
    const { data: pu } = await sb.from("partner_users").select("full_name").eq("user_id", target!.user_id).maybeSingle();
    const err = await sendSetPasswordEmail(target!.email, pu?.full_name ?? null, "reset");
    if (err) return json({ error: err }, 400);
    return json({ success: true, message: "Password reset email sent." });
  }

  if (action === "reset_mfa") {
    const { data: factors } = await sb.auth.admin.mfa.listFactors({ userId: target!.user_id });
    let removed = 0;
    for (const f of factors?.factors ?? []) {
      const { error } = await sb.auth.admin.mfa.deleteFactor({ userId: target!.user_id, id: f.id });
      if (!error) removed++;
    }
    const sessionsRevoked = await revokeSessions(target!.user_id);
    return json({ success: true, factors_removed: removed, sessions_revoked: sessionsRevoked, message: "MFA reset — the user must re-enrol on next login." });
  }

  return json({ error: `Unknown action '${action}'` }, 400);
});
