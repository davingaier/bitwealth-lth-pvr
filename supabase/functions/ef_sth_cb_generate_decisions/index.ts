import { getServiceKey } from "../_shared/supabaseKeys.ts";
// ef_sth_cb_generate_decisions/index.ts
// ===========================================================================
// STH Cost Basis Strategy — LIVE decision generator.
//
// Chained from ef_sth_cb_tracker (≈02:05 UTC, after the on-chain data and the tracker have been refreshed) and
// callable from ef_resume_pipeline { strategy: 'sth_cb' } or the Admin UI pipeline panel.
//
//   1. Read the strategy state for signal_date = trade_date − 1 from sth_cb.tracker_daily (one row per config_key).
//   2. For every live STH_CB customer (customer_strategies.live_enabled, status active, customer active) translate
//      the org-level state into a per-customer BUY / SELL / HOLD via _shared/sth_cb_live.ts (pure, unit-tested).
//   3. Upsert sth_cb.decisions_daily (UNIQUE (org, customer, trade_date); HOLD rows included).
//      ef_create_order_intents reads this table alongside lth_pvr.decisions_daily and sizes orders into the shared
//      lth_pvr.order_intents table.
//   4. Unless dry_run, chain ef_create_order_intents { customer_ids } → ef_execute_orders → ef_poll_orders. Ledger
//      posting is handled by the existing half-hourly cron (and ef_resume_pipeline { strategy:'sth_cb' }).
//
// Body: { trade_date?: 'YYYY-MM-DD', dry_run?: boolean, customer_ids?: number[], chain?: boolean (default true) }
// Deployed with --no-verify-jwt; service-role callers only (requireOrgAdmin internal check).
// ===========================================================================

import { getServiceClient } from "./client.ts";
import { requireOrgAdmin } from "../_shared/adminAuth.ts";
import { logAlert } from "../_shared/alerting.ts";
import { LiveCustomer, LiveSignal, planCustomerDecision } from "../_shared/sth_cb_live.ts";
import { sendTemplateEmail } from "../_shared/sendTemplateEmail.ts";
import { sthCbActionCopy, sthCbReason } from "../_shared/strategyEmail.ts";

const ORG_FALLBACK = "b0a77009-03b9-44a1-ae1d-34f157d44a8b";
const DEFAULT_CONFIG_KEY = "hybrid_v2_2";
const COMPONENT = "ef_sth_cb_generate_decisions";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(iso: string, n: number): string { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); }
const num = (v: unknown, dflt = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };

