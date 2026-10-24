// ef_sth_cb_bt_execute/index.ts
// ===========================================================================
// STH Cost Basis (STH_CB) strategy back-tester.
//
// Simulates the all-in / all-out STH_CB strategy (see
// _shared/sth_cb_strategy_logic.ts) against sth_cb.cost_basis_daily and
// writes results to sth_cb_bt.*. Portfolio accounting (contributions, VALR
// fees, BitWealth fee plans, USDPC idle-cash yield, Std DCA + HODL benchmarks)
// mirrors ef_bt_execute so STH_CB and LTH PVR runs are directly comparable.
//
// Request body (admin JWT or service role required):
//   { bt_run_id }                               → (re)run an existing run
//   { params: {...}, label?, lth_pvr_bt_run_id? } → create run + params, then run
//
// Execution timing:
//   execution_lag_days = 1 → signal at close of day D, fill at close of D+1
//                            (matches the live pipeline: RB data for D lands on D+1)
//   execution_lag_days = 0 → fill at the same close (ChartInspect style)
// ===========================================================================

import { getServiceClient } from "./client.ts";
import { requireOrgAdmin } from "../_shared/adminAuth.ts";
import {
  computeRocSeries,
  decideSthCb,
  INITIAL_STH_CB_STATE,
  SthCbConfig,
  SthCbSignal,
  SthCbState,
} from "../_shared/sth_cb_strategy_logic.ts";
import { sizeUsdpcToUsdt, sizeUsdtToUsdpc, syntheticUsdpcPrice } from "../_shared/usdpc.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WARMUP_START = "2011-01-01"; // latch state is path-dependent → replay full usable history
const USDT_DUST = 5;               // idle USDT below this is not deployed / swept
const BTC_DUST = 1e-8;

