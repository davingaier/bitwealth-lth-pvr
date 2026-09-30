// Edge Function: ef_partner_notifications
// Purpose: Emails the partner (Finova) about work waiting in the partner portal and
//          chases anything that has breached the agreed turnaround.
//
//   • New subaccount / bank re-link request        → one email per request
//   • Withdrawal handed off (awaiting_partner)     → one email per withdrawal
//   • Request older than sla_provision_business_days  → one reminder + warn alert
//   • Withdrawal older than sla_withdrawal_business_days → one reminder + warn alert
//
// Idempotent: *_email_sent_at / *_reminder_sent_at are only stamped after a
// successful send, so a failed send is retried on the next run.
//
// Trigger: pg_cron 'partner_notifications' every 10 minutes (service_jwt).
// Auth: service role or BitWealth org admin (requireOrgAdmin).
// Deployed with: --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { requireOrgAdmin } from "../_shared/adminAuth.ts";
import { logAlert } from "../_shared/alerting.ts";
import {
  emailShell, escHtml, loadPartner, partnerRecipients, PARTNER_PORTAL_URL, sendLoggedEmail,
} from "../_shared/partnerEmail.ts";

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
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });

const DAY_MS = 86_400_000;
const SAST_OFFSET_MS = 2 * 3_600_000; // South Africa has no DST

/** Weekdays elapsed after the start date (SAST), up to and including today. */
export function businessDaysSince(fromIso: string, now = new Date()): number {
  const s = new Date(new Date(fromIso).getTime() + SAST_OFFSET_MS);
  const e = new Date(now.getTime() + SAST_OFFSET_MS);
  const endDay = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  let n = 0;
  for (let d = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) + DAY_MS; d <= endDay; d += DAY_MS) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }) : "—";
const fmtZar = (n: number) =>
  "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bd = (n: number) => `${n} business day${n === 1 ? "" : "s"}`;

type Cust = { customer_id: number; first_names: string | null; last_name: string | null; display_name: string | null; client_type: string | null; account_model: string | null };
const clientName = (c?: Cust) =>
  c?.display_name || [c?.first_names, c?.last_name].filter(Boolean).join(" ") || `Client ${c?.customer_id ?? ""}`;

async function loadCustomers(ids: number[]): Promise<Map<number, Cust>> {
  if (!ids.length) return new Map();
  const { data } = await sb.from("customer_details")
    .select("customer_id, first_names, last_name, display_name, client_type, account_model")
    .in("customer_id", ids);
  return new Map((data ?? []).map((c: Cust) => [c.customer_id, c]));
}

