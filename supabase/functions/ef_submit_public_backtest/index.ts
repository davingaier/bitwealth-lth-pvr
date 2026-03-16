/**
 * ef_submit_public_backtest
 *
 * Replaces the blocking reCAPTCHA-in-SQL approach that exhausted the Postgres
 * connection pool and caused 504 Gateway Timeouts across all Admin UI requests.
 *
 * Flow:
 *   1. Verify reCAPTCHA token with Google (Deno fetch — no DB connection held)
 *   2. Call public.create_public_backtest_run() to create DB records
 *   3. Fire-and-forget ef_bt_execute to run the back-test asynchronously
 *   4. Return request_id to the website for polling
 *
 * Deploy with --no-verify-jwt (called from public website, no auth token).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const recaptchaSecret = Deno.env.get("RECAPTCHA_SECRET_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return json({ success: false, error: "Invalid JSON body" }, 400);
    }

    const {
      p_email,
      p_captcha_token,
      p_start_date,
      p_end_date,
      p_upfront_usdt,
      p_monthly_usdt,
    } = body;

    // ── 1. Validate required fields ─────────────────────────────────────────
    if (!p_email || !p_captcha_token || !p_start_date || !p_end_date) {
      return json({ success: false, error: "Missing required fields" }, 400);
    }

    // ── 2. Verify reCAPTCHA with Google (Deno fetch — fast, no DB connection) ──
    let captchaValid = true; // default to true so reCAPTCHA misconfiguration doesn't block users
    if (recaptchaSecret) {
      try {
        const captchaRes = await fetch(
          "https://www.google.com/recaptcha/api/siteverify",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `secret=${encodeURIComponent(recaptchaSecret)}&response=${encodeURIComponent(p_captcha_token)}`,
          }
        );
        const captchaData = await captchaRes.json();
        captchaValid = captchaData.success === true;
      } catch (err) {
        console.error("reCAPTCHA verification error (allowing through):", err);
        captchaValid = true; // don't block users if Google API is down
      }
    } else {
      console.warn("RECAPTCHA_SECRET_KEY not set — skipping verification");
    }

    if (!captchaValid) {
      return json({ success: false, error: "CAPTCHA verification failed. Please try again." }, 400);
    }

    // ── 3. Create DB records (pure SQL — no http() calls inside) ────────────
    const { data: result, error: rpcError } = await supabase.rpc(
      "create_public_backtest_run",
      {
        p_email:         p_email.toLowerCase().trim(),
        p_start_date,
        p_end_date,
        p_upfront_usdt:  Number(p_upfront_usdt) || 0,
        p_monthly_usdt:  Number(p_monthly_usdt) || 0,
      }
    );

    if (rpcError) {
      console.error("create_public_backtest_run error:", rpcError);
      return json({ success: false, error: rpcError.message }, 500);
    }

    if (!result?.success) {
      return json(result, 400);
    }

    // ── 4. Fire-and-forget: trigger ef_bt_execute asynchronously ────────────
    //    We do NOT await this; the website polls get_backtest_results separately.
    fetch(`${supabaseUrl}/functions/v1/ef_bt_execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ bt_run_id: result.bt_run_id }),
    }).catch((err) => {
      console.error("Failed to trigger ef_bt_execute:", err);
    });

    // ── 5. Return request_id to website for polling ──────────────────────────
    return json(result, 200);

  } catch (err) {
    console.error("Unexpected error in ef_submit_public_backtest:", err);
    return json({ success: false, error: "Internal server error" }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
