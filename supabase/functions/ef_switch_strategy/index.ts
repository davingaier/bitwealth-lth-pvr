import { getServiceKey } from "../_shared/supabaseKeys.ts";
// ef_switch_strategy/index.ts
// ===========================================================================
// Admin action: switch an existing client to another strategy (in place) and notify client + admin.
//
//   POST { customer_id, to_strategy_code: 'STH_CB'|'LTH_PVR', options?: { join_policy, config_key, usdpc_enabled,
//          strategy_variation_id }, reason?, send_client_email?: boolean (default true) }
//
// 1. Caller must be an org admin (Supabase session) or an internal service-role call.
// 2. public.switch_customer_strategy(...) is executed with the service role (same row, same VALR account, audit row
//    in public.customer_strategy_history) — see migration 20261104_sth_cb_schema_separation.sql.
// 3. Emails: `strategy_switch_confirmation` to the client (state-dependent "what happens next" copy from the
//    strategy's current tracker state) and `strategy_switch_admin_notification` to ADMIN_EMAIL.
// Deployed with --no-verify-jwt (auth handled by requireOrgAdmin). CORS enabled for the Admin UI.
// ===========================================================================

import { getServiceClient } from "./client.ts";
import { requireOrgAdmin } from "../_shared/adminAuth.ts";
import { sendTemplateEmail } from "../_shared/sendTemplateEmail.ts";
import { logAlert } from "../_shared/alerting.ts";
import { LTH_PVR_SUMMARY, STH_CB_SUMMARY, STRATEGY_NAMES, sthCbSignalState, sthCbStateCopy } from "../_shared/strategyEmail.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS });
const WEBSITE_URL = Deno.env.get("WEBSITE_URL") ?? "https://bitwealth.co.za";
const ADMIN_PORTAL_URL = Deno.env.get("ADMIN_PORTAL_URL") ?? `${WEBSITE_URL}/admin`;
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "";
const fmtUsd = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBtc = (n: unknown) => Number(n ?? 0).toFixed(8);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = getServiceClient();
  // deno-lint-ignore no-explicit-any
  const caller = await requireOrgAdmin(sb as any, req, getServiceKey() ?? "");
  if (!caller.ok) return json({ error: caller.error }, caller.status);

  const body = await req.json().catch(() => ({}));
  const customerId = Number(body?.customer_id);
  const toCode = String(body?.to_strategy_code ?? "").toUpperCase();
  const options = (body?.options && typeof body.options === "object") ? body.options : {};
  const reason: string | null = body?.reason ? String(body.reason) : null;
  const sendClientEmail = body?.send_client_email !== false;
  if (!Number.isFinite(customerId) || !toCode) return json({ error: "customer_id and to_strategy_code are required" }, 400);

  const changedBy = caller.email ?? (caller.internal ? "service" : "admin");

  // 1) Switch (service-role path of the RPC)
  const { data: res, error } = await sb.schema("public").rpc("switch_customer_strategy", {
    p_customer_id: customerId, p_to_strategy_code: toCode, p_options: options,
    p_reason: reason ? `${reason} (by ${changedBy})` : `by ${changedBy}`,
  });
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!res?.ok) return json({ ok: false, error: res?.error ?? "switch failed" }, 400);

  // 2) Context for the emails
  const { data: cust } = await sb.schema("public").from("customer_details")
    .select("first_names, last_name, email, org_id").eq("customer_id", customerId).maybeSingle();
  const orgId = cust?.org_id ?? Deno.env.get("ORG_ID") ?? "b0a77009-03b9-44a1-ae1d-34f157d44a8b";
  const switchDate = new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });
  const holdings = res.holdings ?? {};
  const cashUsd = Number(holdings.usdt ?? 0) + Number(holdings.usdpc ?? 0) * Number(holdings.usdpc_price_usd ?? 1.2);
  const fromName = STRATEGY_NAMES[res.from] ?? res.from;
  const toName = STRATEGY_NAMES[res.to] ?? res.to;

  let nextHeadline: string, nextDetail: string, joinPolicyText: string, summary: string;
  if (toCode === "STH_CB") {
    const sig = await sthCbSignalState(sb, orgId, res.config_key ?? "hybrid_v2_2").catch(() => ({ date: null, inMarket: false, targetAlloc: 0, rule: "Hold" }));
    const copy = sthCbStateCopy(sig, res.join_policy === "next_signal" ? "next_signal" : "immediate", "switch", Number(holdings.btc ?? 0) > 0);
    nextHeadline = copy.headline; nextDetail = copy.detail; summary = STH_CB_SUMMARY;
    joinPolicyText = res.join_policy === "next_signal"
      ? "Joining rule: wait for the strategy's next entry signal before your first purchase"
      : "Joining rule: adopt the strategy's current position immediately";
  } else {
    nextHeadline = "Daily LTH PVR decisions resume tomorrow";
    nextDetail = "Your current holdings are kept as they are; from the next 00:10 UTC run the strategy sizes its measured daily buys and sells from your balances.";
    summary = LTH_PVR_SUMMARY; joinPolicyText = "Your holdings carry over unchanged";
  }
  const usdpcText = res.usdpc_enabled ? " Idle cash continues to be swept into yield-bearing USDPC." : "";

  // 3) Client email
  let clientEmailStatus = "not sent";
  if (sendClientEmail && cust?.email) {
    const r = await sendTemplateEmail({
      template_key: "strategy_switch_confirmation",
      to_email: cust.email,
      data: {
        first_name: cust.first_names ?? "", from_strategy_name: fromName, to_strategy_name: toName, switch_date: switchDate,
        join_policy_text: joinPolicyText, holdings_btc: fmtBtc(holdings.btc), holdings_cash_usd: fmtUsd(cashUsd), nav_usd: fmtUsd(holdings.nav_usd),
        next_headline: nextHeadline, next_detail: nextDetail, strategy_summary: summary, usdpc_text: usdpcText,
        portal_url: `${WEBSITE_URL}/customer-portal.html`, website_url: WEBSITE_URL,
      },
    });
    clientEmailStatus = r.ok ? `sent to ${cust.email}` : `FAILED (${r.status}: ${String(r.error ?? "").slice(0, 120)})`;
    if (!r.ok) await logAlert(sb, "ef_switch_strategy", "error", `Strategy switch client email failed for customer ${customerId}`, { status: r.status, error: r.error }, orgId, customerId);
  } else if (sendClientEmail) {
    clientEmailStatus = "no email address on file";
  }

  // 4) Admin email (best effort)
  let adminEmailStatus = "skipped";
  if (ADMIN_EMAIL) {
    const optionsText = toCode === "STH_CB"
      ? `join_policy=${res.join_policy} · config_key=${res.config_key} · usdpc=${res.usdpc_enabled ? "on" : "off"}`
      : `variation=${options.strategy_variation_id ?? "production default"} · usdpc=${res.usdpc_enabled ? "on" : "off"}`;
    const r = await sendTemplateEmail({
      template_key: "strategy_switch_admin_notification",
      to_email: ADMIN_EMAIL,
      data: {
        first_name: cust?.first_names ?? "", last_name: cust?.last_name ?? "", customer_id: customerId, email: cust?.email ?? "",
        from_strategy_code: res.from, to_strategy_code: res.to, options_text: optionsText,
        holdings_btc: fmtBtc(holdings.btc), holdings_cash_usd: fmtUsd(cashUsd), nav_usd: fmtUsd(holdings.nav_usd),
        changed_by: changedBy, switch_date: switchDate, reason: reason ?? "—", client_email_status: clientEmailStatus,
        next_detail: nextDetail, admin_portal_url: ADMIN_PORTAL_URL,
      },
    });
    adminEmailStatus = r.ok ? "sent" : `failed (${r.status})`;
  }

  return json({ ...res, client_email: clientEmailStatus, admin_email: adminEmailStatus, next_headline: nextHeadline, next_detail: nextDetail });
});
