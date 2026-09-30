// _shared/partnerEmail.ts — email plumbing for partner (Finova) custody workflows.
//
// Partner-facing mails go to public.partners.notify_email (+ cc_email for a BitWealth
// copy). They deliberately carry no credentials or client banking details — only the
// client name, BitWealth reference and what action is needed in the portal.

import { sendEmail } from "./smtp.ts";

export const PARTNER_PORTAL_URL =
  Deno.env.get("PARTNER_PORTAL_URL") ?? "https://bitwealth.co.za/partner";
export const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "admin@bitwealth.co.za";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "BitWealth <noreply@bitwealth.co.za>";

export interface PartnerConfig {
  partner_code: string;
  display_name: string;
  notify_email: string;
  cc_email: string | null;
  sla_provision_business_days: number;
  sla_withdrawal_business_days: number;
  is_active: boolean;
}

// deno-lint-ignore no-explicit-any
export async function loadPartner(sb: any, partnerCode = "finova"): Promise<PartnerConfig | null> {
  const { data } = await sb.schema("public").from("partners")
    .select("*").eq("partner_code", partnerCode).maybeSingle();
  return (data as PartnerConfig | null) ?? null;
}

export function partnerRecipients(p: PartnerConfig): string[] {
  return [p.notify_email, p.cc_email].filter((e): e is string => !!e);
}

export const escHtml = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Minimal branded shell; `rows` render as a two-column details table. */
export function emailShell(opts: {
  title: string;
  intro: string;
  rows?: Array<[string, string]>;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const rows = (opts.rows ?? []).map(([k, v]) => `
      <tr><td style="padding:6px 0;color:#4b5563;width:42%;vertical-align:top;">${escHtml(k)}</td>
          <td style="padding:6px 0;color:#111827;font-weight:600;">${v}</td></tr>`).join("");
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Aptos','Segoe UI','Helvetica Neue',Arial,sans-serif;background:#f4f4f4;">
  <div style="max-width:620px;margin:0 auto;background:#ffffff;">
    <div style="background:#032C48;padding:26px 30px;">
      <div style="font-size:26px;font-weight:700;color:#F39C12;">BitWealth</div>
      <div style="font-size:12px;color:#ffffff;letter-spacing:1px;text-transform:uppercase;opacity:.9;">Partner Portal</div>
    </div>
    <div style="padding:28px 30px;">
      <h2 style="margin:0 0 12px 0;color:#032C48;font-size:20px;">${escHtml(opts.title)}</h2>
      <p style="margin:0 0 18px 0;color:#374151;font-size:14.5px;line-height:1.6;">${opts.intro}</p>
      ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px;">${rows}</table>` : ""}
      ${opts.bodyHtml ?? ""}
      ${opts.ctaUrl ? `<div style="margin:24px 0;"><a href="${opts.ctaUrl}" style="display:inline-block;background:#F39C12;color:#032C48;padding:12px 26px;text-decoration:none;border-radius:8px;font-weight:700;">${escHtml(opts.ctaLabel ?? "Open portal")}</a></div>` : ""}
    </div>
    <div style="background:#f9fafb;padding:16px 30px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
      ${opts.footer ?? "Automated notification from BitWealth. No credentials or banking details are ever sent by email."}
    </div>
  </div>
</body></html>`;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(br|\/tr|\/p|\/h2|\/div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

/** Send and record in public.email_logs. Never throws. */
export async function sendLoggedEmail(
  // deno-lint-ignore no-explicit-any
  sb: any,
  opts: { to: string[]; subject: string; html: string; templateKey: string; data?: Record<string, unknown> },
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await sendEmail({
      to: opts.to,
      from: FROM_EMAIL,
      subject: opts.subject,
      html: opts.html,
      text: htmlToText(opts.html),
    });
    await sb.schema("public").from("email_logs").insert({
      template_key: opts.templateKey,
      recipient_email: opts.to.join(", "),
      subject: opts.subject,
      status: res.success ? "sent" : "failed",
      smtp_message_id: res.messageId ?? null,
      error_message: res.error ?? null,
      template_data: opts.data ?? null,
    });
    return { success: res.success, error: res.error };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
