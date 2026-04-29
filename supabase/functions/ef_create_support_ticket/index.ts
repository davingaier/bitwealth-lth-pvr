// ef_create_support_ticket/index.ts
// Purpose: Authenticated customer creates a new support ticket; sends admin
// notification + customer auto-acknowledgement; auto-attaches a context snapshot.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendHTMLEmail } from "../_shared/smtp.ts";

const SB_URL  = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SR   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAIL  = Deno.env.get("SUPPORT_ADMIN_EMAIL") ?? "support@bitwealth.co.za";
const FROM_EMAIL   = Deno.env.get("SUPPORT_FROM_EMAIL")  ?? "support@bitwealth.co.za";
const PORTAL_URL   = Deno.env.get("PORTAL_URL")          ?? "https://www.bitwealth.co.za/customer-portal.html";
const ADMIN_URL    = Deno.env.get("ADMIN_URL")           ?? "https://www.bitwealth.co.za/admin/Advanced%20BTC%20DCA%20Strategy.html";
const SLACK_WEBHOOK = Deno.env.get("SLACK_SUPPORT_WEBHOOK") ?? "";
const ORG_ID_DEFAULT = Deno.env.get("ORG_ID")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const VALID_CATEGORIES = new Set([
  "account_login","kyc","bank_account","valr_exchange","deposits","withdrawals",
  "trading_strategy","fees_statements","performance_reporting","compliance_privacy",
  "bug_report","other"
]);
const VALID_PRIORITIES = new Set(["low","normal","high","urgent"]);

