// ef_sth_cb_tracker/index.ts
// ===========================================================================
// Daily STH_CB strategy tracker ("paper trading record").
//
// For every active row in sth_cb.tracker_config, re-run the configuration with
// the shared simulator from its start_date to the latest close and upsert the
// per-day state into sth_cb.tracker_daily. Re-running the whole history every
// day (≈ ms) keeps the record consistent if a configuration is edited.
//
// Triggered: chained from ef_fetch_onchain_pvr after the on-chain data (and the
// sth_cb band source) have been refreshed; also callable manually:
//   POST { org_id?, tracker_key? }
// Deployed with --no-verify-jwt (internal); callers must present the service key.
// ===========================================================================

import { getServiceClient } from "./client.ts";
import { requireOrgAdmin } from "../_shared/adminAuth.ts";
import { simParamsFromBtParams, simulateSthCb, SthCbSeriesRow, toNum } from "../_shared/sth_cb_simulator.ts";

const WARMUP_START = "2011-01-01";
const ORG_FALLBACK = "b0a77009-03b9-44a1-ae1d-34f157d44a8b";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
async function pageAll(query: (from: number, to: number) => any): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  const sb = getServiceClient();
  // Internal (service-role) callers only — same key recognition as the other admin EFs.
  // deno-lint-ignore no-explicit-any
  const caller = await requireOrgAdmin(sb as any, req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  if (!caller.ok || !caller.internal) return json({ error: "service role required" }, 401);

  const body = await req.json().catch(() => ({}));
  const org_id: string = body?.org_id ?? Deno.env.get("ORG_ID") ?? ORG_FALLBACK;
  const onlyKey: string | null = body?.tracker_key ?? null;

  try {
    const { data: configs, error: cfgErr } = await sb.schema("sth_cb").from("tracker_config").select("*").eq("org_id", org_id).eq("is_active", true);
    if (cfgErr) throw new Error(`tracker_config read failed: ${cfgErr.message}`);
    const list = (configs ?? []).filter((c) => !onlyKey || c.tracker_key === onlyKey);
    if (!list.length) return json({ ok: true, trackers: 0, reason: "no active tracker_config rows" });

    // Shared inputs: STH cost basis + price, LTH PVR bands (−0.5σ … +2.5σ)
    const cbRows = await pageAll((from, to) =>
      sb.schema("sth_cb").from("cost_basis_daily").select("close_date, btc_price_usd, sth_cost_basis_usd")
        .eq("org_id", org_id).gte("close_date", WARMUP_START).order("close_date", { ascending: true }).range(from, to));
    const bandRows = await pageAll((from, to) =>
      sb.schema("lth_pvr_bt").from("v_backtest_prices_rb")
        .select("close_date, price_at_m100, price_at_m075, price_at_m050, price_at_m025, price_at_mean, price_at_p050, price_at_p100, price_at_p150, price_at_p200, price_at_p250")
        .eq("org_id", org_id).gte("close_date", WARMUP_START).order("close_date", { ascending: true }).range(from, to));
    const bands = new Map(bandRows.map((b) => [String(b.close_date), {
      m100: toNum(b.price_at_m100, NaN), m075: toNum(b.price_at_m075, NaN), m050: toNum(b.price_at_m050, NaN), m025: toNum(b.price_at_m025, NaN), mean: toNum(b.price_at_mean, NaN),
      p050: toNum(b.price_at_p050, NaN), p100: toNum(b.price_at_p100, NaN), p150: toNum(b.price_at_p150, NaN), p200: toNum(b.price_at_p200, NaN), p250: toNum(b.price_at_p250, NaN),
    }]));
    const series: SthCbSeriesRow[] = cbRows
      .map((r) => ({ close_date: String(r.close_date), px: toNum(r.btc_price_usd, 0), cb: toNum(r.sth_cost_basis_usd, 0), bands: bands.get(String(r.close_date)) }))
      .filter((r) => r.px > 0 && r.cb > 0);
    const lastDate = series.at(-1)?.close_date ?? null;

    const results: Record<string, unknown>[] = [];
    for (const cfg of list) {
      const params = simParamsFromBtParams({
        start_date: cfg.start_date, end_date: lastDate, upfront_contrib_usdt: cfg.upfront_usdt, monthly_contrib_usdt: cfg.monthly_usdt,
        maker_bps_trade: cfg.maker_bps_trade, maker_bps_contrib: cfg.maker_bps_contrib, fee_plan: cfg.fee_plan,
        platform_fee_pct: cfg.platform_fee_pct, management_fee_pct: cfg.management_fee_pct, performance_fee_pct: cfg.performance_fee_pct,
        usdpc_enabled: cfg.usdpc_enabled, usdpc_apy_percent: cfg.usdpc_apy_percent, usdpc_conversion_fee_percent: cfg.usdpc_conversion_fee_percent,
        execution_lag_days: cfg.execution_lag_days, extras: cfg.extras,
      });
      const sim = simulateSthCb(series, params, { ledger: false, benchmarks: true, daily: true });
      const hodl = new Map(sim.hodlBalances.map((h) => [h.trade_date, h.nav_usd]));
      const now = new Date().toISOString();
      const rows = sim.results.map((d) => {
        const b = bands.get(d.trade_date);
        return {
          org_id, tracker_key: cfg.tracker_key, date: d.trade_date,
          price_usd: d.price_usd, sth_cost_basis_usd: d.sth_cost_basis_usd, price_to_cb_ratio: d.price_to_cb_ratio,
          lth_m050: b && Number.isFinite(b.m050) ? b.m050 : null, lth_p250: b && Number.isFinite(b.p250) ? b.p250 : null,
          position_state: d.position_state, signal_in_market: d.signal_in_market,
          signal_rule: d.rule, signal_note: d.note, target_alloc: d.target_alloc,
          action: d.action, rule: d.rule,
          nav_usd: d.nav_usd, hodl_nav_usd: hodl.get(d.trade_date) ?? null,
          btc_balance: d.btc_balance, cash_usd: d.usdt_balance + d.usdpc_balance * (d.usdpc_price_usd ?? 1),
          roc: d.roc, computed_at: now,
        };
      });
      // The signal columns describe the decision taken at this close (filled next day) — recover it from the
      // *next* row's executed rule so the latest row carries a human-readable "tomorrow" instruction.
      for (let i = 0; i < rows.length; i++) {
        const next = sim.results[i + 1];
        if (next && next.action !== "HOLD") { rows[i].signal_rule = next.rule; rows[i].signal_note = next.note; }
        else { rows[i].signal_rule = rows[i].signal_in_market === (rows[i].position_state !== "cash") ? "Hold" : (rows[i].signal_in_market ? "BUY tomorrow" : "SELL tomorrow"); }
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await sb.schema("sth_cb").from("tracker_daily").upsert(rows.slice(i, i + 500), { onConflict: "org_id,tracker_key,date" });
        if (error) throw new Error(`tracker_daily upsert failed: ${error.message}`);
      }
      const last = rows.at(-1)!;
      results.push({ tracker_key: cfg.tracker_key, rows: rows.length, last_date: last.date, position: last.position_state, signal_in_market: last.signal_in_market, nav_usd: last.nav_usd, hodl_nav_usd: last.hodl_nav_usd, trades: sim.summary.sth_cb.trades });
    }
    console.info("ef_sth_cb_tracker:", JSON.stringify(results));
    return json({ ok: true, trackers: results.length, results });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("ef_sth_cb_tracker error:", msg);
    try {
      await sb.schema("public").from("alert_events").insert({ component: "ef_sth_cb_tracker", severity: "error", org_id, message: `STH_CB tracker failed: ${msg}`, context: {} });
    } catch { /* best effort */ }
    return json({ ok: false, error: msg }, 500);
  }
});
