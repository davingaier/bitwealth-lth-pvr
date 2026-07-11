/**
 * ef_refresh_marketing_charts
 *
 * Recomputes the LTH PVR product-page charts (website/lth-pvr.html) and caches
 * the result in public.marketing_chart_data (chart_key = 'lth_pvr_5yr').
 *
 * Flow (single synchronous pass — a 5-year run completes well within the
 * function time budget):
 *   1. window = trailing 5 years ending YESTERDAY (UTC).
 *   2. create_public_backtest_run(marketing email, window, $2,400 upfront +
 *      $200/month, USDPC on @10% APY / 0.1% sweep fee)  → { request_id, bt_run_id }.
 *   3. await ef_bt_execute({ bt_run_id })  → runs LTH PVR + Std DCA + HODL,
 *      persists daily series to lth_pvr_bt.* (same engine as the public tool, so
 *      the numbers correlate with the one-pager).
 *   4. get_backtest_results(request_id)  → daily series + summaries.
 *   5. weekly-sample the series, compute max-drawdown + narrative figures,
 *      upsert the payload; then delete the PREVIOUS marketing run's bulky daily
 *      rows so lth_pvr_bt.* does not grow unbounded.
 *
 * Params match the one-pager exactly:
 *   $2,400 upfront + $200/month; LTH PVR = VALR 8bps trade + 18bps conversion +
 *   0.75% platform + 10% performance (HWM) + USDPC (idle USDT swept at ~10% APY,
 *   0.1% per sweep); Std DCA & HODL = exchange fees only; HODL = lump-sum day 1.
 *
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

const CHART_KEY = "lth_pvr_5yr";
const MARKETING_EMAIL = "marketing.lthpvr@bitwealth.co.za";
const PARAMS = {
  upfront_usdt: 2400,
  monthly_usdt: 200,
  usdpc_enabled: true,
  usdpc_apy_percent: 10,
  usdpc_conversion_fee_percent: 0.1,
  band_source: "rb",
  performance_fee_percent: 10,
  platform_fee_percent: 0.75,
  exchange: "VALR (BTC/USDT)",
};

// Bulky per-day tables written by ef_bt_execute (cleared for the previous run).
const BT_DATA_TABLES = [
  "bt_ledger",
  "bt_orders",
  "bt_results_daily",
  "bt_std_dca_ledger",
  "bt_std_dca_balances",
  "bt_hodl_ledger",
  "bt_hodl_balances",
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

async function upsertStatus(
  sb: ReturnType<typeof createClient>,
  patch: Record<string, unknown>,
) {
  await sb.from("marketing_chart_data").upsert(
    { chart_key: CHART_KEY, updated_at: new Date().toISOString(), ...patch },
    { onConflict: "chart_key" },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "public" } });
  const sbBt = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "lth_pvr_bt" } });

  try {
    // Remember the previous run so we can clean up its bulky rows afterwards.
    const { data: prevRow } = await sb
      .from("marketing_chart_data")
      .select("bt_run_id, request_id")
      .eq("chart_key", CHART_KEY)
      .maybeSingle();
    const prevBtRunId = prevRow?.bt_run_id ?? null;

    // 1. Trailing 5-year window ending yesterday (UTC).
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 5);
    const startDate = isoDate(start);
    const endDate = isoDate(end);

    await upsertStatus(sb, {
      status: "running",
      window_start: startDate,
      window_end: endDate,
      params: PARAMS,
      error_message: null,
    });

    // 2. Create the back-test run (Progressive variation defaults, USDPC on).
    const { data: created, error: createErr } = await sb.rpc(
      "create_public_backtest_run",
      {
        p_email: MARKETING_EMAIL,
        p_start_date: startDate,
        p_end_date: endDate,
        p_upfront_usdt: PARAMS.upfront_usdt,
        p_monthly_usdt: PARAMS.monthly_usdt,
        p_usdpc_enabled: PARAMS.usdpc_enabled,
        p_usdpc_apy_percent: PARAMS.usdpc_apy_percent,
        p_usdpc_conversion_fee_percent: PARAMS.usdpc_conversion_fee_percent,
      },
    );
    if (createErr) throw new Error(`create_public_backtest_run failed: ${createErr.message}`);
    if (!created?.success) throw new Error(`create_public_backtest_run rejected: ${created?.error ?? "unknown"}`);

    const requestId: string = created.request_id;

    // create_public_backtest_run returns request_id only — resolve the bt_run_id
    // it linked on public.backtest_requests.
    const { data: reqRow, error: reqErr } = await sb
      .from("backtest_requests")
      .select("bt_run_id")
      .eq("id", requestId)
      .single();
    if (reqErr || !reqRow?.bt_run_id) {
      throw new Error(`could not resolve bt_run_id for request ${requestId}: ${reqErr?.message ?? "no row"}`);
    }
    const btRunId: string = reqRow.bt_run_id;

    // 3. Run the engine synchronously (LTH PVR + Std DCA + HODL series).
    const execRes = await fetch(`${SUPABASE_URL}/functions/v1/ef_bt_execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ bt_run_id: btRunId }),
    });
    if (!execRes.ok) {
      const txt = await execRes.text();
      throw new Error(`ef_bt_execute failed (${execRes.status}): ${txt}`);
    }

    // 4. Fetch the assembled results.
    const { data: rawResults, error: resErr } = await sb.rpc("get_backtest_results", {
      p_request_id: requestId,
    });
    if (resErr) throw new Error(`get_backtest_results failed: ${resErr.message}`);
    const results = (rawResults as any)?.get_backtest_results ?? rawResults;
    const daily: any[] = results?.daily_results ?? [];
    if (!Array.isArray(daily) || daily.length === 0) {
      throw new Error("get_backtest_results returned no daily_results");
    }

    // Full daily arrays (drawdown needs daily resolution).
    const lthNavDaily = daily.map((d) => Number(d.lth_pvr_nav));
    const stdNavDaily = daily.map((d) => Number(d.std_dca_nav));
    const hodlNavDaily = daily.map((d) => Number(d.hodl_nav));

    // 5. Weekly-sample for the chart.
    const sampled = weeklySample(daily);
    const labels = sampled.map((d) => String(d.date));
    const series = {
      lthPvr: {
        nav: sampled.map((d) => round2(d.lth_pvr_nav)),
        roi: sampled.map((d) => round2(d.lth_pvr_roi)),
      },
      stdDca: {
        nav: sampled.map((d) => round2(d.std_dca_nav)),
        roi: sampled.map((d) => round2(d.std_dca_roi)),
      },
      hodl: {
        nav: sampled.map((d) => round2(d.hodl_nav)),
        roi: sampled.map((d) => round2(d.hodl_roi)),
      },
    };

    const lthS = results?.lth_pvr_summary ?? {};
    const stdS = results?.std_dca_summary ?? {};
    const hodlS = results?.hodl_summary ?? {};

    const summary = {
      lthPvr: {
        final_nav: round2(lthS.final_nav),
        total_roi: round2(lthS.total_roi),
        cagr: round2(lthS.cagr),
        max_drawdown: maxDrawdownPct(lthNavDaily),
        contrib_gross: round2(lthS.contrib_gross),
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

    // Persist the ready payload.
    await upsertStatus(sb, {
      status: "ready",
      bt_run_id: btRunId,
      request_id: requestId,
      window_start: startDate,
      window_end: endDate,
      params: PARAMS,
      payload,
      generated_at: new Date().toISOString(),
      error_message: null,
    });

    // Clean up the PREVIOUS marketing run's bulky per-day rows (keep the latest).
    if (prevBtRunId && prevBtRunId !== btRunId) {
      for (const t of BT_DATA_TABLES) {
        await sbBt.from(t).delete().eq("bt_run_id", prevBtRunId);
      }
    }

    return new Response(
      JSON.stringify({ success: true, chart_key: CHART_KEY, bt_run_id: btRunId, points: labels.length, summary }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = String((e as Error)?.message ?? e ?? "unknown");
    console.error("ef_refresh_marketing_charts error:", msg);
    await upsertStatus(sb, { status: "error", error_message: msg }).catch(() => {});
    try {
      await sb.from("alert_events").insert({
        component: "ef_refresh_marketing_charts",
        severity: "error",
        org_id: Deno.env.get("ORG_ID") ?? null,
        customer_id: null,
        message: `Marketing chart refresh failed: ${msg}`,
        context: { chart_key: CHART_KEY },
      });
    } catch (_) { /* best effort */ }
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
