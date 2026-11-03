/**
 * ef_refresh_marketing_charts
 *
 * Recomputes the product-page performance charts and caches each result in
 * public.marketing_chart_data (one row per chart_key):
 *
 *   lth_pvr_5yr  → website/lth-pvr.html   (LTH PVR Progressive, lth_pvr_bt.*, ef_bt_execute)
 *   sth_cb_5yr   → website/sth-cb.html    (STH Cost Basis Hybrid v2.2, sth_cb_bt.*, ef_sth_cb_bt_execute)
 *
 * Flow per chart (single synchronous pass — a 5-year run completes well within
 * the function time budget):
 *   1. window = trailing 5 years ending YESTERDAY (UTC).
 *   2. the strategy's public creator RPC (marketing email, window, $2,400 upfront +
 *      $200/month, USDPC on @10% APY / 0.1% sweep fee) → { request_id, bt_run_id }.
 *   3. await the strategy's executor → strategy + Std DCA + HODL daily series.
 *   4. the strategy's results RPC → daily series + summaries.
 *   5. weekly-sample the series, compute max-drawdown + narrative figures,
 *      upsert the payload; then delete the PREVIOUS marketing run's bulky daily
 *      rows so the back-test schemas do not grow unbounded.
 *
 * Params match the one-pager / fact sheets: $2,400 upfront + $200/month; Std DCA &
 * HODL = exchange fees only; HODL = lump-sum day 1. Fee stacks:
 *   LTH PVR  = VALR 8bps trade + 18bps conversion + 0.75% platform + 10% performance (HWM)
 *   STH CB   = VALR 8bps trade + 18bps conversion + 1% p.a. management + 10% performance (HWM)
 *
 * Body: {} refreshes every chart; { chart_key: 'sth_cb_5yr' } refreshes one.
 * Triggered monthly by the 'lth_pvr_refresh_marketing_5yr' pg_cron job and
 * on-demand via POST. Deploy with --no-verify-jwt (cron / service-to-service).
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const COMMON_PARAMS = {
  upfront_usdt: 2400,
  monthly_usdt: 200,
  usdpc_enabled: true,
  usdpc_apy_percent: 10,
  usdpc_conversion_fee_percent: 0.1,
  exchange: "VALR (BTC/USDT)",
};

interface ChartDef {
  chartKey: string;
  email: string;
  createRpc: string;
  execFn: string;
  resultsRpc: string;
  btSchema: string;
  /** Bulky per-day tables written by the executor (cleared for the previous run). */
  dataTables: string[];
  /** Keys of the strategy's own series / summary inside the results RPC payload. */
  summaryKey: string;
  navKey: string;
  roiKey: string;
  /** Name of the strategy series in the cached payload (what the web page reads). */
  seriesName: string;
  params: Record<string, unknown>;
}

