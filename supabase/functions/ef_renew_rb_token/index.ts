// ef_renew_rb_token/index.ts
// ===========================================================
// Runs daily at 00:03 UTC (before ef_fetch_rb_bands at 00:06).
// Checks whether the Research Bitcoin API token stored in
// lth_pvr.rb_api_token is within its renewal window (14 days
// before expiry). If so, calls the RB renewal endpoint with
// the current token, stores the new token + expiry, and logs
// an info alert on success or a critical alert on failure.
//
// RB renewal API:
//   POST https://api.researchbitcoin.net/v2/auth/renew
//   Header: Authorization: Bearer <current_token>
//   Response: JSON { token: "new_token" }
//
// Idempotent and safe to call multiple times per day.
// ===========================================================

import { getServiceClient } from "./client.ts";

const RB_RENEW_URL = "https://api.researchbitcoin.net/v2/auth/renew";
const RENEWAL_WINDOW_DAYS = 14; // start attempting renewal this many days before expiry

// ---------------------------------------------------------------------------
// Alert helper
// ---------------------------------------------------------------------------

async function logAlert(
  sb: ReturnType<typeof getServiceClient>,
  severity: "info" | "warn" | "error" | "critical",
  message: string,
  context: Record<string, unknown> = {},
  orgId?: string | null,
) {
  try {
    const payload: Record<string, unknown> = {
      component: "ef_renew_rb_token",
      severity,
      message,
      context,
    };
    if (orgId) payload.org_id = orgId;
    await sb.schema("lth_pvr").from("alert_events").insert(payload);
  } catch (e) {
    console.error("ef_renew_rb_token: alert_events insert failed", e);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const sb = getServiceClient();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const org_id =
    (typeof body.org_id === "string" && body.org_id) ||
    Deno.env.get("ORG_ID") ||
    null;

  if (!org_id) {
    return new Response("missing org_id", { status: 400 });
  }

  // ---- Load current token from DB ------------------------------------------
  const { data: tokenRow, error: fetchErr } = await sb
    .schema("lth_pvr")
    .from("rb_api_token")
    .select("token, issued_at, expires_at")
    .eq("org_id", org_id)
    .maybeSingle();

  if (fetchErr || !tokenRow) {
    await logAlert(
      sb,
      "critical",
      "rb_api_token row not found — cannot renew Research Bitcoin token",
      { org_id, error: fetchErr?.message },
      org_id,
    );
    return new Response("rb_api_token not found", { status: 500 });
  }

  // ---- Check if renewal is due ----------------------------------------------
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiresAt = new Date(tokenRow.expires_at + "T00:00:00Z");
  const daysUntilExpiry = Math.floor(
    (expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  console.info(
    `ef_renew_rb_token: expires_at=${tokenRow.expires_at}, days_until_expiry=${daysUntilExpiry}`,
  );

  // Allow forcing renewal via payload
  const force = body.force === true;

  if (!force && daysUntilExpiry > RENEWAL_WINDOW_DAYS) {
    return new Response(
      JSON.stringify({
        skipped: true,
        reason: "not_due",
        expires_at: tokenRow.expires_at,
        days_until_expiry: daysUntilExpiry,
        renewal_window_days: RENEWAL_WINDOW_DAYS,
      }),
      { headers: { "content-type": "application/json" } },
    );
  }

  // ---- Call RB renewal API -------------------------------------------------
  console.info("ef_renew_rb_token: calling RB renewal API ...");

  let newToken: string;
  try {
    const resp = await fetch(RB_RENEW_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokenRow.token}`,
        "Content-Type": "application/json",
      },
    });

    const responseText = await resp.text();

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${responseText.slice(0, 300)}`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new Error(`Non-JSON response: ${responseText.slice(0, 200)}`);
    }

    // RB returns { token: "..." }
    if (typeof parsed.token !== "string" || !parsed.token) {
      throw new Error(
        `Unexpected response shape — no 'token' field: ${JSON.stringify(parsed).slice(0, 200)}`,
      );
    }

    newToken = parsed.token;
  } catch (e) {
    const msg = `RB token renewal failed: ${String((e as Error)?.message ?? e)}`;
    console.error(msg);
    await logAlert(
      sb,
      "critical",
      msg,
      {
        org_id,
        expires_at: tokenRow.expires_at,
        days_until_expiry: daysUntilExpiry,
      },
      org_id,
    );
    return new Response(msg, { status: 502 });
  }

  // ---- Compute new expiry (90 days from today) and persist -----------------
  const newIssuedAt = today.toISOString().slice(0, 10);
  const newExpiresAt = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { error: updateErr } = await sb
    .schema("lth_pvr")
    .from("rb_api_token")
    .update({
      token: newToken,
      issued_at: newIssuedAt,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", org_id);

  if (updateErr) {
    const msg = `RB token renewed OK but DB update failed: ${updateErr.message}`;
    console.error(msg);
    await logAlert(
      sb,
      "critical",
      msg,
      { org_id, new_issued_at: newIssuedAt, new_expires_at: newExpiresAt },
      org_id,
    );
    return new Response(msg, { status: 500 });
  }

  // ---- Log success ---------------------------------------------------------
  const successMsg = `Research Bitcoin API token renewed successfully. New expiry: ${newExpiresAt}`;
  console.info(successMsg);
  await logAlert(
    sb,
    "info",
    successMsg,
    {
      org_id,
      old_expires_at: tokenRow.expires_at,
      new_issued_at: newIssuedAt,
      new_expires_at: newExpiresAt,
    },
    org_id,
  );

  return new Response(
    JSON.stringify({
      ok: true,
      issued_at: newIssuedAt,
      expires_at: newExpiresAt,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
