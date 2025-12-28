// supabase/functions/admin-create-user/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SECRET_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: "Missing function secrets: SUPABASE_URL or Secret Key" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Caller auth
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerData?.user) return json({ error: "unauthorized" }, 401);
  const caller = callerData.user;

  // Body
  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "invalid JSON body" }, 400); }

  const { org_id, email, role, password } = body || {};
  if (!org_id || !email || !role) return json({ error: "org_id, email, role required" }, 400);

  // Authorization: must be owner/admin of org
  const { data: mem, error: memErr } = await admin
    .from("org_members").select("role").eq("org_id", org_id).eq("user_id", caller.id).maybeSingle();

  if (memErr) return json({ error: `membership check failed: ${memErr.message}` }, 500);
  if (!mem || !["owner", "admin"].includes(mem.role)) return json({ error: "forbidden" }, 403);

  // Create user in Auth
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: password && password.length >= 6 ? password : undefined,
    email_confirm: true,
  });
  if (createErr) return json({ error: createErr.message }, 400);
  const newUser = created.user;

  // Upsert membership
  const { error: upErr } = await admin
    .from("org_members")
    .upsert({ org_id, user_id: newUser.id, role }, { onConflict: "org_id,user_id" });

  if (upErr) return json({ error: upErr.message }, 400);

  return json({ user_id: newUser.id }, 200);
});