async function loadSubaccountLabels(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const { data: cs } = await sb.from("customer_strategies")
    .select("customer_id, exchange_account_id").in("customer_id", ids);
  const eaIds = (cs ?? []).map((r: { exchange_account_id: string | null }) => r.exchange_account_id).filter(Boolean);
  if (!eaIds.length) return new Map();
  const { data: ea } = await sb.from("exchange_accounts")
    .select("exchange_account_id, label").in("exchange_account_id", eaIds);
  const labelByEa = new Map((ea ?? []).map((r: { exchange_account_id: string; label: string }) => [r.exchange_account_id, r.label]));
  return new Map((cs ?? []).map((r: { customer_id: number; exchange_account_id: string }) =>
    [r.customer_id, labelByEa.get(r.exchange_account_id) ?? ""]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const caller = await requireOrgAdmin(sb, req, SUPABASE_KEY);
  if (!caller.ok) return json({ error: caller.error }, caller.status);

  const partner = await loadPartner(sb, "finova");
  if (!partner?.is_active) return json({ success: true, skipped: "partner inactive or not configured" });

  const to = partnerRecipients(partner);
  const summary = { requests_notified: 0, request_reminders: 0, withdrawals_notified: 0, withdrawal_reminders: 0, failures: [] as string[] };

  // ── 1. Subaccount / bank re-link requests ────────────────────────────────
  const { data: reqs, error: reqErr } = await sb.from("subaccount_requests")
    .select("request_id, customer_id, org_id, request_type, status, suggested_subaccount_name, requested_at, partner_email_sent_at, partner_reminder_sent_at")
    .eq("partner_code", partner.partner_code)
    .in("status", ["pending", "submitted"]);
  if (reqErr) summary.failures.push(`requests: ${reqErr.message}`);

  const reqCustomers = await loadCustomers([...new Set((reqs ?? []).map((r) => r.customer_id))]);

  for (const r of reqs ?? []) {
    const cust = reqCustomers.get(r.customer_id);
    if (cust?.account_model !== "finova_omnibus") continue;

    const isRelink = r.request_type === "bank_relink";
    const name = clientName(cust);
    const baseRows: Array<[string, string]> = [
      ["Client", escHtml(name)],
      ["BitWealth client reference", `#${r.customer_id}`],
      ["Client type", escHtml(cust?.client_type === "entity" ? "Entity" : "Individual")],
      [isRelink ? "Subaccount" : "Subaccount name to create",
        `<code style="background:#f3f4f6;padding:3px 7px;border-radius:5px;">${escHtml(r.suggested_subaccount_name)}</code>`],
      ["Requested", fmtDate(r.requested_at)],
      ["Target turnaround", bd(partner.sla_provision_business_days)],
    ];
    const steps = isRelink
      ? `<ol style="color:#374151;font-size:14px;line-height:1.8;padding-left:20px;">
           <li>Update the bank account linked to this client's subaccount in VALR, using the new details the client has given Finova.</li>
           <li>Open the request in the partner portal and click <strong>Confirm re-linked</strong>.</li>
         </ol>
         <p style="color:#92400e;font-size:13.5px;">Withdrawals for this client are held until the re-link is confirmed.</p>`
      : `<ol style="color:#374151;font-size:14px;line-height:1.8;padding-left:20px;">
           <li><strong>Create the subaccount</strong> in VALR using the exact name above.</li>
           <li><strong>Link the client's bank account</strong> to the subaccount and <strong>generate the ZAR deposit reference</strong>.</li>
           <li>Create an API key on the subaccount with <strong>View, Trade and Internal Transfer</strong> only (no Withdraw), then submit the details in the portal.</li>
         </ol>`;

    if (!r.partner_email_sent_at) {
      const subject = isRelink
        ? `BitWealth: bank re-link required — ${name} (#${r.customer_id})`
        : `BitWealth: new client subaccount required — ${name} (#${r.customer_id})`;
      const html = emailShell({
        title: isRelink ? "Client bank account change" : "New client subaccount required",
        intro: isRelink
          ? "A BitWealth client held in the Finova omnibus account has changed bank account. Please re-link it to their subaccount."
          : "A new BitWealth client has completed onboarding and needs a VALR subaccount in the Finova omnibus account.",
        rows: baseRows,
        bodyHtml: steps,
        ctaLabel: "Open partner portal",
        ctaUrl: PARTNER_PORTAL_URL,
      });
      const sent = await sendLoggedEmail(sb, { to, subject, html, templateKey: isRelink ? "partner_bank_relink_request" : "partner_subaccount_request", data: { request_id: r.request_id, customer_id: r.customer_id } });
      if (sent.success) {
        await sb.from("subaccount_requests").update({ partner_email_sent_at: new Date().toISOString() }).eq("request_id", r.request_id);
        summary.requests_notified++;
      } else {
        summary.failures.push(`request ${r.request_id}: ${sent.error}`);
      }
      continue;
    }

    const age = businessDaysSince(r.requested_at);
    if (age > partner.sla_provision_business_days && !r.partner_reminder_sent_at) {
      const subject = `Reminder: overdue ${isRelink ? "bank re-link" : "subaccount request"} — ${name} (#${r.customer_id})`;
      const html = emailShell({
        title: "Reminder — request overdue",
        intro: `This request has been open for ${bd(age)}, beyond the agreed ${bd(partner.sla_provision_business_days)}.`,
        rows: baseRows,
        bodyHtml: steps,
        ctaLabel: "Open partner portal",
        ctaUrl: PARTNER_PORTAL_URL,
      });
      const sent = await sendLoggedEmail(sb, { to, subject, html, templateKey: "partner_request_reminder", data: { request_id: r.request_id, age_business_days: age } });
      if (sent.success) {
        await sb.from("subaccount_requests").update({ partner_reminder_sent_at: new Date().toISOString() }).eq("request_id", r.request_id);
        summary.request_reminders++;
        await logAlert(sb, "ef_partner_notifications", "warn",
          `Finova ${isRelink ? "bank re-link" : "subaccount request"} overdue for customer ${r.customer_id} (${bd(age)})`,
          { request_id: r.request_id, customer_id: r.customer_id, age_business_days: age }, r.org_id, r.customer_id);
      } else {
        summary.failures.push(`reminder ${r.request_id}: ${sent.error}`);
      }
    }
  }

  // ── 2. Withdrawals awaiting partner payout ───────────────────────────────
  const { data: wds, error: wdErr } = await sb.schema("lth_pvr").from("withdrawal_requests")
    .select("request_id, customer_id, org_id, net_amount, amount_zar, requested_at, partner_notified_at, partner_email_sent_at, partner_reminder_sent_at")
    .eq("status", "awaiting_partner");
  if (wdErr) summary.failures.push(`withdrawals: ${wdErr.message}`);

  const wdIds = [...new Set((wds ?? []).map((w) => w.customer_id))];
  const wdCustomers = await loadCustomers(wdIds);
  const labels = await loadSubaccountLabels(wdIds);

  const { data: openRelinks } = wdIds.length
    ? await sb.from("subaccount_requests").select("customer_id")
        .eq("request_type", "bank_relink").in("status", ["pending", "submitted"]).in("customer_id", wdIds)
    : { data: [] };
  const relinkPending = new Set((openRelinks ?? []).map((r: { customer_id: number }) => r.customer_id));

  for (const w of wds ?? []) {
    const cust = wdCustomers.get(w.customer_id);
    if (cust?.account_model !== "finova_omnibus") continue;

    const name = clientName(cust);
    const amount = Number(w.net_amount ?? w.amount_zar ?? 0);
    const readyAt = w.partner_notified_at ?? w.requested_at;
    const rows: Array<[string, string]> = [
      ["Client", escHtml(name)],
      ["BitWealth client reference", `#${w.customer_id}`],
      ["Subaccount", `<code style="background:#f3f4f6;padding:3px 7px;border-radius:5px;">${escHtml(labels.get(w.customer_id) || "—")}</code>`],
      ["Amount to pay", `<span style="color:#059669;font-size:1.1em;">${fmtZar(amount)}</span>`],
      ["Ready since", fmtDate(readyAt)],
      ["Target turnaround", bd(partner.sla_withdrawal_business_days)],
    ];
    const hold = relinkPending.has(w.customer_id)
      ? `<p style="background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:6px;font-size:13.5px;">A bank re-link is open for this client. Please complete the re-link first — the payout cannot be marked complete until it is confirmed.</p>`
      : "";
    const steps = `${hold}<ol style="color:#374151;font-size:14px;line-height:1.8;padding-left:20px;">
        <li>Perform your normal internal authorisation and verify the request.</li>
        <li>In VALR, withdraw exactly <strong>${fmtZar(amount)}</strong> from the subaccount above to the client's linked bank account.</li>
        <li>Mark the item as paid in the partner portal with your payment reference.</li>
      </ol>`;

    if (!w.partner_email_sent_at) {
      const html = emailShell({
        title: "Client withdrawal awaiting payout",
        intro: "BitWealth has converted this client's holdings to ZAR inside their subaccount. The funds are ready for Finova to pay out.",
        rows, bodyHtml: steps, ctaLabel: "Open partner portal", ctaUrl: PARTNER_PORTAL_URL,
      });
      const sent = await sendLoggedEmail(sb, {
        to, subject: `BitWealth: withdrawal awaiting payout — ${name} (#${w.customer_id}) ${fmtZar(amount)}`,
        html, templateKey: "partner_withdrawal_request", data: { request_id: w.request_id, customer_id: w.customer_id, amount_zar: amount },
      });
      if (sent.success) {
        await sb.schema("lth_pvr").from("withdrawal_requests").update({ partner_email_sent_at: new Date().toISOString() }).eq("request_id", w.request_id);
        summary.withdrawals_notified++;
      } else {
        summary.failures.push(`withdrawal ${w.request_id}: ${sent.error}`);
      }
      continue;
    }

    const age = businessDaysSince(readyAt);
    if (age > partner.sla_withdrawal_business_days && !w.partner_reminder_sent_at) {
      const html = emailShell({
        title: "Reminder — withdrawal overdue",
        intro: `This payout has been waiting ${bd(age)}, beyond the agreed ${bd(partner.sla_withdrawal_business_days)}.`,
        rows, bodyHtml: steps, ctaLabel: "Open partner portal", ctaUrl: PARTNER_PORTAL_URL,
      });
      const sent = await sendLoggedEmail(sb, {
        to, subject: `Reminder: overdue withdrawal — ${name} (#${w.customer_id}) ${fmtZar(amount)}`,
        html, templateKey: "partner_withdrawal_reminder", data: { request_id: w.request_id, age_business_days: age },
      });
      if (sent.success) {
        await sb.schema("lth_pvr").from("withdrawal_requests").update({ partner_reminder_sent_at: new Date().toISOString() }).eq("request_id", w.request_id);
        summary.withdrawal_reminders++;
        await logAlert(sb, "ef_partner_notifications", "warn",
          `Finova payout overdue for customer ${w.customer_id} (${fmtZar(amount)}, ${bd(age)})`,
          { request_id: w.request_id, customer_id: w.customer_id, age_business_days: age }, w.org_id, w.customer_id);
      } else {
        summary.failures.push(`withdrawal reminder ${w.request_id}: ${sent.error}`);
      }
    }
  }

  if (summary.failures.length) {
    await logAlert(sb, "ef_partner_notifications", "error",
      `Partner notification failures: ${summary.failures.length}`, { failures: summary.failures.slice(0, 10) }, ORG_ID);
  }

  return json({ success: true, ...summary });
});
