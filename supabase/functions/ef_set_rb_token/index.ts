// ef_set_rb_token/index.ts
// ===========================================================
// Admin-only endpoint to manually replace the Research Bitcoin
// API token (e.g. after obtaining a fresh token from RB out of
// band when auto-renewal has failed).
//
// Behaviour:
//   - Requires a signed-in user with role 'admin' in org_members.
//   - POST body: { token: string, org_id?: uuid }
//   - Persists the token in lth_pvr.rb_api_token with
//     issued_at = today (UTC), expires_at = today + 90 days.
//   - NEVER returns the token value in the response.
//   - Emits an `info` alert on success and an `error` alert on
//     failure (component = "ef_set_rb_token") via the shared
//     public.alert_events table.
//
// Deploy with JWT verification ENABLED (so we can read the
// caller's user_id from the JWT and check org_members).
// ===========================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getServiceClient } from "./client.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function logAlert(
  sb: ReturnType<typeof getServiceClient>,
  severity: "info" | "warn" | "error" | "critical",
  message: string,
  context: Record<string, unknown> = {},
  orgId?: string | null,
) {
  try {
    const payload: Record<string, unknown> = {
      component: "ef_set_rb_token",
      severity,
      message,
      context,
    };
    if (orgId) payload.org_id = orgId;
    await sb.schema("public").from("alert_events").insert(payload);
  } catch (e) {
    console.error("ef_set_rb_token: alert_events insert failed", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  const sb = getServiceClient();

  // ---- AuthN: extract caller user_id from the JWT ----
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(401, { error: "missing bearer token" });

  let userId: string | null = null;
  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user?.id) {
      return json(401, { error: "invalid session" });
    }
    userId = data.user.id;
  } catch (e) {
    return json(401, { error: `auth failed: ${String((e as Error).message ?? e)}` });
  }

  // ---- Parse body ----
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid JSON body" });
  }

  const orgIdInput =
    (typeof body.org_id === "string" && body.org_id) ||
    Deno.env.get("ORG_ID") ||
    null;
  if (!orgIdInput) return json(400, { error: "org_id required" });

  const newToken = typeof body.token === "string" ? body.token.trim() : "";
  if (!newToken || newToken.length < 20) {
    return json(400, { error: "token must be a non-empty string of at least 20 characters" });
  }

  // ---- AuthZ: caller must be an admin in this org ----
  const { data: memberRow, error: memberErr } = await sb
    .schema("public")
    .from("org_members")
    .select("role")
    .eq("org_id", orgIdInput)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberErr) {
    await logAlert(sb, "error", `org_members lookup failed: ${memberErr.message}`, { org_id: orgIdInput, user_id: userId }, orgIdInput);
    return json(500, { error: "membership check failed" });
  }
  if (!memberRow || String(memberRow.role).toLowerCase() !== "admin") {
    return json(403, { error: "admin role required" });
  }

  // ---- Persist ----
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const issuedAt = today.toISOString().slice(0, 10);
  const expiresAt = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Try update first; fall back to insert if no row exists yet.
  const { data: existing, error: existErr } = await sb
    .schema("lth_pvr")
    .from("rb_api_token")
    .select("org_id")
    .eq("org_id", orgIdInput)
    .maybeSingle();
  if (existErr) {
    await logAlert(sb, "error", `rb_api_token existence check failed: ${existErr.message}`, { org_id: orgIdInput }, orgIdInput);
    return json(500, { error: "db check failed" });
  }

  let writeErr: { message: string } | null = null;
  if (existing) {
    const { error } = await sb
      .schema("lth_pvr")
      .from("rb_api_token")
      .update({
        token: newToken,
        issued_at: issuedAt,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgIdInput);
    writeErr = error;
  } else {
    const { error } = await sb
      .schema("lth_pvr")
      .from("rb_api_token")
      .insert({
        org_id: orgIdInput,
        token: newToken,
        issued_at: issuedAt,
        expires_at: expiresAt,
      });
    writeErr = error;
  }

  if (writeErr) {
    await logAlert(
      sb,
      "error",
      `Manual RB token write failed: ${writeErr.message}`,
      { org_id: orgIdInput, user_id: userId },
      orgIdInput,
    );
    return json(500, { error: writeErr.message });
  }

  await logAlert(
    sb,
    "info",
    `Research Bitcoin API token manually replaced. New expiry: ${expiresAt}.`,
    {
      org_id: orgIdInput,
      user_id: userId,
      issued_at: issuedAt,
      expires_at: expiresAt,
    },
    orgIdInput,
  );

  return json(200, {
    ok: true,
    issued_at: issuedAt,
    expires_at: expiresAt,
  });
});
