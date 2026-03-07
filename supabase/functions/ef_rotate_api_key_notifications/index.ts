// Edge Function: ef_rotate_api_key_notifications (EF14)
// Purpose: Daily check for API model customers whose VALR API key is expiring or has expired.
//   - Sends warning emails at 30, 10, 5, and 1 day(s) before expiry (deduped via DB array).
//   - At day 0 (expired): pauses trading, sends critical email, logs alert.
// Schedule: Daily at 08:00 UTC via pg_cron (--no-verify-jwt)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendHTMLEmail } from "../_shared/smtp.ts";
import {
  getApiKeyExpiryWarningEmail,
  getApiKeyExpiryCriticalEmail,
} from "../_shared/email-templates.ts";
import { logAlert } from "../_shared/alerting.ts";

// ── Environment ───────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID       = Deno.env.get("ORG_ID");
const FROM_EMAIL   = Deno.env.get("FROM_EMAIL") ?? "noreply@bitwealth.co.za";
const PORTAL_URL   = Deno.env.get("PORTAL_URL") ?? "https://bitwealth.co.za/customer-portal.html";

const WARNING_THRESHOLDS = [30, 10, 5, 1]; // days before expiry to warn

if (!SUPABASE_URL || !SUPABASE_KEY || !ORG_ID) {
  throw new Error("Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORG_ID");
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const now = new Date();
  const results = { checked: 0, warned: 0, paused: 0, errors: 0 };

  try {
    // ── 1. Fetch all API model customers with an expiry date set ─────────────
    const { data: accounts, error: fetchError } = await sb
      .from("exchange_accounts")
      .select(`
        exchange_account_id,
        api_key_expires_at,
        api_key_label,
        api_key_warning_days_sent,
        customer_details!inner (
          customer_id,
          first_names,
          last_name,
          email,
          account_model
        )
      `)
      .eq("customer_details.account_model", "api")
      .not("api_key_expires_at", "is", null);

    if (fetchError) throw new Error(`Fetch error: ${fetchError.message}`);
    if (!accounts || accounts.length === 0) {
      return json({ success: true, message: "No API model accounts with expiry dates", ...results });
    }

    for (const account of accounts) {
      results.checked++;
      // deno-lint-ignore no-explicit-any
      const cd = account.customer_details as any;
      const customerId: number = cd.customer_id;
      const firstName: string = cd.first_names ?? "Customer";
      const email: string = cd.email;
      const keyLabel: string = account.api_key_label ?? "BitWealth Trade";
      const expiresAt = new Date(account.api_key_expires_at);
      const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);
      const sentThresholds: number[] = account.api_key_warning_days_sent ?? [];

      try {
        if (daysRemaining <= 0) {
          // ── Expired: pause trading + send critical email ──────────────────
          await pauseCustomerTrading(customerId, email);

          const { html, text } = getApiKeyExpiryCriticalEmail(firstName, keyLabel, PORTAL_URL);
          await sendHTMLEmail(email, FROM_EMAIL, "🚨 BitWealth: Trading Paused — API Key Expired", html, text);

          await logAlert(
            sb,
            "ef_rotate_api_key_notifications",
            "critical",
            `API key expired for customer ${customerId} (${email}). Trading paused.`,
            { customer_id: customerId, key_label: keyLabel, expired_at: expiresAt.toISOString() },
            ORG_ID,
            customerId
          );

          results.paused++;

        } else {
          // ── Check warning thresholds not yet sent ─────────────────────────
          const pendingThresholds = WARNING_THRESHOLDS.filter(
            (t) => daysRemaining <= t && !sentThresholds.includes(t)
          );

          if (pendingThresholds.length === 0) continue;

          const { html, text } = getApiKeyExpiryWarningEmail(
            firstName, keyLabel, daysRemaining, expiresAt, PORTAL_URL
          );
          const subject = `⚠️ BitWealth: VALR API Key Expiring in ${daysRemaining} Day${daysRemaining !== 1 ? "s" : ""}`;
          await sendHTMLEmail(email, FROM_EMAIL, subject, html, text);

          // Mark thresholds sent
          const updatedSent = [...sentThresholds, ...pendingThresholds];
          await sb
            .from("exchange_accounts")
            .update({
              api_key_warning_days_sent: updatedSent,
              api_key_last_warning_sent_at: now.toISOString(),
            })
            .eq("exchange_account_id", account.exchange_account_id);

          results.warned++;
        }
      } catch (recordErr) {
        results.errors++;
        console.error(`Error processing customer ${customerId}:`, recordErr);
        await logAlert(
          sb,
          "ef_rotate_api_key_notifications",
          "error",
          `Failed to process API key expiry for customer ${customerId}: ${(recordErr as Error).message}`,
          { customer_id: customerId },
          ORG_ID,
          customerId
        );
      }
    }

    return json({ success: true, ...results });

  } catch (err) {
    console.error("EF14 fatal error:", err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});

// ── Helper: disable live_enabled for all strategies of this customer ──────────
async function pauseCustomerTrading(customerId: number, email: string): Promise<void> {
  const { error } = await sb
    .from("customer_strategies")
    .update({ live_enabled: false })
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(`Failed to pause trading for customer ${customerId}: ${error.message}`);
  }
  console.log(`Trading paused for customer ${customerId} (${email}) — API key expired.`);
}
