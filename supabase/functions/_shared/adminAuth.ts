// _shared/adminAuth.ts — caller authorisation for admin-only edge functions.
//
// Supabase's `verify_jwt` gateway check is satisfied by the ANON/publishable key,
// which ships in the public website bundle. It therefore proves nothing about who
// is calling. Any function that acts with the service role must authorise the
// caller itself — this module is that check.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { allPublishableKeys, allServiceKeys, getServiceKey } from "./supabaseKeys.ts";

export interface AdminCaller {
  ok: boolean;
  status: number;
  error?: string;
  userId?: string;
  email?: string;
  /** True when the caller presented the service role key (internal / cron call). */
  internal?: boolean;
}

/**
 * Require the caller to be a BitWealth org admin/owner, or an internal
 * service-role caller.
 *
 * @param sb          service-role Supabase client
 * @param req         the incoming request
 * @param serviceKey  the service role key, to recognise internal calls
 */
export async function requireOrgAdmin(
  sb: SupabaseClient,
  req: Request,
  serviceKey: string,
): Promise<AdminCaller> {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const apikey = req.headers.get("apikey") ?? undefined;

  // Service-to-service callers (cron / pg_net / other Edge Functions). The new sb_secret keys travel in the
  // `apikey` header (the platform rejects them as a bearer on verify_jwt functions), legacy callers used a
  // bearer — accept either, matched against every configured privileged key.
  const serviceKeys = new Set<string>([serviceKey, ...allServiceKeys()].filter(Boolean) as string[]);
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  if ((apikey && serviceKeys.has(apikey)) || (bearer && serviceKeys.has(bearer))) {
    return { ok: true, status: 200, internal: true };
  }

  if (!bearer) {
    return { ok: false, status: 401, error: "Unauthenticated — a bearer token is required" };
  }
  const token = bearer;

  // The anon/publishable keys are public, so they must never authorise anything.
  if (allPublishableKeys().includes(token)) {
    return { ok: false, status: 401, error: "Unauthenticated — a user access token is required" };
  }

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, error: "Unauthenticated — invalid or expired session" };
  }

  // Always resolve the membership in `public`, whatever default schema the caller's client was built with
  // (ef_bt_execute passes an lth_pvr_bt client, several pipeline functions an lth_pvr one — 2026-11-06 403s).
  const { data: member } = await sb
    .schema("public")
    .from("org_members")
    .select("role")
    .eq("user_id", data.user.id)
    .in("role", ["admin", "owner"])
    .maybeSingle();

  if (!member) {
    return { ok: false, status: 403, error: "Forbidden — administrator access required" };
  }

  return { ok: true, status: 200, userId: data.user.id, email: data.user.email ?? undefined };
}
let _autoClient: SupabaseClient | null = null;

/**
 * Drop-in guard for functions that build their Supabase client later (or not at all): resolves the
 * privileged key and URL from the environment and delegates to requireOrgAdmin. Internal callers
 * (cron / pg_net / other Edge Functions) present the secret key; humans present an org admin session.
 */
export async function requireOrgAdminAuto(req: Request): Promise<AdminCaller> {
  const key = getServiceKey() ?? "";
  if (!_autoClient) {
    const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "";
    _autoClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return requireOrgAdmin(_autoClient, req, key);
}

/** Standard JSON 401/403 response for a failed requireOrgAdmin* check. */
export function unauthorizedResponse(caller: AdminCaller, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: caller.error }), {
    status: caller.status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