const toNum = (v: unknown, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const toBool = (v: unknown, def: boolean): boolean => (v === null || typeof v === "undefined") ? def : !!v;

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

function computeRoi(nav: number, contribGross: number): number {
  if (contribGross <= 0) return 0;
  return (nav / contribGross - 1) * 100;
}

function computeCagr(nav: number, contribGross: number, firstDate: string | null, tradeDate: string): number {
  if (contribGross <= 0 || !firstDate) return 0;
  const days = (new Date(tradeDate).getTime() - new Date(firstDate).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) return 0;
  const ratio = nav / contribGross;
  if (ratio <= 0) return 0;
  const years = days / 365;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

interface CbRow {
  org_id: string;
  close_date: string;
  btc_price_usd: number | string | null;
  sth_cost_basis_usd: number | string | null;
  price_to_cb_ratio: number | string | null;
}

// Allow-list of bt_params columns accepted from the request body.
const PARAM_KEYS = [
  "start_date", "end_date", "upfront_contrib_usdt", "monthly_contrib_usdt",
  "maker_bps_trade", "maker_bps_contrib", "fee_plan", "platform_fee_pct",
  "management_fee_pct", "performance_fee_pct", "usdpc_enabled", "usdpc_apy_percent",
  "usdpc_conversion_fee_percent", "cap_buy_ratio", "cap_exit_ratio",
  "trend_enter_ratio", "trend_exit_ratio", "momo_enabled", "momo_len", "momo_thr",
  "momo_on_cap_exit", "momo_on_trend_exit", "execution_lag_days",
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

    const start_date: string = params.start_date;
    const end_date: string = params.end_date;

    const tradeFeeRate = toNum(params.maker_bps_trade, 8) / 10_000;
    const contribFeeRate = toNum(params.maker_bps_contrib, 18) / 10_000;
    const feePlan = String(params.fee_plan ?? "management").toLowerCase();
    const platformFeeRate = toNum(params.platform_fee_pct, 0);
    const managementFeeRate = toNum(params.management_fee_pct, 0);
    const performanceFeeRate = toNum(params.performance_fee_pct, 0);
    const upfront = toNum(params.upfront_contrib_usdt, 0);
    const monthly = toNum(params.monthly_contrib_usdt, 0);
    const usdpcEnabled = toBool(params.usdpc_enabled, true);
    const usdpcApy = toNum(params.usdpc_apy_percent, 10) / 100;
    const usdpcConvFee = toNum(params.usdpc_conversion_fee_percent, 0.1) / 100;
    const executionLag = toNum(params.execution_lag_days, 1) === 0 ? 0 : 1;

    const config: SthCbConfig = {
      capBuyRatio: toNum(params.cap_buy_ratio, 0.70),
      capExitRatio: toNum(params.cap_exit_ratio, 1.00),
      trendEnterRatio: toNum(params.trend_enter_ratio, 1.05),
      trendExitRatio: toNum(params.trend_exit_ratio, 0.95),
      momoEnabled: toBool(params.momo_enabled, true),
      momoLength: Math.max(1, Math.trunc(toNum(params.momo_len, 5))),
      momoThreshold: toNum(params.momo_thr, 0),
      momoOnCapExit: toBool(params.momo_on_cap_exit, true),
      momoOnTrendExit: toBool(params.momo_on_trend_exit, true),
    };
    console.info(`ef_sth_cb_bt_execute: run=${bt_run_id} ${start_date}..${end_date} lag=${executionLag}`, config);

    // ── Load price / cost-basis series (warmup + window) ─────────────────
    const allRows: CbRow[] = [];
    {
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await sbCb
          .from("cost_basis_daily")
          .select("*")
          .eq("org_id", org_id)
          .gte("close_date", WARMUP_START)
          .lte("close_date", end_date)
          .order("close_date", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(`sth_cb.cost_basis_daily query failed: ${error.message}`);
        if (!data?.length) break;
        allRows.push(...(data as CbRow[]));
        if (data.length < pageSize) break;
        from += pageSize;
      }
    }
    const warmup = allRows.filter((r) => r.close_date < start_date);
    const prices = allRows.filter((r) => r.close_date >= start_date);
    if (!prices.length) throw new Error(`no sth_cb.cost_basis_daily rows for ${start_date}..${end_date}`);

    const rocSeries = computeRocSeries(allRows.map((r) => toNum(r.btc_price_usd, 0)), config.momoLength);
    const warmupCount = warmup.length;

    // Warm-up pass seeds the latches (and yields the signal pending for day 0 when lag=1)
    let state: SthCbState = { ...INITIAL_STH_CB_STATE };
    let lastSignal: SthCbSignal | null = null;
    for (let i = 0; i < warmup.length; i++) {
      const w = warmup[i];
      lastSignal = decideSthCb(toNum(w.btc_price_usd, 0), toNum(w.sth_cost_basis_usd, 0), rocSeries[i], state, config);
      state = lastSignal.state;
    }
    const stateAtStart: SthCbState = { ...state };
    console.info(`warmup complete (${warmupCount} rows): cap=${state.capLatch} trend=${state.trendLatch}`);

    // ── Portfolio state ───────────────────────────────────────────────────
    let btcBal = 0, usdtBal = 0, usdpcBal = 0;
    let contribGrossCum = 0, contribFeeCum = 0, contribNetCum = 0;
    let platformFeesCum = 0, performanceFeesCum = 0;
    let exchangeFeesBtcCum = 0, exchangeFeesUsdtCum = 0, usdpcConvFeeCum = 0;
    let highWaterMark = 0, hwmContribNetCum = 0;
    let firstContribDate: string | null = null;
    let lastMonth: string | null = null;
    let lastMonthForPerfFee: string | null = null;
    let prevUsdpcPrice = 1;

    // Std DCA benchmark
    let stdBtcBal = 0, stdUsdtBal = 0;
    let stdContribGrossCum = 0, stdContribFeeCum = 0, stdContribNetCum = 0;
    let stdExchangeFeesBtcCum = 0, stdExchangeFeesUsdtCum = 0;
    let stdFirstContribDate: string | null = null;

    // HODL benchmark: lump sum (upfront + monthly × months in window) on day 1
    const hodlMonthCount = new Set(prices.map((r) => r.close_date.slice(0, 7))).size;
    const hodlLumpSumGross = upfront + monthly * hodlMonthCount;
    let hodlBtcBal = 0;
    let hodlContribGrossCum = 0, hodlContribFeeCum = 0, hodlContribNetCum = 0;
    let hodlExchangeFeesBtcCum = 0, hodlExchangeFeesUsdtCum = 0;
    let hodlFirstContribDate: string | null = null;

    const resultsDaily: Record<string, unknown>[] = [];
    const ledgerRows: Record<string, unknown>[] = [];
    const stdBalances: Record<string, unknown>[] = [];
    const stdLedger: Record<string, unknown>[] = [];
    const hodlBalances: Record<string, unknown>[] = [];
    const hodlLedger: Record<string, unknown>[] = [];

    // Per-day trackers
    let platformFeeToday = 0, exchangeFeeBtcToday = 0, exchangeFeeUsdtToday = 0;
    let usdpcPriceToday = 1, usdpcYieldToday = 0, usdpcConvFeeToday = 0;
    let tradesCount = 0, daysInMarket = 0;

    const ledger = (tradeDate: string, kind: string, extra: Record<string, unknown>) => {
      ledgerRows.push({
        bt_run_id, org_id, trade_date: tradeDate, close_date: tradeDate, kind,
        amount_btc: 0, amount_usdt: 0, fee_btc: 0, fee_usdt: 0, amount_usdpc: 0, fee_usdpc: 0,
        ...extra,
      });
    };

    const ensureUsdt = (needed: number, tradeDate: string) => {
      if (!usdpcEnabled || usdpcBal <= 0 || usdtBal >= needed) return;
      const r = sizeUsdpcToUsdt(needed - usdtBal, usdpcBal, usdpcPriceToday, usdpcConvFee);
      if (r.usdpcToSell <= 0) return;
      usdpcBal -= r.usdpcToSell;
      usdtBal += r.usdtReceived;
      usdpcConvFeeCum += r.feeUsdt;
      usdpcConvFeeToday += r.feeUsdt;
      ledger(tradeDate, "convert", { amount_usdt: r.usdtReceived, fee_usdt: r.feeUsdt, amount_usdpc: -r.usdpcToSell, note: "USDPC->USDT conversion (fund buy/fee)" });
    };

    const sweepUsdt = (tradeDate: string) => {
      if (!usdpcEnabled || usdtBal < USDT_DUST) return;
      const r = sizeUsdtToUsdpc(usdtBal, usdpcPriceToday, usdpcConvFee);
      if (r.usdpcReceived <= 0) return;
      const swept = usdtBal;
      const feeUsdtEquiv = r.feeUsdpc * usdpcPriceToday;
      usdpcBal += r.usdpcReceived;
      usdtBal = 0;
      usdpcConvFeeCum += feeUsdtEquiv;
      usdpcConvFeeToday += feeUsdtEquiv;
      ledger(tradeDate, "convert", { amount_usdt: -swept, amount_usdpc: r.usdpcReceived, fee_usdpc: r.feeUsdpc, note: "USDT->USDPC sweep (idle cash to yield)" });
    };

    const navNow = (px: number) => usdtBal + btcBal * px + usdpcBal * usdpcPriceToday;

    // Sell BTC to cover a negative USDT balance after a fee (mirrors live manual conversion)
    const coverShortfall = (px: number, tradeDate: string, why: string) => {
      if (usdtBal >= 0 || btcBal <= 0 || px <= 0) return;
      const shortfall = -usdtBal;
      const btcSold = Math.min(btcBal, shortfall / (px * (1 - tradeFeeRate)));
      const feeBtc = btcSold * tradeFeeRate;
      const usdtReceived = (btcSold - feeBtc) * px;
      btcBal -= btcSold;
      usdtBal += usdtReceived;
      exchangeFeesBtcCum += feeBtc;
      exchangeFeeBtcToday += feeBtc;
      ledger(tradeDate, "fee", { amount_btc: -btcSold, amount_usdt: usdtReceived, fee_btc: feeBtc, note: `BTC→USDT conversion to cover ${why} shortfall` });
    };

    const applyContrib = (tradeDate: string, gross: number) => {
      const exchangeFee = gross * contribFeeRate;
      const afterExchangeFee = gross - exchangeFee;
      const platformFee = feePlan === "platform" ? afterExchangeFee * platformFeeRate : 0;
      const net = afterExchangeFee - platformFee;
      usdtBal += net;
      contribGrossCum += gross;
      contribFeeCum += exchangeFee;
      contribNetCum += net;
      platformFeesCum += platformFee;
      platformFeeToday += platformFee;
      exchangeFeesUsdtCum += exchangeFee;
      exchangeFeeUsdtToday += exchangeFee;
      if (!firstContribDate) firstContribDate = tradeDate;
      ledger(tradeDate, "contrib", { amount_usdt: gross, note: "Contribution" });
      if (exchangeFee > 0) ledger(tradeDate, "fee", { fee_usdt: exchangeFee, note: "VALR USDT/ZAR exchange fee" });
      if (platformFee > 0) ledger(tradeDate, "fee", { fee_usdt: platformFee, note: "BitWealth platform fee" });
    };

    const applyContribStd = (tradeDate: string, gross: number, px: number) => {
      const exchangeFee = gross * contribFeeRate;
      const net = gross - exchangeFee;
      stdContribGrossCum += gross;
      stdContribFeeCum += exchangeFee;
      stdContribNetCum += net;
      stdExchangeFeesUsdtCum += exchangeFee;
      if (!stdFirstContribDate) stdFirstContribDate = tradeDate;
      if (net > 0 && px > 0) {
        const btcGross = net / px;
        const feeBtc = btcGross * tradeFeeRate;
        stdBtcBal += btcGross - feeBtc;
        stdExchangeFeesBtcCum += feeBtc;
        stdLedger.push({ bt_run_id, org_id, trade_date: tradeDate, close_date: tradeDate, usdt_spent: net, btc_bought: btcGross - feeBtc, price_used: px, fee_btc: feeBtc });
      } else {
        stdUsdtBal += net;
      }
    };

    // Clear any previous output for this run (re-run support)
    for (const t of ["bt_ledger", "bt_results_daily", "bt_std_dca_balances", "bt_std_dca_ledger", "bt_hodl_balances", "bt_hodl_ledger"]) {
      const { error } = await sbBt.from(t).delete().eq("bt_run_id", bt_run_id);
      if (error) throw new Error(`clear sth_cb_bt.${t} failed: ${error.message}`);
    }

    // ── Main daily loop ───────────────────────────────────────────────────
    // `pending` is the signal awaiting execution (lag=1: yesterday's close).
    let pending: SthCbSignal | null = executionLag === 1 ? lastSignal : null;
    let position = "cash";

    for (let i = 0; i < prices.length; i++) {
      const row = prices[i];
      const tradeDate = row.close_date;
      const px = toNum(row.btc_price_usd, 0);
      const cb = toNum(row.sth_cost_basis_usd, 0);
      const monthKey = tradeDate.slice(0, 7);

      platformFeeToday = 0; exchangeFeeBtcToday = 0; exchangeFeeUsdtToday = 0; usdpcConvFeeToday = 0;
      if (usdpcEnabled) {
        const daysFromStart = Math.max(0, Math.round((new Date(tradeDate).getTime() - new Date(start_date).getTime()) / 86_400_000));
        usdpcPriceToday = syntheticUsdpcPrice(daysFromStart, usdpcApy, 1);
        usdpcYieldToday = usdpcBal * (usdpcPriceToday - prevUsdpcPrice);
      } else {
        usdpcPriceToday = 1;
        usdpcYieldToday = 0;
      }

      // 1) Contributions (upfront day 0; monthly on first trading day of each month)
      let grossToday = 0;
      if (i === 0 && upfront > 0) grossToday += upfront;
      if (monthly > 0 && monthKey !== lastMonth) grossToday += monthly;
      lastMonth = monthKey;
      if (grossToday > 0) {
        applyContrib(tradeDate, grossToday);
        applyContribStd(tradeDate, grossToday, px);
      }

      // HODL lump sum on day 0
      if (i === 0 && hodlLumpSumGross > 0 && px > 0) {
        const feeUsdt = hodlLumpSumGross * contribFeeRate;
        const net = hodlLumpSumGross - feeUsdt;
        const btcGross = net / px;
        const feeBtc = btcGross * tradeFeeRate;
        hodlBtcBal += btcGross - feeBtc;
        hodlContribGrossCum += hodlLumpSumGross;
        hodlContribFeeCum += feeUsdt;
        hodlContribNetCum += net;
        hodlExchangeFeesUsdtCum += feeUsdt;
        hodlExchangeFeesBtcCum += feeBtc;
        hodlFirstContribDate = tradeDate;
        hodlLedger.push({ bt_run_id, org_id, trade_date: tradeDate, close_date: tradeDate, usdt_spent: net, btc_bought: btcGross - feeBtc, price_used: px, fee_btc: feeBtc, fee_usdt: feeUsdt });
      }

      // 2) Today's close signal (used immediately when lag=0, else queued for tomorrow)
      const roc = rocSeries[warmupCount + i] ?? 0;
      const todaySignal = decideSthCb(px, cb, roc, state, config);
      state = todaySignal.state;

      const exec: SthCbSignal | null = executionLag === 0 ? todaySignal : pending;
      const signalDate = executionLag === 0 ? tradeDate : (i > 0 ? prices[i - 1].close_date : (warmup.at(-1)?.close_date ?? null));

      // 3) Execute: in market → deploy all cash; out of market → liquidate
      let action = "HOLD";
      let amountPct = 0;
      let rule = exec?.rule ?? "Hold";
      let note = exec?.note ?? "No signal yet";
      const wasInMarket = position !== "cash";

      if (exec && px > 0) {
        if (exec.inMarket) {
          const buyingPower = usdtBal + (usdpcEnabled ? usdpcBal * usdpcPriceToday : 0);
          if (buyingPower >= USDT_DUST) {
            ensureUsdt(buyingPower, tradeDate);
            const tradeUsdt = Math.max(0, usdtBal);
            if (tradeUsdt > 0) {
              const btcGross = tradeUsdt / px;
              const feeBtc = btcGross * tradeFeeRate;
              usdtBal -= tradeUsdt;
              btcBal += btcGross - feeBtc;
              exchangeFeesBtcCum += feeBtc;
              exchangeFeeBtcToday += feeBtc;
              action = "BUY";
              amountPct = 1;
              if (wasInMarket) { rule = "Deploy contribution"; note = `In market (${exec.position}) — contribution deployed`; }
              else {
                tradesCount++;
                // Day-0 deploy driven by a latch inherited from the warm-up pass
                if (exec.rule === "Hold") { rule = `Initial deploy (${exec.position} from warm-up)`; note = exec.note; }
              }
              ledger(tradeDate, "buy", { amount_btc: btcGross - feeBtc, amount_usdt: tradeUsdt, note: rule });
              if (feeBtc > 0) ledger(tradeDate, "fee", { fee_btc: feeBtc, note: "VALR BTC/USDT trade fee (BUY)" });
            }
          } else if (!wasInMarket) {
            note = `${exec.note} — no cash to deploy`;
          }
          position = exec.position;
        } else {
          if (btcBal > BTC_DUST) {
            const btcGross = btcBal;
            const feeBtc = btcGross * tradeFeeRate;
            const usdtReceived = (btcGross - feeBtc) * px;
            btcBal = 0;
            usdtBal += usdtReceived;
            exchangeFeesBtcCum += feeBtc;
            exchangeFeeBtcToday += feeBtc;
            action = "SELL";
            amountPct = 1;
            tradesCount++;
            ledger(tradeDate, "sell", { amount_btc: btcGross, amount_usdt: usdtReceived, note: rule });
            if (feeBtc > 0) ledger(tradeDate, "fee", { fee_btc: feeBtc, note: "VALR BTC/USDT trade fee (SELL)" });
          }
          position = "cash";
        }
      }
      if (position !== "cash") daysInMarket++;

      // 4) Monthly BitWealth fees (performance w/ high-water mark; management on NAV)
      let performanceFeeThisMonth = 0;
      if (monthKey !== lastMonthForPerfFee && lastMonthForPerfFee !== null) {
        const currentNav = navNow(px);
        const contribSinceHWM = contribNetCum - hwmContribNetCum;
        const navForPerfFee = currentNav - contribSinceHWM;
        if (navForPerfFee > highWaterMark && performanceFeeRate > 0) {
          performanceFeeThisMonth = (navForPerfFee - highWaterMark) * performanceFeeRate;
          ensureUsdt(performanceFeeThisMonth, tradeDate);
          usdtBal -= performanceFeeThisMonth;
          performanceFeesCum += performanceFeeThisMonth;
          ledger(tradeDate, "fee", { fee_usdt: performanceFeeThisMonth, note: "BitWealth performance fee (profit above high-water mark, net of new contributions)" });
          coverShortfall(px, tradeDate, "performance fee");
          highWaterMark = navNow(px) - contribSinceHWM;
          hwmContribNetCum = contribNetCum;
        } else if (navForPerfFee > highWaterMark) {
          highWaterMark = navForPerfFee;
          hwmContribNetCum = contribNetCum;
        }
        if (feePlan === "management" && managementFeeRate > 0) {
          const mgmtFee = Math.max(0, navNow(px) * managementFeeRate / 12);
          if (mgmtFee > 0) {
            ensureUsdt(mgmtFee, tradeDate);
            usdtBal -= mgmtFee;
            platformFeesCum += mgmtFee;
            platformFeeToday += mgmtFee;
            ledger(tradeDate, "fee", { fee_usdt: mgmtFee, note: "BitWealth management fee (NAV x rate / 12)" });
            coverShortfall(px, tradeDate, "management fee");
          }
        }
      }
      lastMonthForPerfFee = monthKey;
      if (i === 0) {
        highWaterMark = navNow(px);
        hwmContribNetCum = contribNetCum;
      }

      // 5) Park idle cash
      sweepUsdt(tradeDate);
      prevUsdpcPrice = usdpcPriceToday;

      // 6) Daily results
      const nav = navNow(px);
      resultsDaily.push({
        bt_run_id, org_id,
        close_date: tradeDate, trade_date: tradeDate, signal_date: signalDate,
        action, amount_pct: amountPct, rule, note,
        position_state: position,
        cap_latch: state.capLatch, trend_latch: state.trendLatch,
        signal_in_market: todaySignal.inMarket,
        roc,
        btc_balance: btcBal, usdt_balance: usdtBal, nav_usd: nav,
        price_usd: px, sth_cost_basis_usd: cb,
        price_to_cb_ratio: cb > 0 ? px / cb : null,
        contrib_gross_usdt_cum: contribGrossCum, contrib_fee_usdt_cum: contribFeeCum, contrib_net_usdt_cum: contribNetCum,
        total_roi_percent: computeRoi(nav, contribGrossCum),
        cagr_percent: computeCagr(nav, contribGrossCum, firstContribDate, tradeDate),
        platform_fees_paid_usdt: platformFeeToday,
        performance_fees_paid_usdt: performanceFeeThisMonth,
        exchange_fees_paid_btc: exchangeFeeBtcToday,
        exchange_fees_paid_usdt: exchangeFeeUsdtToday,
        high_water_mark_usdt: highWaterMark,
        usdpc_balance: usdpcBal,
        usdpc_price_usd: usdpcEnabled ? usdpcPriceToday : null,
        usdpc_yield_usdt: usdpcYieldToday,
        usdpc_conversion_fee_usdt: usdpcConvFeeToday,
      });

      const stdNav = stdUsdtBal + stdBtcBal * px;
      stdBalances.push({
        bt_run_id, org_id, close_date: tradeDate, trade_date: tradeDate,
        btc_balance: stdBtcBal, usdt_balance: stdUsdtBal, nav_usd: stdNav,
        contrib_gross_usdt_cum: stdContribGrossCum, contrib_fee_usdt_cum: stdContribFeeCum, contrib_net_usdt_cum: stdContribNetCum,
        total_roi_percent: computeRoi(stdNav, stdContribGrossCum),
        cagr_percent: computeCagr(stdNav, stdContribGrossCum, stdFirstContribDate, tradeDate),
        total_exchange_fees_btc: stdExchangeFeesBtcCum, total_exchange_fees_usdt: stdExchangeFeesUsdtCum,
      });

      const hodlNav = hodlBtcBal * px;
      hodlBalances.push({
        bt_run_id, org_id, close_date: tradeDate, trade_date: tradeDate,
        btc_balance: hodlBtcBal, usdt_balance: 0, nav_usd: hodlNav,
        contrib_gross_usdt_cum: hodlContribGrossCum, contrib_fee_usdt_cum: hodlContribFeeCum, contrib_net_usdt_cum: hodlContribNetCum,
        total_roi_percent: computeRoi(hodlNav, hodlContribGrossCum),
        cagr_percent: computeCagr(hodlNav, hodlContribGrossCum, hodlFirstContribDate, tradeDate),
        total_exchange_fees_btc: hodlExchangeFeesBtcCum, total_exchange_fees_usdt: hodlExchangeFeesUsdtCum,
      });

      pending = todaySignal;
    }

    // ── Persist ───────────────────────────────────────────────────────────
    await bulkInsert(sbBt, "bt_ledger", ledgerRows);
    await bulkInsert(sbBt, "bt_results_daily", resultsDaily);
    await bulkInsert(sbBt, "bt_std_dca_ledger", stdLedger);
    await bulkInsert(sbBt, "bt_std_dca_balances", stdBalances);
    await bulkInsert(sbBt, "bt_hodl_ledger", hodlLedger);
    await bulkInsert(sbBt, "bt_hodl_balances", hodlBalances);

    const last = resultsDaily.at(-1) as Record<string, number>;
    const lastStd = stdBalances.at(-1) as Record<string, number>;
    const lastHodl = hodlBalances.at(-1) as Record<string, number>;
    const summary = {
      sth_cb: {
        final_nav_usd: last.nav_usd,
        final_roi_percent: last.total_roi_percent,
        final_cagr_percent: last.cagr_percent,
        total_contrib_gross_usdt: last.contrib_gross_usdt_cum,
        trades: tradesCount,
        days: prices.length,
        pct_time_in_market: prices.length ? Math.round((daysInMarket / prices.length) * 10_000) / 100 : 0,
        fees: {
          exchange_btc: exchangeFeesBtcCum, exchange_usdt: exchangeFeesUsdtCum,
          platform_or_mgmt_usdt: platformFeesCum, performance_usdt: performanceFeesCum,
          usdpc_conversion_usdt: usdpcConvFeeCum,
        },
      },
      std_dca: { final_nav_usd: lastStd.nav_usd, final_roi_percent: lastStd.total_roi_percent, final_cagr_percent: lastStd.cagr_percent },
      hodl: { final_nav_usd: lastHodl.nav_usd, final_roi_percent: lastHodl.total_roi_percent, final_cagr_percent: lastHodl.cagr_percent, total_contrib_gross_usdt: lastHodl.contrib_gross_usdt_cum },
      warmup: { rows: warmupCount, from: WARMUP_START, state_at_start: stateAtStart },
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
