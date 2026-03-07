// Edge Function: ef_revert_withdrawal (EF11)
// Purpose: Cancel a pending withdrawal request. Reverts HWM snapshot and interim fee if any.
//
// May be called:
//   a) By the customer (JWT auth) to self-cancel while status = 'pending'
//   b) Internally without JWT (--no-verify-jwt) for pre-VALR error cleanup
//
// In case (a) the JWT email is validated against the withdrawal's customer_id.
// Status must be 'pending' — once 'processing' has started this endpoint declines.
//
// Deployed with: supabase functions deploy ef_revert_withdrawal  (JWT verification ON)
//   For internal calls, pass the service role key as the Bearer token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendEmail } from "../_shared/smtp.ts";
import { getWithdrawalCancelledEmail } from "../_shared/email-templates.ts";
import { logAlert } from "../_shared/alerting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID       = Deno.env.get("ORG_ID");
const FROM_EMAIL   = Deno.env.get("FROM_EMAIL") ?? "noreply@bitwealth.co.za";

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

// Extract email from JWT payload (Supabase verifies signature at gateway)
function parseJwtEmail(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const pad = parts[1].length % 4 === 0 ? "" : "=".repeat(4 - (parts[1].length % 4));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad));
    return (payload.email ?? null) as string | null;
  } catch {
    return null;
  }
}

// Returns true if the Bearer token is the service role key (internal call)
function isServiceRoleCall(authHeader: string | null): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice(7) === SUPABASE_KEY;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Parse request ──────────────────────────────────────────────────────────
  let body: { request_id?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { request_id, reason } = body;
  if (!request_id) return json({ error: "request_id is required" }, 400);

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const internalCall = isServiceRoleCall(authHeader);
  const callerEmail = internalCall ? null : parseJwtEmail(authHeader);

  // ── Load withdrawal_requests record ───────────────────────────────────────
  const { data: wd, error: wdErr } = await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .select("request_id, customer_id, status, currency, amount_usdt, amount_zar, interim_performance_fee_usdt, org_id")
    .eq("request_id", request_id)
    .eq("org_id", ORG_ID)
    .single();

  if (wdErr || !wd) return json({ error: "Withdrawal request not found" }, 404);

  // ── Guard: only 'pending' can be cancelled ────────────────────────────────
  if (wd.status !== "pending") {
    return json({
      error: `Cannot cancel a withdrawal with status '${wd.status}'. Only 'pending' withdrawals may be cancelled.`,
    }, 409);
  }

  // ── Guard: customer JWT identity check ────────────────────────────────────
  if (!internalCall && callerEmail) {
    const { data: caller } = await sb
      .schema("public")
      .from("customer_details")
      .select("customer_id, email, first_name")
      .eq("email", callerEmail.toLowerCase())
      .eq("org_id", ORG_ID)
      .single();

    if (!caller || caller.customer_id !== wd.customer_id) {
      return json({ error: "Forbidden — this withdrawal belongs to a different customer" }, 403);
    }
  } else if (!internalCall && !callerEmail) {
    return json({ error: "Unauthenticated — valid JWT required" }, 401);
  }

  const customerId: number = wd.customer_id;
  const currency: string = wd.currency ?? "USDT";
  const grossAmount = Number(wd.amount_usdt ?? wd.amount_zar ?? 0);

  // ── Revert HWM snapshot ───────────────────────────────────────────────────
  const { data: snapshot } = await sb
    .schema("lth_pvr")
    .from("withdrawal_fee_snapshots")
    .select("snapshot_id, pre_withdrawal_hwm, interim_performance_fee")
    .eq("withdrawal_request_id", request_id)
    .eq("reverted", false)
    .limit(1)
    .single();

  if (snapshot) {
    const preHwm = Number(snapshot.pre_withdrawal_hwm ?? 0);
    const interimFee = Number(snapshot.interim_performance_fee ?? 0);

    // Only revert if a fee was charged
    if (interimFee > 0 && preHwm > 0) {
      // Restore HWM to pre-withdrawal value
      await sb
        .schema("lth_pvr")
        .from("customer_state_daily")
        .update({ high_water_mark_usd: preHwm })
        .eq("customer_id", customerId)
        .eq("org_id", ORG_ID)
        .order("date", { ascending: false })
        .limit(1);

      // Reverse any interim fee ledger entries linked to this withdrawal
      const today = new Date().toISOString().split("T")[0];
      const { data: feeLines } = await sb
        .schema("lth_pvr")
        .from("ledger_lines")
        .select("ledger_id, amount_usdt, performance_fee_usdt")
        .eq("customer_id", customerId)
        .eq("org_id", ORG_ID)
        .eq("kind", "performance_fee")
        .eq("trade_date", today); // same day interim fee

      if (feeLines && feeLines.length > 0) {
        // Insert offsetting (reversal) ledger lines
        const reversals = feeLines.map((line: any) => ({
          org_id: ORG_ID,
          customer_id: customerId,
          trade_date: today,
          kind: "performance_fee_reversal",
          amount_usdt: Math.abs(Number(line.amount_usdt ?? 0)), // positive offset
          performance_fee_usdt: -Math.abs(Number(line.performance_fee_usdt ?? 0)),
          note: `HWM fee reversal — withdrawal ${request_id} cancelled`,
        }));
        await sb.schema("lth_pvr").from("ledger_lines").insert(reversals);
      }
    }

    // Mark snapshot as reverted
    await sb
      .schema("lth_pvr")
      .from("withdrawal_fee_snapshots")
      .update({
        reverted: true,
        reverted_at: new Date().toISOString(),
        reversion_reason: reason ?? (internalCall ? "internal_error_cleanup" : "customer_cancelled"),
      })
      .eq("snapshot_id", snapshot.snapshot_id);
  }

  // ── Cancel the withdrawal record ──────────────────────────────────────────
  await sb
    .schema("lth_pvr")
    .from("withdrawal_requests")
    .update({
      status: "cancelled",
      rejected_at: new Date().toISOString(),
      notes: reason ?? (internalCall ? "Cancelled by system during processing error" : "Cancelled by customer"),
    })
    .eq("request_id", request_id);

  // ── Send cancellation email to customer ───────────────────────────────────
  try {
    const { data: custRow } = await sb
      .schema("public")
      .from("customer_details")
      .select("email, first_name")
      .eq("customer_id", customerId)
      .single();

    if (custRow?.email) {
      const tmpl = getWithdrawalCancelledEmail(custRow.first_name ?? "Customer", currency, grossAmount);
      await sendEmail({
        to: custRow.email,
        from: FROM_EMAIL,
        subject: "Withdrawal Cancelled — BitWealth",
        html: tmpl.html,
        text: tmpl.text,
      });
    }
  } catch (e) {
    // Non-fatal — just log
    await logAlert(sb, "ef_revert_withdrawal", "warn", `Cancellation email failed: ${(e as Error).message}`, { request_id }, ORG_ID, customerId);
  }

  return json({
    success: true,
    request_id,
    status: "cancelled",
    hwm_reverted: !!snapshot && Number(snapshot.interim_performance_fee ?? 0) > 0,
  });
});
