// ef_sth_cb_bt_execute/index.ts
// ===========================================================================
// STH Cost Basis (STH_CB) strategy back-tester — thin DB wrapper around the pure
// simulator in _shared/sth_cb_simulator.ts (which the local lab also uses).
//
// Request body (admin JWT or service role required):
//   { bt_run_id }                               → (re)run an existing run
//   { params: {...}, label?, lth_pvr_bt_run_id? } → create run + params, then run
//
// `params.extras` (jsonb) carries any experimental SthCbConfig flags
// (trendExitConfirmDays, exitRocLength, capBuyTiers, sellTiers, cbSlopeDays,
// distributeAtSigma, disableTrendExit, trendReentryRatio) so new ideas never
// need schema changes.
// ===========================================================================

import { getServiceClient } from "./client.ts";
import { requireOrgAdmin } from "../_shared/adminAuth.ts";
import {
  BASE_CONFIG_KEYS,
  configNeedsBands,
  EXTRA_CONFIG_KEYS,
  simParamsFromBtParams,
  simulateSthCb,
  SthCbSeriesRow,
  toNum,
  unknownExtraKeys,
} from "../_shared/sth_cb_simulator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WARMUP_START = "2011-01-01"; // latch state is path-dependent → replay full usable history

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
async function bulkInsert(sb: any, table: string, rows: unknown[]): Promise<void> {
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    if (!slice.length) continue;
    const { error } = await sb.from(table).insert(slice);
    if (error) throw new Error(`insert into sth_cb_bt.${table} failed: ${error.message}`);
  }
}