const CHARTS: ChartDef[] = [
  {
    chartKey: "lth_pvr_5yr",
    email: "marketing.lthpvr@bitwealth.co.za",
    createRpc: "create_public_backtest_run",
    execFn: "ef_bt_execute",
    resultsRpc: "get_backtest_results",
    btSchema: "lth_pvr_bt",
    dataTables: ["bt_ledger", "bt_orders", "bt_results_daily", "bt_std_dca_ledger", "bt_std_dca_balances", "bt_hodl_ledger", "bt_hodl_balances"],
    summaryKey: "lth_pvr_summary",
    navKey: "lth_pvr_nav",
    roiKey: "lth_pvr_roi",
    seriesName: "lthPvr",
    params: { ...COMMON_PARAMS, band_source: "rb", performance_fee_percent: 10, platform_fee_percent: 0.75 },
  },
  {
    chartKey: "sth_cb_5yr",
    email: "marketing.sthcb@bitwealth.co.za",
    createRpc: "create_public_sth_cb_backtest_run",
    execFn: "ef_sth_cb_bt_execute",
    resultsRpc: "get_sth_cb_backtest_results",
    btSchema: "sth_cb_bt",
    dataTables: ["bt_ledger", "bt_results_daily", "bt_std_dca_ledger", "bt_std_dca_balances", "bt_hodl_ledger", "bt_hodl_balances"],
    summaryKey: "strategy_summary",
    navKey: "strategy_nav",
    roiKey: "strategy_roi",
    seriesName: "strategy",
    params: { ...COMMON_PARAMS, strategy: "STH Cost Basis Hybrid v2.2", performance_fee_percent: 10, management_fee_percent: 1 },
  },
];

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Sample every 7th point and always keep the last one. */
function weeklySample<T>(arr: T[]): T[] {
  if (arr.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += 7) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

/** Max peak-to-trough drawdown of a NAV series, as a positive percent. */
function maxDrawdownPct(nav: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of nav) {
    if (!Number.isFinite(v)) continue;
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return Math.round(maxDd * 1000) / 10; // 1 decimal place
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// deno-lint-ignore no-explicit-any
type Sb = any;

async function upsertStatus(sb: Sb, chartKey: string, patch: Record<string, unknown>) {
  await sb.from("marketing_chart_data").upsert(
    { chart_key: chartKey, updated_at: new Date().toISOString(), ...patch },
    { onConflict: "chart_key" },
  );
}

async function refreshChart(sb: Sb, def: ChartDef) {
  const sbBt = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: def.btSchema } });

  // Remember the previous run so we can clean up its bulky rows afterwards.
  const { data: prevRow } = await sb
    .from("marketing_chart_data")
    .select("bt_run_id, request_id")
    .eq("chart_key", def.chartKey)
    .maybeSingle();
  const prevBtRunId = prevRow?.bt_run_id ?? null;

  // 1. Trailing 5-year window ending yesterday (UTC).
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  const startDate = isoDate(start);
  const endDate = isoDate(end);

  await upsertStatus(sb, def.chartKey, {
    status: "running",
    window_start: startDate,
    window_end: endDate,
    params: def.params,
    error_message: null,
  });

  // 2. Create the back-test run.
  const { data: created, error: createErr } = await sb.rpc(def.createRpc, {
    p_email: def.email,
    p_start_date: startDate,
    p_end_date: endDate,
    p_upfront_usdt: COMMON_PARAMS.upfront_usdt,
    p_monthly_usdt: COMMON_PARAMS.monthly_usdt,
    p_usdpc_enabled: COMMON_PARAMS.usdpc_enabled,
    p_usdpc_apy_percent: COMMON_PARAMS.usdpc_apy_percent,
    p_usdpc_conversion_fee_percent: COMMON_PARAMS.usdpc_conversion_fee_percent,
  });
  if (createErr) throw new Error(`${def.createRpc} failed: ${createErr.message}`);
  if (!created?.success) throw new Error(`${def.createRpc} rejected: ${created?.error ?? "unknown"}`);

  const requestId: string = created.request_id;

  // The LTH creator returns request_id only — resolve the bt_run_id it linked.
  let btRunId: string | undefined = created.bt_run_id;
  if (!btRunId) {
    const { data: reqRow, error: reqErr } = await sb
      .from("backtest_requests")
      .select("bt_run_id")
      .eq("id", requestId)
      .single();
    if (reqErr || !reqRow?.bt_run_id) {
      throw new Error(`could not resolve bt_run_id for request ${requestId}: ${reqErr?.message ?? "no row"}`);
    }
    btRunId = reqRow.bt_run_id;
  }

  // 3. Run the engine synchronously (strategy + Std DCA + HODL series).
  const execRes = await fetch(`${SUPABASE_URL}/functions/v1/${def.execFn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ bt_run_id: btRunId }),
  });
  if (!execRes.ok) {
    const txt = await execRes.text();
    throw new Error(`${def.execFn} failed (${execRes.status}): ${txt}`);
  }

  // 4. Fetch the assembled results.
  const { data: rawResults, error: resErr } = await sb.rpc(def.resultsRpc, { p_request_id: requestId });
  if (resErr) throw new Error(`${def.resultsRpc} failed: ${resErr.message}`);
  // deno-lint-ignore no-explicit-any
  const results = (rawResults as any)?.[def.resultsRpc] ?? rawResults;
  // deno-lint-ignore no-explicit-any
  const daily: any[] = results?.daily_results ?? [];
  if (!Array.isArray(daily) || daily.length === 0) {
    throw new Error(`${def.resultsRpc} returned no daily_results`);
  }

  // Full daily arrays (drawdown needs daily resolution).
  const stratNavDaily = daily.map((d) => Number(d[def.navKey]));
  const stdNavDaily = daily.map((d) => Number(d.std_dca_nav));
  const hodlNavDaily = daily.map((d) => Number(d.hodl_nav));

  // 5. Weekly-sample for the chart.
  const sampled = weeklySample(daily);
  const labels = sampled.map((d) => String(d.date));
  const stratSeries = {
    nav: sampled.map((d) => round2(d[def.navKey])),
    roi: sampled.map((d) => round2(d[def.roiKey])),
  };
  const series: Record<string, unknown> = {
    [def.seriesName]: stratSeries,
    stdDca: {
      nav: sampled.map((d) => round2(d.std_dca_nav)),
      roi: sampled.map((d) => round2(d.std_dca_roi)),
    },
    hodl: {
      nav: sampled.map((d) => round2(d.hodl_nav)),
      roi: sampled.map((d) => round2(d.hodl_roi)),
    },
  };
  // In-market flag (STH CB only) lets the page shade cash periods.
  if (typeof sampled[0]?.in_market !== "undefined") {
    series.inMarket = sampled.map((d) => !!d.in_market);
  }

  const stratS = results?.[def.summaryKey] ?? {};
  const stdS = results?.std_dca_summary ?? {};
  const hodlS = results?.hodl_summary ?? {};

  const summary: Record<string, unknown> = {
    [def.seriesName]: {
      final_nav: round2(stratS.final_nav),
      total_roi: round2(stratS.total_roi),
      cagr: round2(stratS.cagr),
      max_drawdown: maxDrawdownPct(stratNavDaily),
      contrib_gross: round2(stratS.contrib_gross),
      ...(typeof stratS.pct_time_in_market !== "undefined" ? { pct_time_in_market: round2(stratS.pct_time_in_market), trades: Number(stratS.trades) || 0 } : {}),
    },
    stdDca: {
      final_nav: round2(stdS.final_nav),
      total_roi: round2(stdS.total_roi),
      cagr: round2(stdS.cagr),
      max_drawdown: maxDrawdownPct(stdNavDaily),
      contrib_gross: round2(stdS.contrib_gross),
    },
    hodl: {
      final_nav: round2(hodlS.final_nav),
      total_roi: round2(hodlS.total_roi),
      cagr: round2(hodlS.cagr),
      max_drawdown: maxDrawdownPct(hodlNavDaily),
      contrib_gross: round2(hodlS.contrib_gross),
    },
  };

  const payload = { labels, series, summary, points: labels.length };

  await upsertStatus(sb, def.chartKey, {
    status: "ready",
    bt_run_id: btRunId,
    request_id: requestId,
    window_start: startDate,
    window_end: endDate,
    params: def.params,
    payload,
    generated_at: new Date().toISOString(),
    error_message: null,
  });

  // Clean up the PREVIOUS marketing run's bulky per-day rows (keep the latest).
  if (prevBtRunId && prevBtRunId !== btRunId) {
    for (const t of def.dataTables) {
      await sbBt.from(t).delete().eq("bt_run_id", prevBtRunId);
    }
  }

  return { chart_key: def.chartKey, bt_run_id: btRunId, points: labels.length, summary };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "public" } });
  const body = await req.json().catch(() => ({}));
  const only: string | undefined = body?.chart_key;
  const defs = only ? CHARTS.filter((c) => c.chartKey === only) : CHARTS;
  if (!defs.length) {
    return new Response(JSON.stringify({ success: false, error: `unknown chart_key '${only}'` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Record<string, unknown>[] = [];
  const errors: Record<string, string> = {};
  for (const def of defs) {
    try {
      results.push(await refreshChart(sb, def));
    } catch (e) {
      const msg = String((e as Error)?.message ?? e ?? "unknown");
      console.error(`ef_refresh_marketing_charts [${def.chartKey}] error:`, msg);
      errors[def.chartKey] = msg;
      await upsertStatus(sb, def.chartKey, { status: "error", error_message: msg }).catch(() => {});
      try {
        await sb.from("alert_events").insert({
          component: "ef_refresh_marketing_charts",
          severity: "error",
          org_id: Deno.env.get("ORG_ID") ?? null,
          customer_id: null,
          message: `Marketing chart refresh failed (${def.chartKey}): ${msg}`,
          context: { chart_key: def.chartKey },
        });
      } catch (_) { /* best effort */ }
    }
  }

  const ok = Object.keys(errors).length === 0;
  return new Response(
    JSON.stringify({ success: ok, charts: results, errors: ok ? undefined : errors }),
    { status: ok ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
