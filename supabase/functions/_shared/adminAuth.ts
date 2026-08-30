// _shared/adminAuth.ts — caller authorisation for admin-only edge functions.
//
// Supabase's `verify_jwt` gateway check is satisfied by the ANON/publishable key,
// which ships in the public website bundle. It therefore proves nothing about who
// is calling. Any function that acts with the service role must authorise the
// caller itself — this module is that check.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthenticated — a bearer token is required" };
  }

  const token = header.slice(7).trim();

  // Service-to-service callers. The codebase reads the service role key under
  // several env names, so accept any of them rather than only the one passed in.
  const serviceKeys = [
    serviceKey,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    Deno.env.get("SECRET_KEY"),
    Deno.env.get("Secret Key"),
  ].filter(Boolean) as string[];
  if (serviceKeys.includes(token)) return { ok: true, status: 200, internal: true };

  // The anon/publishable key is public, so it must never authorise anything.
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (anonKey && token === anonKey) {
    return { ok: false, status: 401, error: "Unauthenticated — a user access token is required" };
  }

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, error: "Unauthenticated — invalid or expired session" };
  }

  const { data: member } = await sb
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