// deno-lint-ignore no-explicit-any
async function pageAll(query: (from: number, to: number) => any): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const out: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Allow-list of bt_params columns accepted from the request body.
const PARAM_KEYS = [
  "start_date", "end_date", "upfront_contrib_usdt", "monthly_contrib_usdt",
  "maker_bps_trade", "maker_bps_contrib", "fee_plan", "platform_fee_pct",
  "management_fee_pct", "performance_fee_pct", "usdpc_enabled", "usdpc_apy_percent",
  "usdpc_conversion_fee_percent", "cap_buy_ratio", "cap_exit_ratio",
  "trend_enter_ratio", "trend_exit_ratio", "momo_enabled", "momo_len", "momo_thr",
  "momo_on_cap_exit", "momo_on_trend_exit", "execution_lag_days", "extras",
] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = getServiceClient();
  const sbBt = sb.schema("sth_cb_bt");
  const sbCb = sb.schema("sth_cb");

  // deno-lint-ignore no-explicit-any
  const caller = await requireOrgAdmin(sb as any, req, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  if (!caller.ok) return json({ error: caller.error }, caller.status);

  let bt_run_id: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    bt_run_id = body?.bt_run_id;

    // ── Create run + params when the caller passes params inline ───────────
    if (!bt_run_id) {
      const p = body?.params;
      if (!p || typeof p !== "object") return json({ error: "bt_run_id or params required" }, 400);
      const org_id = p.org_id ?? body?.org_id ?? Deno.env.get("ORG_ID");
      if (!org_id) return json({ error: "org_id required" }, 400);
      if (!p.start_date || !p.end_date) return json({ error: "params.start_date and params.end_date required" }, 400);

      const { data: runRow, error: runErr } = await sbBt
        .from("bt_runs")
        .insert({
          org_id,
          label: body?.label ?? null,
          status: "running",
          created_by: caller.userId ?? null,
          lth_pvr_bt_run_id: body?.lth_pvr_bt_run_id ?? null,
        })
        .select("bt_run_id")
        .single();
      if (runErr) throw new Error(`bt_runs insert failed: ${runErr.message}`);
      bt_run_id = runRow.bt_run_id as string;

      const paramRow: Record<string, unknown> = { bt_run_id };
      for (const k of PARAM_KEYS) if (typeof p[k] !== "undefined" && p[k] !== null) paramRow[k] = p[k];
      const { error: paramErr } = await sbBt.from("bt_params").insert(paramRow);
      if (paramErr) throw new Error(`bt_params insert failed: ${paramErr.message}`);
    }

    // ── Load run + params ─────────────────────────────────────────────────
    const { data: run, error: runErr } = await sbBt.from("bt_runs").select("*").eq("bt_run_id", bt_run_id).maybeSingle();
    if (runErr) throw new Error(`bt_runs query failed: ${runErr.message}`);
    if (!run) throw new Error(`bt_run_id ${bt_run_id} not found`);
    const org_id: string = run.org_id;

    const { data: params, error: paramErr } = await sbBt.from("bt_params").select("*").eq("bt_run_id", bt_run_id).maybeSingle();
    if (paramErr) throw new Error(`bt_params query failed: ${paramErr.message}`);
    if (!params) throw new Error(`bt_params missing for bt_run_id ${bt_run_id}`);

    await sbBt.from("bt_runs").update({ status: "running", error: null, finished_at: null }).eq("bt_run_id", bt_run_id);

    const simParams = simParamsFromBtParams(params);
    const extrasObj = (params.extras && typeof params.extras === "object") ? params.extras as Record<string, unknown> : {};
    const unknown = unknownExtraKeys(extrasObj);
    if (unknown.length) throw new Error(`Unrecognised key(s) in extras: ${unknown.join(", ")}. Allowed: ${[...BASE_CONFIG_KEYS, ...EXTRA_CONFIG_KEYS].join(", ")}`);
    console.info(`ef_sth_cb_bt_execute: run=${bt_run_id} ${simParams.startDate}..${simParams.endDate} lag=${simParams.executionLag}`, simParams.config);

    // ── Load price / cost-basis series (warm-up + window) ─────────────────
    const cbRows = await pageAll((from, to) =>
      sbCb.from("cost_basis_daily").select("close_date, btc_price_usd, sth_cost_basis_usd")
        .eq("org_id", org_id).gte("close_date", WARMUP_START).lte("close_date", simParams.endDate)
        .order("close_date", { ascending: true }).range(from, to));

    // LTH PVR bands are only needed for distributeAtSigma (idea 4)
    let bandsByDate: Map<string, Record<string, number | null>> | null = null;
    if (configNeedsBands(simParams.config)) {
      const bandRows = await pageAll((from, to) =>
        sb.schema("lth_pvr_bt").from("v_backtest_prices_rb")
          .select("close_date, price_at_p050, price_at_p100, price_at_p150, price_at_p200, price_at_p250")
          .eq("org_id", org_id).gte("close_date", WARMUP_START).lte("close_date", simParams.endDate)
          .order("close_date", { ascending: true }).range(from, to));
      bandsByDate = new Map();
      for (const b of bandRows) {
        bandsByDate.set(String(b.close_date), {
          p050: toNum(b.price_at_p050, NaN), p100: toNum(b.price_at_p100, NaN), p150: toNum(b.price_at_p150, NaN),
          p200: toNum(b.price_at_p200, NaN), p250: toNum(b.price_at_p250, NaN),
        });
      }
    }

    const series: SthCbSeriesRow[] = cbRows.map((r) => ({
      close_date: String(r.close_date),
      px: toNum(r.btc_price_usd, 0),
      cb: toNum(r.sth_cost_basis_usd, 0),
      bands: bandsByDate?.get(String(r.close_date)),
    }));

    // ── Simulate ──────────────────────────────────────────────────────────
    const sim = simulateSthCb(series, simParams, { ledger: true, benchmarks: true, daily: true });

    // ── Persist (re-run support: clear previous output first) ─────────────
    for (const t of ["bt_ledger", "bt_results_daily", "bt_std_dca_balances", "bt_std_dca_ledger", "bt_hodl_balances", "bt_hodl_ledger"]) {
      const { error } = await sbBt.from(t).delete().eq("bt_run_id", bt_run_id);
      if (error) throw new Error(`clear sth_cb_bt.${t} failed: ${error.message}`);
    }
    const tag = <T extends object>(rows: T[]) => rows.map((r) => ({ bt_run_id, org_id, ...r }));
    await bulkInsert(sbBt, "bt_ledger", tag(sim.ledger));
    await bulkInsert(sbBt, "bt_results_daily", tag(sim.results));
    await bulkInsert(sbBt, "bt_std_dca_ledger", tag(sim.stdLedger));
    await bulkInsert(sbBt, "bt_std_dca_balances", tag(sim.stdBalances));
    await bulkInsert(sbBt, "bt_hodl_ledger", tag(sim.hodlLedger));
    await bulkInsert(sbBt, "bt_hodl_balances", tag(sim.hodlBalances));

    const summary = {
      ...sim.summary,
      warmup: { ...sim.summary.warmup, from: WARMUP_START },
      // The config the engine actually ran (form columns merged with extras) — single source of truth for "what was tested"
      effective_config: simParams.config,
      window: { start_date: simParams.startDate, end_date: simParams.endDate, upfront: simParams.upfront, monthly: simParams.monthly, execution_lag_days: simParams.executionLag },
    };
    await sbBt.from("bt_runs").update({
      status: "ok", finished_at: new Date().toISOString(), error: null, summary,
    }).eq("bt_run_id", bt_run_id);

    return json({ status: "ok", bt_run_id, summary });
  } catch (e) {
    const errMsg = String((e as Error)?.message ?? e ?? "unknown");
    console.error("ef_sth_cb_bt_execute error:", errMsg, (e as Error)?.stack ?? "");
    if (bt_run_id) {
      await sbBt.from("bt_runs").update({ status: "error", finished_at: new Date().toISOString(), error: errMsg }).eq("bt_run_id", bt_run_id);
      try {
        await sb.schema("public").from("alert_events").insert({
          component: "ef_sth_cb_bt_execute", severity: "error",
          org_id: Deno.env.get("ORG_ID") ?? null, customer_id: null,
          message: `STH_CB back-test failed: ${errMsg}`, context: { bt_run_id },
        });
      } catch (alertErr) {
        console.error("alert_events insert failed:", alertErr);
      }
    }
    return json({ status: "error", bt_run_id: bt_run_id ?? null, error: errMsg }, 500);
  }
});