Deno.serve(async (req) => {
  const sb = getServiceClient();
  // deno-lint-ignore no-explicit-any
  const caller = await requireOrgAdmin(sb as any, req, getServiceKey() ?? "");
  if (!caller.ok || !caller.internal) return json({ error: "service role required" }, 401);

  const body = await req.json().catch(() => ({}));
  const org_id: string = body?.org_id ?? Deno.env.get("ORG_ID") ?? ORG_FALLBACK;
  const tradeDate: string = typeof body?.trade_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.trade_date) ? body.trade_date : isoDate(new Date());
  const signalDate = addDays(tradeDate, -1);
  const dryRun = body?.dry_run === true;
  // notify_only: send the position-change email for today's BUY/SELL decisions that were never notified (e.g. the
  // order was rejected at 01:00 and re-driven manually later). No planning, writing or chaining.
  const notifyOnly = body?.notify_only === true;
  const chain = body?.chain !== false && !dryRun && !notifyOnly;
  const onlyCustomers: Set<number> | null = Array.isArray(body?.customer_ids) ? new Set(body.customer_ids.map(Number)) : null;

  try {
    // ── Live STH_CB customers ─────────────────────────────────────────────
    const { data: csRows, error: csErr } = await sb.schema("public").from("customer_strategies")
      .select("customer_id, config_key, join_policy, min_order_usdt, usdpc_enabled, strategy_version_id, customer_details!inner(registration_status)")
      .eq("org_id", org_id).eq("strategy_code", "STH_CB").eq("live_enabled", true).eq("status", "active")
      .eq("customer_details.registration_status", "active");
    if (csErr) throw new Error(`customer_strategies read failed: ${csErr.message}`);
    const customers = (csRows ?? []).filter((r) => !onlyCustomers || onlyCustomers.has(Number(r.customer_id)));
    if (!customers.length) return json({ ok: true, trade_date: tradeDate, customers: 0, reason: "no live STH_CB customers" });

    // ── Strategy state per config_key for signal_date (+ previous day for allocation-increase detection) ───
    const keys = [...new Set(customers.map((c) => String(c.config_key ?? DEFAULT_CONFIG_KEY)))];
    const { data: trk, error: trkErr } = await sb.schema("sth_cb").from("tracker_daily")
      .select("tracker_key, date, price_usd, signal_in_market, signal_target_alloc, target_alloc, signal_rule, signal_note, position_state")
      .eq("org_id", org_id).in("tracker_key", keys).in("date", [signalDate, addDays(signalDate, -1)]);
    if (trkErr) throw new Error(`tracker_daily read failed: ${trkErr.message}`);
    const signals = new Map<string, LiveSignal>();
    for (const key of keys) {
      const today = (trk ?? []).find((r) => r.tracker_key === key && String(r.date) === signalDate);
      const prev = (trk ?? []).find((r) => r.tracker_key === key && String(r.date) === addDays(signalDate, -1));
      if (!today) {
        // Stale tracker: the on-chain fetch / tracker rebuild has not produced yesterday's close yet. Do not guess.
        await logAlert(sb, COMPONENT, "error", `STH_CB tracker '${key}' has no row for ${signalDate} — decisions skipped`, { trade_date: tradeDate, signal_date: signalDate, config_key: key }, org_id);
        continue;
      }
      const tAlloc = today.signal_target_alloc == null ? (today.signal_in_market ? 1 : 0) : num(today.signal_target_alloc);
      const pAlloc = prev ? (prev.signal_target_alloc == null ? (prev.signal_in_market ? 1 : 0) : num(prev.signal_target_alloc)) : tAlloc;
      signals.set(key, { inMarket: !!today.signal_in_market, targetAlloc: tAlloc, prevTargetAlloc: pAlloc, rule: String(today.signal_rule ?? "Hold"), note: String(today.signal_note ?? ""), priceUsd: num(today.price_usd) });
    }

    // ── USDPC price (for cash valuation) ─────────────────────────────────
    let usdpcPrice = 1;
    try {
      const { data: px } = await sb.schema("lth_pvr").from("usdpc_prices_daily").select("price_usd").order("date", { ascending: false }).limit(1);
      usdpcPrice = num(px?.[0]?.price_usd, 1) || 1;
    } catch { /* default 1 */ }

    const decisions: Record<string, unknown>[] = [];
    const planned: Record<string, unknown>[] = [];
    const actionable: number[] = [];
    for (const c of customers) {
      if (notifyOnly) break;
      const cid = Number(c.customer_id);
      const key = String(c.config_key ?? DEFAULT_CONFIG_KEY);
      const sig = signals.get(key);
      if (!sig) { planned.push({ customer_id: cid, skipped: `no tracker state for ${key}` }); continue; }

      const { data: balRows, error: balErr } = await sb.schema("lth_pvr").from("balances_daily")
        .select("date, btc_balance, usdt_balance, usdpc_balance, usdpc_price_usd")
        .eq("org_id", org_id).eq("customer_id", cid).lte("date", tradeDate).order("date", { ascending: false }).limit(1);
      if (balErr) { await logAlert(sb, COMPONENT, "error", `balances_daily read failed for customer ${cid}`, { error: balErr.message }, org_id, cid); continue; }
      const bal = balRows?.[0];

      const { data: lastBuy } = await sb.schema("lth_pvr").from("ledger_lines")
        .select("amount_btc, amount_usdt, trade_date").eq("org_id", org_id).eq("customer_id", cid).eq("kind", "buy").gt("amount_btc", 0)
        .order("trade_date", { ascending: false }).order("created_at", { ascending: false }).limit(1);
      const lb = lastBuy?.[0];
      const lastBuyPx = lb && num(lb.amount_btc) > 0 ? Math.abs(num(lb.amount_usdt)) / num(lb.amount_btc) : null;

      const cust: LiveCustomer = {
        customerId: cid,
        btcBalance: num(bal?.btc_balance),
        usdtBalance: num(bal?.usdt_balance),
        usdpcValueUsd: c.usdpc_enabled ? num(bal?.usdpc_balance) * (num(bal?.usdpc_price_usd, 0) || usdpcPrice) : 0,
        lastBuyPx,
        joinPolicy: c.join_policy === "next_signal" ? "next_signal" : "immediate",
        minOrderUsdt: Math.max(1, num(c.min_order_usdt, 10)),
      };
      const d = planCustomerDecision(sig, cust);
      planned.push({ ...d, last_buy_px: lastBuyPx, balance_date: bal?.date ?? null, btc: cust.btcBalance, cash_usd: +(cust.usdtBalance + cust.usdpcValueUsd).toFixed(2) });
      if (d.action !== "HOLD") actionable.push(cid);
      decisions.push({
        org_id, customer_id: cid, config_key: key, signal_date: signalDate, trade_date: tradeDate,
        price_usd: sig.priceUsd, signal_in_market: sig.inMarket, signal_target_alloc: sig.targetAlloc,
        current_alloc: d.currentAlloc, target_alloc: d.targetAlloc,
        action: d.action, amount_pct: d.amountPct, rule: d.rule, note: d.note,
        join_policy: cust.joinPolicy, last_buy_px: lastBuyPx, btc_balance: cust.btcBalance,
        cash_usd: +(cust.usdtBalance + cust.usdpcValueUsd).toFixed(2),
      });
    }

    let written = 0;
    // Prior decisions: today's row (so a re-run cannot re-notify) and the most recent earlier BUY/SELL per customer
    // (so a daily re-plan of an order that never executed is recognised as a retry, not news for the client).
    const priorToday = new Map<number, Record<string, unknown>>();
    const priorEarlier = new Map<number, Record<string, unknown>>();
    {
      const ids = customers.map((c) => Number(c.customer_id));
      const { data: prev } = await sb.schema("sth_cb").from("decisions_daily")
        .select("customer_id, trade_date, action, rule, target_alloc, current_alloc, notified_at")
        .eq("org_id", org_id).in("customer_id", ids).lte("trade_date", tradeDate).gte("trade_date", addDays(tradeDate, -14))
        .order("trade_date", { ascending: false });
      for (const r of prev ?? []) {
        const cid = Number(r.customer_id);
        if (String(r.trade_date) === tradeDate) priorToday.set(cid, r);
        else if (!priorEarlier.has(cid) && r.action !== "HOLD") priorEarlier.set(cid, r);
      }
    }
    if (notifyOnly) {
      const { data: rows } = await sb.schema("sth_cb").from("decisions_daily")
        .select("customer_id, action, rule, amount_pct, current_alloc, target_alloc, notified_at")
        .eq("org_id", org_id).eq("trade_date", tradeDate).in("customer_id", customers.map((c) => Number(c.customer_id)))
        .neq("action", "HOLD").is("notified_at", null);
      for (const r of rows ?? []) {
        const cid = Number(r.customer_id);
        planned.push({ customerId: cid, action: r.action, rule: r.rule, amountPct: num(r.amount_pct), currentAlloc: num(r.current_alloc), targetAlloc: num(r.target_alloc) });
        actionable.push(cid);
      }
    }
    if (!dryRun && decisions.length) {
      // keep an existing notification stamp across re-runs of the same trade_date
      for (const d of decisions) {
        const t = priorToday.get(Number(d.customer_id));
        if (t?.notified_at) d.notified_at = t.notified_at;
      }
      const { error: upErr } = await sb.schema("sth_cb").from("decisions_daily").upsert(decisions, { onConflict: "org_id,customer_id,trade_date" });
      if (upErr) throw new Error(`sth_cb.decisions_daily upsert failed: ${upErr.message}`);
      written = decisions.length;
    }

    // ── Chain order intents → execute → poll for the customers with a BUY/SELL ───
    const chained: Record<string, unknown>[] = [];
    if (chain && actionable.length) {
      const baseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
      const key = getServiceKey();
      const steps: [string, Record<string, unknown>][] = [
        ["ef_create_order_intents", { customer_ids: actionable, trade_date: tradeDate }],
        ["ef_execute_orders", {}],
        ["ef_poll_orders", {}],
      ];
      for (const [name, payload] of steps) {
        try {
          const r = await fetch(`${baseUrl}/functions/v1/${name}`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify(payload) });
          const text = (await r.text()).slice(0, 200);
          chained.push({ step: name, status: r.status, ok: r.ok, response: text });
          if (!r.ok) { await logAlert(sb, COMPONENT, "error", `Chained ${name} failed (HTTP ${r.status})`, { trade_date: tradeDate, response: text }, org_id); break; }
        } catch (e) {
          const msg = String((e as Error)?.message ?? e);
          chained.push({ step: name, ok: false, error: msg });
          await logAlert(sb, COMPONENT, "error", `Chained ${name} threw: ${msg}`, { trade_date: tradeDate }, org_id);
          break;
        }
      }
    }

    const summary = { ok: true, trade_date: tradeDate, signal_date: signalDate, dry_run: dryRun, customers: customers.length, decisions_written: written, buys: planned.filter((p) => p.action === "BUY").length, sells: planned.filter((p) => p.action === "SELL").length, holds: planned.filter((p) => p.action === "HOLD").length, signals: Object.fromEntries(signals), planned, chained, emails: [] as string[] };

    // ── Client notifications: ONE "position change" email per customer per trade_date, and only when the decision is
    //    genuinely new for the client. Suppressed (ops alert instead) when: it was already sent for this trade_date
    //    (re-run), it repeats the last notified BUY/SELL with the customer's allocation unchanged (= an order that never
    //    executed is being retried), or the order ended in `error`. 2026-11-06: customers 49/999 had received the same
    //    "Moved into Bitcoin — order status: error" email 7× in two days before these rules existed.
    if (!dryRun && actionable.length && body?.notify !== false) {
      const WEBSITE_URL = Deno.env.get("WEBSITE_URL") ?? "https://bitwealth.co.za";
      const intentsOk = chained.length === 0 || chained[0]?.ok === true;
      const near = (a: unknown, b: unknown) => Math.abs(num(a) - num(b)) < 0.005;
      const markDecision = async (cid: number, patch: Record<string, unknown>) => {
        await sb.schema("sth_cb").from("decisions_daily").update(patch).eq("org_id", org_id).eq("customer_id", cid).eq("trade_date", tradeDate);
      };
      for (const cid of actionable) {
        try {
          const p = planned.find((x) => x.customerId === cid) as Record<string, unknown> | undefined;
          if (!p || !intentsOk) continue;
          const today = priorToday.get(cid);
          if (today?.notified_at) { summary.emails.push(`#${cid}: already notified`); await markDecision(cid, { notify_skipped: "already_notified" }); continue; }
          const { data: cust } = await sb.schema("public").from("customer_details").select("first_names, email").eq("customer_id", cid).maybeSingle();
          if (!cust?.email) { await markDecision(cid, { notify_skipped: "no_email" }); continue; }
          const { data: ord } = await sb.schema("lth_pvr").from("exchange_orders")
            .select("status, price, qty, pair, order_intents!inner(customer_id, trade_date, pair)")
            .eq("order_intents.customer_id", cid).eq("order_intents.trade_date", tradeDate).neq("pair", "USDPC/USDT")
            .order("submitted_at", { ascending: false }).limit(1);
          const o = ord?.[0];
          let st = String(o?.status ?? "").toLowerCase();
          if (!st) {
            // no exchange order row (e.g. the USDPC conversion or the intent itself failed) — read the intent status
            const { data: it } = await sb.schema("lth_pvr").from("order_intents").select("status, reason")
              .eq("org_id", org_id).eq("customer_id", cid).eq("trade_date", tradeDate).order("created_at", { ascending: false }).limit(1);
            if (String(it?.[0]?.status ?? "").toLowerCase() === "error") st = "error";
          }
          if (st === "error" || st === "cancelled" || st === "rejected") {
            summary.emails.push(`#${cid}: order ${st} — client not emailed`);
            await markDecision(cid, { notify_skipped: "order_error" });
            await logAlert(sb, COMPONENT, "error", `Customer ${cid}: ${p.action} order ${st} — position change NOT executed; client not emailed`, { trade_date: tradeDate, rule: p.rule, target_alloc: p.targetAlloc }, org_id, cid);
            continue;
          }
          // A repeat of the last notified decision whose order still has not executed is a retry, not news for the client.
          const last = priorEarlier.get(cid);
          const isRetry = !!last && last.action === p.action && String(last.rule ?? "") === String(p.rule ?? "")
            && near(last.target_alloc, p.targetAlloc) && near(last.current_alloc, p.currentAlloc) && !!last.notified_at;
          if (isRetry && st !== "filled" && st !== "submitted") {
            summary.emails.push(`#${cid}: retry — not re-notified`);
            await markDecision(cid, { notify_skipped: "retry" });
            await logAlert(sb, COMPONENT, "warn", `Customer ${cid}: ${p.action} (${p.rule}) re-planned — the ${last!.trade_date} order never executed; client not re-emailed`, { trade_date: tradeDate, previous_trade_date: last!.trade_date, order_status: st || null, target_alloc: p.targetAlloc, current_alloc: p.currentAlloc }, org_id, cid);
            continue;
          }
          const orderStatusText = st === "filled" ? `Filled on VALR at about $${Number(o?.price ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} per BTC`
            : st === "submitted" ? "Your order is being executed on VALR and normally fills within minutes"
            : st ? `Order status: ${st} — our team is monitoring it` : "Your order is being placed on VALR";
          const copy = sthCbActionCopy(p.action as "BUY" | "SELL", Number(p.amountPct), Number(p.currentAlloc), Number(p.targetAlloc));
          const r = await sendTemplateEmail({
            template_key: "sth_cb_position_change",
            to_email: cust.email,
            data: {
              first_name: cust.first_names ?? "", trade_date: tradeDate, action_headline: copy.headline, action_detail: copy.detail,
              order_status_text: orderStatusText, reason_text: sthCbReason(String(p.rule ?? "")), implication_text: copy.implication,
              portal_url: `${WEBSITE_URL}/customer-portal.html`, website_url: WEBSITE_URL,
            },
          });
          summary.emails.push(`#${cid}: ${r.ok ? "sent" : `failed ${r.status}`}`);
          if (r.ok) await markDecision(cid, { notified_at: new Date().toISOString(), notify_skipped: null });
          if (!r.ok) await logAlert(sb, COMPONENT, "warn", `Position-change email failed for customer ${cid}`, { status: r.status, error: r.error }, org_id, cid);
        } catch (e) {
          summary.emails.push(`#${cid}: error ${String((e as Error)?.message ?? e)}`);
        }
      }
    }
    console.info(`${COMPONENT}:`, JSON.stringify({ ...summary, planned: undefined }));
    return json(summary);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error(`${COMPONENT} error:`, msg);
    await logAlert(sb, COMPONENT, "critical", `STH_CB decision generation failed: ${msg}`, { trade_date: tradeDate }, org_id).catch(() => {});
    return json({ ok: false, error: msg }, 500);
  }
});
