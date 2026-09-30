// Edge Function: ef_partner_fee_invoice
// Purpose: Monthly consolidated fee invoice to the partner (Finova).
//
// Fees for Finova-custody clients never reach BitWealth's VALR account. Each fee is
// either swept from the client's subaccount to Finova's main account
// (valr_transfer_log.status='completed'), or — when the subaccount ID is unknown —
// left in the subaccount for Finova to move (status='deferred'). Both are listed
// here; deferred lines are flagged "held in subaccount" and are closed when Finova
// clicks "Confirm held fees transferred" in the portal.
//
// Body (all optional): { period: "YYYY-MM", resend: boolean, dry_run: boolean }
//   period defaults to the previous calendar month (UTC).
//
// Trigger: pg_cron 'partner_fee_invoice_monthly' (1st of month 06:30 UTC).
// Auth: service role or BitWealth org admin.
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

const FEE_LABELS: Record<string, string> = {
  platform_fee: "Platform fee",
  platform_fee_batch: "Platform fee",
  fee_batch: "Platform fee",
  performance_fee: "Performance fee",
  management_fee: "Management fee",
  annual_platform_fee: "Annual platform fee",
  annual_performance_fee: "Annual performance fee",
  annual_management_fee: "Annual management fee",
  partner_fee_sweep: "Fee",
  manual: "Fee (manual)",
};

interface Line {
  transfer_id: string;
  date: string;
  customer_id: number;
  client_name: string;
  subaccount: string;
  fee_type: string;
  currency: string;
  amount: number;
  held: boolean;
}

function periodBounds(period?: string): { start: string; end: string; label: string; key: string } {
  let y: number, m: number;
  if (period && /^\d{4}-\d{2}$/.test(period)) {
    [y, m] = period.split("-").map(Number);
  } else {
    const now = new Date();
    y = now.getUTCFullYear();
    m = now.getUTCMonth(); // previous month, 1-based
    if (m === 0) { y -= 1; m = 12; }
  }
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    start: iso(start),
    end: iso(end),
    label: start.toLocaleString("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" }),
    key: `${y}${String(m).padStart(2, "0")}`,
  };
}

