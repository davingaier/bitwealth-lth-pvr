// ef_update_support_ticket/index.ts
// Purpose: Admin-only update of ticket status / priority / assignment / category.
// Supports bulk updates (Phase 3).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendHTMLEmail } from "../_shared/smtp.ts";

const SB_URL  = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SR   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL  = Deno.env.get("SUPPORT_FROM_EMAIL") ?? "support@bitwealth.co.za";
const PORTAL_URL  = Deno.env.get("PORTAL_URL")         ?? "https://www.bitwealth.co.za/customer-portal.html";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const VALID_STATUS   = new Set(["open","in_progress","waiting_customer","resolved","closed"]);
const VALID_PRIORITY = new Set(["low","normal","high","urgent"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer "))
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: CORS });

    const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: ud } = await userClient.auth.getUser();
    const user = ud?.user;
    if (!user) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: CORS });

    const { ticket_ids, status, priority, assigned_to, category, notify_customer = false } = await req.json();
    if (!Array.isArray(ticket_ids) || ticket_ids.length === 0)
      return new Response(JSON.stringify({ error: "ticket_ids array required" }), { status: 400, headers: CORS });

    const updates: Record<string, unknown> = {};
    if (status   !== undefined) { if (!VALID_STATUS.has(status))     return new Response(JSON.stringify({ error: "Invalid status" }),   { status: 400, headers: CORS }); updates.status = status; }
    if (priority !== undefined) { if (!VALID_PRIORITY.has(priority)) return new Response(JSON.stringify({ error: "Invalid priority" }), { status: 400, headers: CORS }); updates.priority = priority; }
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null;
    if (category !== undefined && category) updates.category = category;
    if (Object.keys(updates).length === 0)
      return new Response(JSON.stringify({ error: "No updates supplied" }), { status: 400, headers: CORS });

    const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

    // Verify caller is admin in every ticket's org
    const { data: tickets, error: tErr } = await sb
      .from("support_tickets")
      .select("ticket_id, ticket_number, org_id, customer_id, subject")
      .in("ticket_id", ticket_ids);
    if (tErr) throw tErr;
    if (!tickets || tickets.length === 0) return new Response(JSON.stringify({ error: "No tickets found" }), { status: 404, headers: CORS });

    const orgIds = Array.from(new Set(tickets.map(t => t.org_id)));
    const { data: memberships } = await sb.from("org_members").select("org_id, role").eq("user_id", user.id).in("org_id", orgIds);
    const adminOrgs = new Set((memberships ?? []).filter(m => m.role === "admin" || m.role === "owner").map(m => m.org_id));
    const allowed   = tickets.filter(t => adminOrgs.has(t.org_id));
    if (allowed.length === 0) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: CORS });

    const allowedIds = allowed.map(t => t.ticket_id);
    const { error: uErr } = await sb.from("support_tickets").update(updates).in("ticket_id", allowedIds);
    if (uErr) throw uErr;

    // Optional system message (audit) when status changes
    if (status) {
      const sysRows = allowed.map(t => ({
        ticket_id:  t.ticket_id,
        author_id:  user.id,
        author_role:"system",
        body:       `Status changed to "${status}".`,
        is_internal:true,
      }));
      await sb.from("support_ticket_messages").insert(sysRows);
    }

    // Optional customer notification on status change
    if (notify_customer && status) {
      for (const t of allowed) {
        const { data: cd } = await sb.from("customer_details")
          .select("first_names, last_name, email, email_address")
          .eq("customer_id", t.customer_id).maybeSingle();
        const to = cd?.email ?? cd?.email_address;
        if (!to) continue;
        const name = `${cd?.first_names ?? ""} ${cd?.last_name ?? ""}`.trim() || "Customer";
        const h = `<p>Hi ${name},</p><p>Your support ticket <b>${t.ticket_number}</b> has been updated to status <b>${status}</b>.</p><p><a href="${PORTAL_URL}#support">View ticket</a></p>`;
        try { await sendHTMLEmail(to, FROM_EMAIL, `[${t.ticket_number}] Status: ${status}`, h); }
        catch (e) { console.error("Status email failed:", e); }
      }
    }

    return new Response(JSON.stringify({ success: true, updated: allowedIds.length, skipped: tickets.length - allowedIds.length }), { status: 200, headers: CORS });

  } catch (e) {
    console.error("ef_update_support_ticket error:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: CORS });
  }
});
