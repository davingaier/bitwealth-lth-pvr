// supabase/functions/ef_admin_email_templates/index.ts
// Purpose: Admin-only CRUD + preview + test-send for public.email_templates.
// Auth: JWT-required. Caller must be an owner/admin in at least one org_members row.
// Deployed with: --verify-jwt (default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SECRET_KEY") ?? Deno.env.get("Secret Key");

// Sample placeholder values for the Preview action. Mirror the local
// _render_email_templates.py keys so the preview matches what is shown
// in _email_previews/.
const SAMPLE: Record<string, string> = {
  first_name: "Ellie", first_names: "Ellie", surname: "Landman", last_name: "Landman",
  full_name: "Ellie Landman", name: "Ellie Landman",
  email: "elna@example.com", email_address: "elna@example.com",
  customer_id: "52", phone_country_code: "+27", phone_number: "82 123 4567",
  cell_number: "+27 82 123 4567", country: "South Africa",
  upfront_investment_amount_range: "R 100,000 – R 250,000",
  monthly_investment_amount_range: "R 10,000 – R 25,000",
  message: "I would like to learn more about your DCA strategy.",
  created_at: "2026-04-25 11:58 UTC", submission_date: "2026-04-25 11:58 UTC",
  amount: "50,000.00", currency: "ZAR", btc_amount: "0.00123456",
  transaction_id: "tx_abc123", reference: "BW-REF-001",
  ticket_id: "TICKET-001", subject_line: "Sample subject",
  portfolio_name: "LTH PVR BTC DCA", portal_url: "https://portal.bitwealth.co.za",
  kyc_url: "https://portal.bitwealth.co.za/kyc",
  withdrawal_amount: "R 10,000.00", wallet_address: "bc1qsample...",
  month: "April 2026", nav: "R 1,234,567.89", performance: "+12.34%",
  deposit_reference: "DEP-001", bank_name: "Sample Bank", account_number: "1234567890",
  branch_code: "123456", swift_code: "SAMPZAJJ",
  api_key_name: "primary", rotation_date: "2026-05-01",
  ticket_subject: "Help with deposit", ticket_status: "open",
  reply_message: "Thanks for reaching out, we're on it.",
  support_agent: "Davin",
  // monthly_statement
  month_name: "March", year: "2026",
  monthly_invested: "25,000.00", total_invested: "300,000.00",
  btc_acquired: "0.01234567", avg_buy_price: "2,025,000.00",
  current_btc_price: "$ 65,432.10", purchase_count: "8",
  btc_balance: "0.15678901", portfolio_value: "$ 10,250.45",
  total_return: "12.34", return_color: "#10b981",
  performance_fee_rate: "10", performance_fee_amount: "$ 125.30",
  performance_fee_status_text: "Deducted",
  performance_fee_note: "The performance fee of 10% is calculated on your portfolio gains made for the month (subject to a high-water mark) and has been automatically deducted.",
  platform_fee_rate: "0.75", platform_fee_amount: "$ 18.75",
  platform_fee_status_text: "Deducted",
  platform_fee_note: "The platform fee of 0.75% is calculated on your net USDT contributions and has been automatically deducted.",
  website_url: "https://bitwealth.co.za",
  download_url: "https://bitwealth.co.za/statements/sample.pdf",
  bank_account: "Sample Bank •••• 7890",
  destination_address: "bc1qsampledestinationaddress0123456789xyz",
};