const fmtAmt = (currency: string, n: number) =>
  currency === "BTC" ? `${n.toFixed(8)} BTC` : `${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function buildEmail(invoiceNumber: string, periodLabel: string, lines: Line[], totals: Record<string, { swept: number; held: number; total: number }>) {
  const rowsHtml = lines.map((l) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escHtml(l.date)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escHtml(l.client_name)}<br><span style="color:#6b7280;font-size:12px;">#${l.customer_id}</span></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;"><code>${escHtml(l.subaccount)}</code></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escHtml(l.fee_type)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${fmtAmt(l.currency, l.amount)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${l.held ? '<strong style="color:#b45309;">Held in subaccount</strong>' : "In Finova main account"}</td>
    </tr>`).join("");

  const totalsHtml = Object.entries(totals).map(([cur, t]) => `<tr>
      <td style="padding:6px 8px;font-weight:700;">${escHtml(cur)}</td>
      <td style="padding:6px 8px;text-align:right;">${fmtAmt(cur, t.swept)}</td>
      <td style="padding:6px 8px;text-align:right;">${fmtAmt(cur, t.held)}</td>
      <td style="padding:6px 8px;text-align:right;font-weight:700;">${fmtAmt(cur, t.total)}</td>
    </tr>`).join("");

  const heldCount = lines.filter((l) => l.held).length;
  const heldNote = heldCount
    ? `<div style="background:#fef3c7;color:#92400e;padding:12px 14px;border-radius:6px;font-size:13.5px;margin:16px 0;line-height:1.55;">
         <strong>${heldCount} fee${heldCount === 1 ? " is" : "s are"} held in client subaccounts.</strong>
         Please transfer each held amount from the subaccount shown to Finova's main account, then open this invoice in the
         partner portal and click <strong>Confirm held fees transferred</strong>.
       </div>`
    : "";

  const bodyHtml = `${heldNote}
    <h3 style="color:#032C48;font-size:16px;margin:18px 0 8px;">Summary</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13.5px;">
      <tr style="background:#f3f4f6;"><th style="padding:6px 8px;text-align:left;">Currency</th><th style="padding:6px 8px;text-align:right;">In main account</th><th style="padding:6px 8px;text-align:right;">Held in subaccounts</th><th style="padding:6px 8px;text-align:right;">Total due</th></tr>
      ${totalsHtml}
    </table>
    <h3 style="color:#032C48;font-size:16px;margin:22px 0 8px;">Detail</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
      <tr style="background:#f3f4f6;"><th style="padding:6px 8px;text-align:left;">Date</th><th style="padding:6px 8px;text-align:left;">Client</th><th style="padding:6px 8px;text-align:left;">Subaccount</th><th style="padding:6px 8px;text-align:left;">Fee</th><th style="padding:6px 8px;text-align:right;">Amount</th><th style="padding:6px 8px;text-align:left;">Location</th></tr>
      ${rowsHtml}
    </table>`;

  return emailShell({
    title: `Fee invoice ${invoiceNumber} — ${periodLabel}`,
    intro: `BitWealth's management, performance and platform fees for Finova-custody clients for ${escHtml(periodLabel)}. The total below is payable to BitWealth under our agreement.`,
    bodyHtml,
    ctaLabel: "View in partner portal",
    ctaUrl: PARTNER_PORTAL_URL,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const caller = await requireOrgAdmin(sb, req, SUPABASE_KEY);
  if (!caller.ok) return json({ error: caller.error }, caller.status);

  let body: { period?: string; resend?: boolean; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const partner = await loadPartner(sb, "finova");
  if (!partner?.is_active) return json({ success: true, skipped: "partner inactive or not configured" });

  const p = periodBounds(body.period);
  const invoiceNumber = `BW-${partner.partner_code.toUpperCase()}-${p.key}`;

  const { data: existing } = await sb.from("partner_invoices")
    .select("*").eq("partner_code", partner.partner_code).eq("period_start", p.start).maybeSingle();

  if (existing && !body.resend) {
    return json({ success: true, already_issued: true, invoice_number: existing.invoice_number });
  }

  let lines: Line[];
  let totals: Record<string, { swept: number; held: number; total: number }>;

  if (existing) {
    lines = existing.lines as Line[];
    totals = existing.totals;
  } else {
    const { data: logs, error: logErr } = await sb.schema("lth_pvr").from("valr_transfer_log")
      .select("transfer_id, customer_id, transfer_type, currency, amount, status, created_at")
      .eq("to_account", "partner_main")
      .in("status", ["completed", "deferred"])
      .is("partner_invoice_id", null)
      .gte("created_at", `${p.start}T00:00:00Z`)
      .lt("created_at", new Date(Date.parse(`${p.end}T00:00:00Z`) + 86_400_000).toISOString())
      .order("created_at");
    if (logErr) return json({ error: `Could not read fee transfers: ${logErr.message}` }, 500);

    const custIds = [...new Set((logs ?? []).map((l) => l.customer_id))];
    const { data: custs } = custIds.length
      ? await sb.from("customer_details").select("customer_id, first_names, last_name, display_name, account_model").in("customer_id", custIds)
      : { data: [] };
    const { data: cs } = custIds.length
      ? await sb.from("customer_strategies").select("customer_id, exchange_account_id").in("customer_id", custIds)
      : { data: [] };
    const eaIds = (cs ?? []).map((r) => r.exchange_account_id).filter(Boolean);
    const { data: eas } = eaIds.length
      ? await sb.from("exchange_accounts").select("exchange_account_id, label").in("exchange_account_id", eaIds)
      : { data: [] };

    const custMap = new Map((custs ?? []).map((c) => [c.customer_id, c]));
    const labelByEa = new Map((eas ?? []).map((e) => [e.exchange_account_id, e.label]));
    const labelByCust = new Map((cs ?? []).map((r) => [r.customer_id, labelByEa.get(r.exchange_account_id) ?? ""]));

    lines = (logs ?? [])
      .filter((l) => custMap.get(l.customer_id)?.account_model === "finova_omnibus")
      .map((l) => {
        const c = custMap.get(l.customer_id)!;
        return {
          transfer_id: l.transfer_id,
          date: String(l.created_at).slice(0, 10),
          customer_id: l.customer_id,
          client_name: c.display_name || [c.first_names, c.last_name].filter(Boolean).join(" ") || `Client ${l.customer_id}`,
          subaccount: labelByCust.get(l.customer_id) || "—",
          fee_type: FEE_LABELS[l.transfer_type] ?? l.transfer_type,
          currency: l.currency,
          amount: Number(l.amount),
          held: l.status === "deferred",
        };
      });

    totals = {};
    for (const l of lines) {
      const t = totals[l.currency] ??= { swept: 0, held: 0, total: 0 };
      if (l.held) t.held += l.amount; else t.swept += l.amount;
      t.total += l.amount;
    }
  }

  if (!lines.length) {
    return json({ success: true, nil: true, period: p.start, message: "No partner fees in this period — no invoice issued." });
  }

  const heldCount = lines.filter((l) => l.held).length;
  const html = buildEmail(invoiceNumber, p.label, lines, totals);

  if (body.dry_run) {
    return json({ success: true, dry_run: true, invoice_number: invoiceNumber, lines, totals, held_line_count: heldCount });
  }

  let invoiceId = existing?.invoice_id as string | undefined;
  if (!invoiceId) {
    const { data: inv, error: insErr } = await sb.from("partner_invoices").insert({
      invoice_number: invoiceNumber,
      partner_code: partner.partner_code,
      org_id: ORG_ID,
      period_start: p.start,
      period_end: p.end,
      lines,
      totals,
      held_line_count: heldCount,
    }).select("invoice_id").single();
    if (insErr) return json({ error: `Could not create invoice: ${insErr.message}` }, 500);
    invoiceId = inv.invoice_id;

    await sb.schema("lth_pvr").from("valr_transfer_log")
      .update({ partner_invoice_id: invoiceId })
      .in("transfer_id", lines.map((l) => l.transfer_id));
  }

  const to = partnerRecipients(partner);
  const sent = await sendLoggedEmail(sb, {
    to,
    subject: `BitWealth fee invoice ${invoiceNumber} — ${p.label}`,
    html,
    templateKey: "partner_fee_invoice",
    data: { invoice_number: invoiceNumber, period: p.start, lines: lines.length, held: heldCount },
  });

  await sb.from("partner_invoices").update({
    sent_to: to.join(", "),
    sent_at: sent.success ? new Date().toISOString() : null,
    email_error: sent.success ? null : sent.error,
  }).eq("invoice_id", invoiceId);

  if (!sent.success) {
    await logAlert(sb, "ef_partner_fee_invoice", "error",
      `Fee invoice ${invoiceNumber} created but the email failed: ${sent.error}`,
      { invoice_id: invoiceId, invoice_number: invoiceNumber }, ORG_ID);
  }

  return json({
    success: true,
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
    lines: lines.length,
    held_line_count: heldCount,
    totals,
    emailed: sent.success,
  });
});
