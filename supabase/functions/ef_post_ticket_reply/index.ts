// ef_post_ticket_reply/index.ts
// Purpose: Customer or admin appends a message to an existing support ticket.
// Sends email notification to the OTHER party. Honours is_internal (admin-only).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendHTMLEmail } from "../_shared/smtp.ts";

const SB_URL  = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SR   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAIL = Deno.env.get("SUPPORT_ADMIN_EMAIL") ?? "info@bitwealth.co.za";
const FROM_EMAIL  = Deno.env.get("SUPPORT_FROM_EMAIL")  ?? "support@bitwealth.co.za";
const PORTAL_URL  = Deno.env.get("PORTAL_URL")          ?? "https://www.bitwealth.co.za/customer-portal.html";
const ADMIN_URL   = Deno.env.get("ADMIN_URL")           ?? "https://www.bitwealth.co.za/admin/Advanced%20BTC%20DCA%20Strategy.html";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c] as string));
}
function html(b: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Segoe UI,Tahoma,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:20px}
    .c{max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .h{background:#003B73;color:#fff;padding:24px;text-align:center}
    .h h1{margin:0;font-size:18px}
    .body{padding:24px}
    .btn{display:inline-block;background:#F39C12;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600}
    pre{white-space:pre-wrap;word-wrap:break-word;background:#f9f9f9;border-left:3px solid #F39C12;padding:12px;border-radius:4px}
  </style></head><body><div class="c">${b}</div></body></html>`;
}

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

    const { ticket_id, body, attachments = [], is_internal = false } = await req.json();
    if (!ticket_id) return new Response(JSON.stringify({ error: "ticket_id required" }), { status: 400, headers: CORS });
    if (!body || body.trim().length < 1 || body.length > 10000)
      return new Response(JSON.stringify({ error: "Body must be 1-10000 characters" }), { status: 400, headers: CORS });

    const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

    // Load ticket + customer
    const { data: ticket, error: tErr } = await sb
      .from("support_tickets")
      .select("ticket_id, ticket_number, org_id, customer_id, subject, status, priority")
      .eq("ticket_id", ticket_id)
      .maybeSingle();
    if (tErr || !ticket) return new Response(JSON.stringify({ error: "Ticket not found" }), { status: 404, headers: CORS });

    // Determine author role: admin if user is in org_members(admin/owner) for ticket.org_id, else customer if owner.
    const { data: orgMember } = await sb.from("org_members")
      .select("role").eq("org_id", ticket.org_id).eq("user_id", user.id).maybeSingle();
    const isAdmin = orgMember?.role === "admin" || orgMember?.role === "owner";

    let authorRole: "customer" | "admin";
    if (isAdmin) {
      authorRole = "admin";
    } else {
      // Verify customer ownership via email
      const { data: cd } = await sb.from("customer_details")
        .select("customer_id, email, email_address")
        .eq("customer_id", ticket.customer_id)
        .maybeSingle();
      const cdEmail = (cd?.email ?? cd?.email_address ?? "").toLowerCase();
      if (!cd || cdEmail !== (user.email ?? "").toLowerCase()) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: CORS });
      }
      authorRole = "customer";
    }

    // Customers cannot post internal notes
    const internal = isAdmin && !!is_internal;

    const { data: msg, error: iErr } = await sb.from("support_ticket_messages").insert({
      ticket_id:  ticket.ticket_id,
      author_id:  user.id,
      author_role:authorRole,
      body:       body.trim(),
      attachments,
      is_internal:internal,
    }).select("message_id, created_at").single();
    if (iErr) throw iErr;

    // Notify the other side (skip for internal notes)
    if (!internal) {
      // Look up customer email for outbound
      const { data: cd } = await sb.from("customer_details")
        .select("first_names, last_name, email, email_address")
        .eq("customer_id", ticket.customer_id).maybeSingle();
      const customerEmail = cd?.email ?? cd?.email_address;
      const customerName  = `${cd?.first_names ?? ""} ${cd?.last_name ?? ""}`.trim() || "Customer";

      try {
        if (authorRole === "admin" && customerEmail) {
          const h = html(`
            <div class="h"><h1>💬 New reply on your ticket</h1></div>
            <div class="body">
              <p>Hi ${escapeHtml(customerName)},</p>
              <p>Our team has replied to your support ticket <b>${ticket.ticket_number}</b>:</p>
              <pre>${escapeHtml(body)}</pre>
              <p><a class="btn" href="${PORTAL_URL}#support">View &amp; reply</a></p>
            </div>`);
          await sendHTMLEmail(customerEmail, FROM_EMAIL, `[${ticket.ticket_number}] Reply: ${ticket.subject}`, h);
        } else if (authorRole === "customer") {
          const h = html(`
            <div class="h"><h1>💬 Customer reply</h1></div>
            <div class="body">
              <p><b>${escapeHtml(customerName)}</b> replied on ticket <b>${ticket.ticket_number}</b> (${ticket.priority}):</p>
              <pre>${escapeHtml(body)}</pre>
              <p><a class="btn" href="${ADMIN_URL}#support-module">Open in Admin</a></p>
            </div>`);
          await sendHTMLEmail(ADMIN_EMAIL, FROM_EMAIL, `[${ticket.ticket_number}] Reply from ${customerName}`, h);
        }
      } catch (e) { console.error("Reply notification failed:", e); }
    }

    return new Response(JSON.stringify({ success: true, message_id: msg.message_id, author_role: authorRole, is_internal: internal }), { status: 200, headers: CORS });

  } catch (e) {
    console.error("ef_post_ticket_reply error:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: CORS });
  }
});