function substitute(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(data, key) ? data[key] : m,
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Missing SUPABASE_URL or service role key" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Authenticate caller
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!jwt) return json({ error: "missing bearer token" }, 401);
  const { data: callerData, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !callerData?.user) return json({ error: "unauthorized" }, 401);
  const caller = callerData.user;

  // Authorize: must be owner/admin in some org_members row
  const { data: memberships, error: memErr } = await admin
    .from("org_members")
    .select("role")
    .eq("user_id", caller.id);
  if (memErr) return json({ error: `membership check failed: ${memErr.message}` }, 500);
  const isAdmin = (memberships ?? []).some((m: any) => m.role === "owner" || m.role === "admin");
  if (!isAdmin) return json({ error: "forbidden — admin/owner role required" }, 403);

  // Parse body
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const action = String(body?.action ?? "").trim();

  try {
    switch (action) {
      case "list": {
        const { data, error } = await admin
          .from("email_templates")
          .select("template_id, template_key, name, description, subject, active, updated_at")
          .order("template_key", { ascending: true });
        if (error) throw error;
        return json({ templates: data ?? [] });
      }

      case "get": {
        const key = String(body?.template_key ?? "").trim();
        if (!key) return json({ error: "template_key required" }, 400);
        const { data, error } = await admin
          .from("email_templates")
          .select("*")
          .eq("template_key", key)
          .maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "not found" }, 404);
        return json({ template: data });
      }

      case "update": {
        const key = String(body?.template_key ?? "").trim();
        if (!key) return json({ error: "template_key required" }, 400);
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const k of ["name", "description", "subject", "body_html", "active"]) {
          if (Object.prototype.hasOwnProperty.call(body, k)) patch[k] = (body as any)[k];
        }
        const { data, error } = await admin
          .from("email_templates")
          .update(patch)
          .eq("template_key", key)
          .select("template_id, template_key, updated_at")
          .maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "not found" }, 404);
        return json({ template: data });
      }

      case "create": {
        const required = ["template_key", "name", "subject", "body_html"];
        for (const k of required) {
          if (!body?.[k]) return json({ error: `${k} required` }, 400);
        }
        const row = {
          template_key: String(body.template_key).trim(),
          name: String(body.name),
          description: body.description ?? null,
          subject: String(body.subject),
          body_html: String(body.body_html),
          active: body.active ?? true,
        };
        const { data, error } = await admin
          .from("email_templates")
          .insert(row)
          .select("template_id, template_key")
          .maybeSingle();
        if (error) throw error;
        return json({ template: data });
      }

      case "delete": {
        const key = String(body?.template_key ?? "").trim();
        if (!key) return json({ error: "template_key required" }, 400);
        const { error } = await admin
          .from("email_templates")
          .delete()
          .eq("template_key", key);
        if (error) throw error;
        return json({ ok: true });
      }

      case "preview": {
        // Render with provided body_html (unsaved edits) OR fall back to DB row.
        let html = body?.body_html as string | undefined;
        let subject = body?.subject as string | undefined;
        if (!html || !subject) {
          const key = String(body?.template_key ?? "").trim();
          if (!key) return json({ error: "template_key or body_html+subject required" }, 400);
          const { data, error } = await admin
            .from("email_templates")
            .select("subject, body_html")
            .eq("template_key", key)
            .maybeSingle();
          if (error) throw error;
          if (!data) return json({ error: "not found" }, 404);
          html = html ?? data.body_html;
          subject = subject ?? data.subject;
        }
        const sampleOverrides = (body?.sample_data && typeof body.sample_data === "object")
          ? body.sample_data as Record<string, string>
          : {};
        const merged = { ...SAMPLE, ...sampleOverrides };
        return json({
          subject: substitute(subject!, merged),
          body_html: substitute(html!, merged),
        });
      }

      case "test_send": {
        const key = String(body?.template_key ?? "").trim();
        const to = String(body?.to_email ?? "").trim();
        if (!key) return json({ error: "template_key required" }, 400);
        if (!to || !/^.+@.+\..+$/.test(to)) return json({ error: "valid to_email required" }, 400);

        // If unsaved body_html is supplied, write it to a transient template key
        // and call ef_send_email; otherwise call ef_send_email with the saved key.
        // To keep things simple and avoid creating temp DB rows, when unsaved
        // edits are supplied we use the inline render+send fallback below.
        const useInline = !!body?.body_html || !!body?.subject;
        const sampleOverrides = (body?.sample_data && typeof body.sample_data === "object")
          ? body.sample_data as Record<string, string>
          : {};
        const data = { ...SAMPLE, ...sampleOverrides };

        if (!useInline) {
          // Delegate to existing pipeline (uses DB template + smtp.ts)
          const r = await fetch(`${SUPABASE_URL}/functions/v1/ef_send_email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ template_key: key, to_email: to, data }),
          });
          const out = await r.json().catch(() => ({}));
          if (!r.ok) return json({ error: out?.error || `ef_send_email failed (${r.status})` }, 502);
          return json({ ok: true, mode: "saved", message_id: out?.message_id ?? null });
        }

        // Inline mode: render the supplied body_html via SMTP module directly.
        // We can't easily import the shared smtp.ts here, so we take a simpler
        // path: temporarily upsert the template content into a sandbox key,
        // call ef_send_email, then restore.
        const sandboxKey = `__sandbox_test_${Date.now()}`;
        const insRow = {
          template_key: sandboxKey,
          name: "Sandbox Test",
          description: "Transient test row created by ef_admin_email_templates",
          subject: String(body?.subject ?? "Test"),
          body_html: String(body?.body_html ?? ""),
          active: true,
        };
        const { error: insErr } = await admin.from("email_templates").insert(insRow);
        if (insErr) return json({ error: `sandbox insert failed: ${insErr.message}` }, 500);
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/ef_send_email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ template_key: sandboxKey, to_email: to, data }),
          });
          const out = await r.json().catch(() => ({}));
          if (!r.ok) return json({ error: out?.error || `ef_send_email failed (${r.status})` }, 502);
          return json({ ok: true, mode: "inline", message_id: out?.message_id ?? null });
        } finally {
          await admin.from("email_templates").delete().eq("template_key", sandboxKey);
        }
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