function html(body: string, extra = ""): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{font-family:Segoe UI,Tahoma,sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0;padding:20px}
    .c{max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .h{background:#003B73;color:#fff;padding:24px;text-align:center}
    .h h1{margin:0;font-size:20px}
    .b{padding:24px}
    .meta{background:#f9f9f9;padding:12px 16px;border-radius:6px;margin:12px 0;font-size:13px}
    .meta b{color:#003B73}
    .btn{display:inline-block;background:#F39C12;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:12px}
    .f{text-align:center;color:#888;font-size:12px;padding:16px}
    pre{white-space:pre-wrap;word-wrap:break-word;background:#fff;border:1px solid #eee;padding:12px;border-radius:4px}
  </style></head><body><div class="c">${body}${extra}</div></body></html>`;
}

async function notifySlack(text: string) {
  if (!SLACK_WEBHOOK) return;
  try { await fetch(SLACK_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); }
  catch (e) { console.error("Slack webhook error:", e); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  try {
    // Authenticate caller using their JWT
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: CORS });
    }
    const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: "Invalid session" }), { status: 401, headers: CORS });

    const body = await req.json();
    const { category, subject, description, priority = "normal", attachments = [], context = {} } = body ?? {};

    if (!category || !VALID_CATEGORIES.has(category))
      return new Response(JSON.stringify({ error: "Invalid category" }), { status: 400, headers: CORS });
    if (!subject || subject.trim().length < 3 || subject.length > 200)
      return new Response(JSON.stringify({ error: "Subject must be 3-200 characters" }), { status: 400, headers: CORS });
    if (!description || description.trim().length < 5 || description.length > 10000)
      return new Response(JSON.stringify({ error: "Description must be 5-10000 characters" }), { status: 400, headers: CORS });
    if (!VALID_PRIORITIES.has(priority))
      return new Response(JSON.stringify({ error: "Invalid priority" }), { status: 400, headers: CORS });

    // Service-role client for resolving customer + inserting (RLS-safe path)
    const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

    // Resolve customer by user email
    const { data: cd, error: cdErr } = await sb
      .from("customer_details")
      .select("customer_id, org_id, first_names, last_name, email, email_address, phone_number")
      .or(`email.eq.${user.email},email_address.eq.${user.email}`)
      .order("customer_id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cdErr || !cd) {
      return new Response(JSON.stringify({ error: "Customer profile not found" }), { status: 404, headers: CORS });
    }

    // Generate ticket number via RPC
    const { data: numData, error: numErr } = await sb.rpc("next_support_ticket_number");
    if (numErr) throw numErr;
    const ticket_number: string = numData as string;

    const enriched_context = {
      ...context,
      user_agent: req.headers.get("user-agent"),
      ip_hint:    req.headers.get("x-forwarded-for"),
      submitted_from: context?.page ?? "portal",
    };

    // Insert ticket
    const { data: ticket, error: tErr } = await sb
      .from("support_tickets")
      .insert({
        ticket_number,
        org_id:      cd.org_id ?? ORG_ID_DEFAULT,
        customer_id: cd.customer_id,
        category,
        priority,
        subject:     subject.trim(),
        context:     enriched_context,
        source:      "portal",
      })
      .select("ticket_id, ticket_number, org_id, customer_id, priority, status, created_at")
      .single();
    if (tErr) throw tErr;

    // First message = the description
    const { error: mErr } = await sb.from("support_ticket_messages").insert({
      ticket_id:  ticket.ticket_id,
      author_id:  user.id,
      author_role:"customer",
      body:       description.trim(),
      attachments,
      is_internal:false,
    });
    if (mErr) throw mErr;

    // ---- Customer ack email ----
    const customerEmail = cd.email ?? cd.email_address ?? user.email;
    const customerName  = `${cd.first_names ?? ""} ${cd.last_name ?? ""}`.trim() || "there";
    const ackHtml = html(`
      <div class="h"><h1>✅ We've received your support request</h1></div>
      <div class="b">
        <p>Hi ${customerName},</p>
        <p>Thanks for reaching out. Your ticket has been logged and our team will be in touch as soon as possible.</p>
        <div class="meta">
          <b>Ticket:</b> ${ticket.ticket_number}<br>
          <b>Subject:</b> ${escapeHtml(subject)}<br>
          <b>Category:</b> ${category}<br>
          <b>Priority:</b> ${priority}
        </div>
        <p><b>Your message:</b></p><pre>${escapeHtml(description)}</pre>
        <p>You can track the conversation from your portal:</p>
        <p><a class="btn" href="${PORTAL_URL}#support">Open Support Portal</a></p>
        <div class="f">BitWealth · ${new Date().getFullYear()}</div>
      </div>`);
    if (customerEmail) {
      try { await sendHTMLEmail(customerEmail, FROM_EMAIL, `[${ticket.ticket_number}] ${subject}`, ackHtml); }
      catch (e) { console.error("Customer ack email failed:", e); }
    }

    // ---- Admin notification email ----
    const priorityFlag = priority === "urgent" ? "🚨 URGENT · " : priority === "high" ? "⚠️ HIGH · " : "";
    const adminHtml = html(`
      <div class="h"><h1>🆕 New support ticket</h1></div>
      <div class="b">
        <div class="meta">
          <b>Ticket:</b> ${ticket.ticket_number}<br>
          <b>Customer:</b> ${escapeHtml(customerName)} (#${cd.customer_id})<br>
          <b>Email:</b> ${escapeHtml(customerEmail ?? "")}<br>
          <b>Phone:</b> ${escapeHtml(cd.phone_number ?? "—")}<br>
          <b>Category:</b> ${category}<br>
          <b>Priority:</b> ${priority}
        </div>
        <p><b>Subject:</b> ${escapeHtml(subject)}</p>
        <pre>${escapeHtml(description)}</pre>
        <p><a class="btn" href="${ADMIN_URL}#support-module">Open in Admin</a></p>
      </div>`);
    try { await sendHTMLEmail(ADMIN_EMAIL, FROM_EMAIL, `${priorityFlag}[${ticket.ticket_number}] ${subject}`, adminHtml); }
    catch (e) { console.error("Admin notification failed:", e); }

    // ---- Slack webhook (Phase 3, urgent only) ----
    if (priority === "urgent") {
      await notifySlack(`🚨 *URGENT support ticket* ${ticket.ticket_number}\n*${customerName}* (${customerEmail})\n*${subject}*\n${description.slice(0, 400)}`);
    }

    return new Response(JSON.stringify({
      success: true,
      ticket_id: ticket.ticket_id,
      ticket_number: ticket.ticket_number,
      status: ticket.status,
    }), { status: 200, headers: CORS });

  } catch (e) {
    console.error("ef_create_support_ticket error:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500, headers: CORS });
  }
});

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c] as string));
}
