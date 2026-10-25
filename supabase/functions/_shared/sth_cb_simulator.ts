// sth_cb_simulator.ts
// ===========================================================================
// Pure, DB-free STH Cost Basis back-test simulator — single source of truth for
// portfolio accounting. Used by:
//   • ef_sth_cb_bt_execute (writes the output to sth_cb_bt.*)
//   • tools/sth_cb_lab      (local grid / random search across CPU cores)
//
// Accounting mirrors ef_bt_execute (LTH PVR) so the two strategies are directly
// comparable: VALR bps fees, BitWealth platform / management / performance fee
// plans (high-water mark), USDPC idle-cash yield with just-in-time conversion,
// Std DCA and HODL benchmarks.
//
// Execution timing: executionLag = 1 → signal at close D, fill at close D+1
// (matches the live pipeline); 0 → same-day fill (ChartInspect style).
// ===========================================================================

import {
  computeRocSeries,
  decideSthCb,
  INITIAL_STH_CB_STATE,
  SthCbConfig,
  SthCbExtraInputs,
  SthCbSignal,
  SthCbState,
} from "./sth_cb_strategy_logic.ts";
import { sizeUsdpcToUsdt, sizeUsdtToUsdpc, syntheticUsdpcPrice } from "./usdpc.ts";

export const USDT_DUST = 5;      // idle USDT below this is not deployed / swept
export const BTC_DUST = 1e-8;
/** Partial rebalances (targetAlloc strictly between 0 and 1) only trade when drift exceeds this NAV fraction. */
export const REBALANCE_BAND = 0.02;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SthCbSeriesRow {
  close_date: string;            // YYYY-MM-DD
  px: number;                    // BTC close
  cb: number;                    // STH cost basis
  /** BTC held by the STH cohort — needed only for the "sth_cb" band source (sth_pvr mode) */
  sth_supply?: number;
  /** LTH PVR band price levels (p050…p250) — only needed for distributeAtSigma */
  bands?: Record<string, number | null | undefined>;
}

export interface SthCbSimParams {
  startDate: string;
  endDate: string;
  upfront: number;
  monthly: number;
  tradeFeeRate: number;          // e.g. 0.0008
  contribFeeRate: number;        // e.g. 0.0018
  feePlan: "management" | "platform";
  platformFeeRate: number;       // e.g. 0.0075 (platform plan)
  managementFeeRate: number;     // e.g. 0.01 p.a. (management plan)
  performanceFeeRate: number;    // e.g. 0.10
  usdpcEnabled: boolean;
  usdpcApy: number;              // e.g. 0.10
  usdpcConvFee: number;          // e.g. 0.001
  executionLag: 0 | 1;
  config: SthCbConfig;
}

export interface SthCbSimOptions {
  /** Build ledger / order rows (default true). The lab turns this off for speed. */
  ledger?: boolean;
  /** Compute Std DCA + HODL benchmarks (default true). */
  benchmarks?: boolean;
  /** Keep per-day result rows (default true). The lab can keep only the summary. */
  daily?: boolean;
}

export interface SthCbDailyRow {
  close_date: string;
  trade_date: string;
  signal_date: string | null;
  action: "BUY" | "SELL" | "HOLD";
  amount_pct: number;
  rule: string;
  note: string;
  position_state: string;
  cap_latch: boolean;
  trend_latch: boolean;
  signal_in_market: boolean;
  target_alloc: number;
  roc: number;
  btc_balance: number;
  usdt_balance: number;
  nav_usd: number;
  price_usd: number;
  sth_cost_basis_usd: number;
  price_to_cb_ratio: number | null;
  contrib_gross_usdt_cum: number;
  contrib_fee_usdt_cum: number;
  contrib_net_usdt_cum: number;
  total_roi_percent: number;
  cagr_percent: number;
  platform_fees_paid_usdt: number;
  performance_fees_paid_usdt: number;
  exchange_fees_paid_btc: number;
  exchange_fees_paid_usdt: number;
  high_water_mark_usdt: number;
  usdpc_balance: number;
  usdpc_price_usd: number | null;
  usdpc_yield_usdt: number;
  usdpc_conversion_fee_usdt: number;
}

export interface BenchDailyRow {
  close_date: string;
  trade_date: string;
  btc_balance: number;
  usdt_balance: number;
  nav_usd: number;
  contrib_gross_usdt_cum: number;
  contrib_fee_usdt_cum: number;
  contrib_net_usdt_cum: number;
  total_roi_percent: number;
  cagr_percent: number;
  total_exchange_fees_btc: number;
  total_exchange_fees_usdt: number;
}

export interface LedgerRow {
  trade_date: string;
  close_date: string;
  kind: string;
  amount_btc: number;
  amount_usdt: number;
  fee_btc: number;
  fee_usdt: number;
  amount_usdpc: number;
  fee_usdpc: number;
  note: string;
}

export interface BenchLedgerRow {
  trade_date: string;
  close_date: string;
  usdt_spent: number;
  btc_bought: number;
  price_used: number;
  fee_btc: number;
  fee_usdt?: number;
}

export interface SthCbMetrics {
  final_nav_usd: number;
  final_roi_percent: number;
  final_cagr_percent: number;
  total_contrib_gross_usdt: number;
  trades: number;
  days: number;
  pct_time_in_market: number;
  /** Max drawdown of the time-weighted unit value (contribution-neutral), as a negative fraction. */
  max_drawdown: number;
  /** CAGR / |max drawdown| */
  calmar: number;
  /** Annualised mean/std of contribution-neutral daily returns */
  sharpe: number;
  /** Final NAV ÷ HODL final NAV (NaN when benchmarks are off) */
  nav_vs_hodl: number;
  /** Final NAV ÷ Std DCA final NAV */
  nav_vs_std_dca: number;
  fees: {
    exchange_btc: number;
    exchange_usdt: number;
    platform_or_mgmt_usdt: number;
    performance_usdt: number;
    usdpc_conversion_usdt: number;
  };
}

export interface SthCbSimResult {
  results: SthCbDailyRow[];
  ledger: LedgerRow[];
  stdBalances: BenchDailyRow[];
  stdLedger: BenchLedgerRow[];
  hodlBalances: BenchDailyRow[];
  hodlLedger: BenchLedgerRow[];
  summary: {
    sth_cb: SthCbMetrics;
    std_dca: { final_nav_usd: number; final_roi_percent: number; final_cagr_percent: number } | null;
    hodl: { final_nav_usd: number; final_roi_percent: number; final_cagr_percent: number; total_contrib_gross_usdt: number } | null;
    warmup: { rows: number; from: string | null; state_at_start: SthCbState };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const toNum = (v: unknown, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
export const toBool = (v: unknown, def: boolean): boolean => (v === null || typeof v === "undefined") ? def : !!v;

export function computeRoi(nav: number, contribGross: number): number {
  if (contribGross <= 0) return 0;
  return (nav / contribGross - 1) * 100;
}

export function computeCagr(nav: number, contribGross: number, firstDate: string | null, tradeDate: string): number {
  if (contribGross <= 0 || !firstDate) return 0;
  const days = (new Date(tradeDate).getTime() - new Date(firstDate).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) return 0;
  const ratio = nav / contribGross;
  if (ratio <= 0) return 0;
  return (Math.pow(ratio, 365 / days) - 1) * 100;
}

/** Map a sth_cb_bt.bt_params row (+ optional `extras` jsonb) to simulator params. */
export function simParamsFromBtParams(params: Record<string, unknown>): SthCbSimParams {
  const extras = (params.extras && typeof params.extras === "object") ? params.extras as Record<string, unknown> : {};
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
    ...applyExtras(extras),
  };
  return {
    startDate: String(params.start_date),
    endDate: String(params.end_date),
    upfront: toNum(params.upfront_contrib_usdt, 0),
    monthly: toNum(params.monthly_contrib_usdt, 0),
    tradeFeeRate: toNum(params.maker_bps_trade, 8) / 10_000,
    contribFeeRate: toNum(params.maker_bps_contrib, 18) / 10_000,
    feePlan: String(params.fee_plan ?? "management").toLowerCase() === "platform" ? "platform" : "management",
    platformFeeRate: toNum(params.platform_fee_pct, 0),
    managementFeeRate: toNum(params.management_fee_pct, 0),
    performanceFeeRate: toNum(params.performance_fee_pct, 0),
    usdpcEnabled: toBool(params.usdpc_enabled, true),
    usdpcApy: toNum(params.usdpc_apy_percent, 10) / 100,
    usdpcConvFee: toNum(params.usdpc_conversion_fee_percent, 0.1) / 100,
    executionLag: toNum(params.execution_lag_days, 1) === 0 ? 0 : 1,
    config,
  };
}

/** Experimental keys accepted from `extras` (camelCase, matching SthCbConfig). */
export const EXTRA_CONFIG_KEYS = [
  "trendExitConfirmDays", "exitRocLength", "capBuyTiers", "sellTiers",
  "cbSlopeDays", "distributeAtSigma", "disableTrendExit", "trendReentryRatio",
  "sigmaMode", "sigmaWindow", "capBuySigma", "capExitSigma", "trendEnterSigma", "trendExitSigma",
  "reentryRocThreshold", "minHoldDays", "blockEntryAboveSigma", "capBuyRocThreshold", "trailingStopPct",
  "distReentryClearRatio", "capBuyAtLthSigma",
] as const;

/** Base keys that `extras` may also override (so a lab config can be pasted verbatim). */
export const BASE_CONFIG_KEYS = [
  "capBuyRatio", "capExitRatio", "trendEnterRatio", "trendExitRatio",
  "momoEnabled", "momoLength", "momoThreshold", "momoOnCapExit", "momoOnTrendExit",
] as const;

export function applyExtras(extras: Record<string, unknown>): Partial<SthCbConfig> {
  const out: Record<string, unknown> = {};
  for (const k of [...BASE_CONFIG_KEYS, ...EXTRA_CONFIG_KEYS]) {
    if (typeof extras[k] === "undefined" || extras[k] === null) continue;
    out[k] = extras[k];
  }
  return out as Partial<SthCbConfig>;
}

/** Keys present in `extras` that are not recognised (typos) — callers can warn on these. */
export function unknownExtraKeys(extras: Record<string, unknown>): string[] {
  const known = new Set<string>([...BASE_CONFIG_KEYS, ...EXTRA_CONFIG_KEYS]);
  return Object.keys(extras).filter((k) => !known.has(k));
}

/** Does this config need LTH PVR bands joined onto the series? */
export function configNeedsBands(config: SthCbConfig): boolean {
  return !!config.distributeAtSigma || !!config.blockEntryAboveSigma || typeof config.capBuyAtLthSigma === "number";
}

/**
 * σ series for idea 7 (σ-adaptive thresholds).
 *  ratio_sigma: std of ln(px/cb) over `window` days (0 = expanding)
 *  sth_pvr:     expanding std of STH market cap ÷ STH supply ($ per 1σ); needs sth_supply
 */
export function computeSigmaSeries(rows: SthCbSeriesRow[], mode: "ratio_sigma" | "sth_pvr", window: number): number[] {
  const out = new Array<number>(rows.length).fill(NaN);
  const MIN = 30;
  let n = 0, mean = 0, m2 = 0;
  if (mode === "sth_pvr") {
    for (let i = 0; i < rows.length; i++) {
      const s = Number(rows[i].sth_supply);
      if (!(rows[i].px > 0) || !(s > 0)) continue;
      const x = rows[i].px * s;
      n++; const d = x - mean; mean += d / n; m2 += d * (x - mean);
      if (n >= MIN) out[i] = Math.sqrt(m2 / (n - 1)) / s;
    }
    return out;
  }
  const win = Math.max(0, Math.trunc(window));
  const buf: number[] = [];
  let sum = 0, sumSq = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!(rows[i].px > 0) || !(rows[i].cb > 0)) continue;
    const x = Math.log(rows[i].px / rows[i].cb);
    if (win > 0) {
      buf.push(x); sum += x; sumSq += x * x;
      if (buf.length > win) { const o = buf.shift()!; sum -= o; sumSq -= o * o; }
      const k = buf.length;
      if (k >= Math.min(MIN, win)) { const mu = sum / k; out[i] = Math.sqrt(Math.max(0, (sumSq - k * mu * mu) / Math.max(1, k - 1))); }
    } else {
      n++; const d = x - mean; mean += d / n; m2 += d * (x - mean);
      if (n >= MIN) out[i] = Math.sqrt(m2 / (n - 1));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

/**
 * Run the STH_CB back-test.
 * @param rows  ALL rows ascending by close_date, including warm-up history before
 *              startDate (used to seed latches) and nothing after endDate.
 */
export function simulateSthCb(rows: SthCbSeriesRow[], p: SthCbSimParams, opts: SthCbSimOptions = {}): SthCbSimResult {
  const wantLedger = opts.ledger !== false;
  const wantBench = opts.benchmarks !== false;
  const wantDaily = opts.daily !== false;
  const config = p.config;

  const warmup = rows.filter((r) => r.close_date < p.startDate);
  const prices = rows.filter((r) => r.close_date >= p.startDate && r.close_date <= p.endDate);
  if (!prices.length) throw new Error(`no series rows for ${p.startDate}..${p.endDate}`);
  const all = warmup.concat(prices);
  const warmupCount = warmup.length;

  // Derived input series (over warm-up + window so day 0 has real values)
  const pxAll = all.map((r) => r.px);
  const cbAll = all.map((r) => r.cb);
  const rocSeries = computeRocSeries(pxAll, config.momoLength);
  const rocExitSeries = config.exitRocLength ? computeRocSeries(pxAll, Math.max(1, Math.trunc(config.exitRocLength))) : null;
  const cbSlopeSeries = config.cbSlopeDays ? computeRocSeries(cbAll, Math.max(1, Math.trunc(config.cbSlopeDays))) : null;
  const sigmaSeries = config.sigmaMode ? computeSigmaSeries(all, config.sigmaMode, config.sigmaWindow ?? 0) : null;
  const extraAt = (i: number): SthCbExtraInputs => ({
    rocExit: rocExitSeries ? rocExitSeries[i] : undefined,
    cbSlope: cbSlopeSeries ? cbSlopeSeries[i] : undefined,
    bands: all[i].bands,
    sigma: sigmaSeries ? sigmaSeries[i] : undefined,
  });

  // Warm-up pass seeds the latches (and the pending next-day signal when lag=1)
  let state: SthCbState = { ...INITIAL_STH_CB_STATE };
  let lastSignal: SthCbSignal | null = null;
  for (let i = 0; i < warmupCount; i++) {
    lastSignal = decideSthCb(all[i].px, all[i].cb, rocSeries[i], state, config, extraAt(i));
    state = lastSignal.state;
  }
  const stateAtStart: SthCbState = { ...state };

  // ── Portfolio state ───────────────────────────────────────────────────────
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
  const hodlLumpSumGross = p.upfront + p.monthly * hodlMonthCount;
  let hodlBtcBal = 0;
  let hodlContribGrossCum = 0, hodlContribFeeCum = 0, hodlContribNetCum = 0;
  let hodlExchangeFeesBtcCum = 0, hodlExchangeFeesUsdtCum = 0;
  let hodlFirstContribDate: string | null = null;

  const results: SthCbDailyRow[] = [];
  const ledgerRows: LedgerRow[] = [];
  const stdBalances: BenchDailyRow[] = [];
  const stdLedger: BenchLedgerRow[] = [];
  const hodlBalances: BenchDailyRow[] = [];
  const hodlLedger: BenchLedgerRow[] = [];

  // Per-day trackers
  let platformFeeToday = 0, exchangeFeeBtcToday = 0, exchangeFeeUsdtToday = 0;
  let usdpcPriceToday = 1, usdpcYieldToday = 0, usdpcConvFeeToday = 0;
  let tradesCount = 0, daysInMarket = 0;

  // Metrics trackers (contribution-neutral unit value)
  let prevNav = 0;
  let unitIndex = 1, unitPeak = 1, maxDD = 0;
  let retSum = 0, retSumSq = 0, retN = 0;

  const ledger = (tradeDate: string, kind: string, extra: Partial<LedgerRow>) => {
    if (!wantLedger) return;
    ledgerRows.push({
      trade_date: tradeDate, close_date: tradeDate, kind,
      amount_btc: 0, amount_usdt: 0, fee_btc: 0, fee_usdt: 0, amount_usdpc: 0, fee_usdpc: 0, note: "",
      ...extra,
    });
  };

  const ensureUsdt = (needed: number, tradeDate: string) => {
    if (!p.usdpcEnabled || usdpcBal <= 0 || usdtBal >= needed) return;
    const r = sizeUsdpcToUsdt(needed - usdtBal, usdpcBal, usdpcPriceToday, p.usdpcConvFee);
    if (r.usdpcToSell <= 0) return;
    usdpcBal -= r.usdpcToSell;
    usdtBal += r.usdtReceived;
    usdpcConvFeeCum += r.feeUsdt;
    usdpcConvFeeToday += r.feeUsdt;
    ledger(tradeDate, "convert", { amount_usdt: r.usdtReceived, fee_usdt: r.feeUsdt, amount_usdpc: -r.usdpcToSell, note: "USDPC->USDT conversion (fund buy/fee)" });
  };

  const sweepUsdt = (tradeDate: string) => {
    if (!p.usdpcEnabled || usdtBal < USDT_DUST) return;
    const r = sizeUsdtToUsdpc(usdtBal, usdpcPriceToday, p.usdpcConvFee);
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

  const coverShortfall = (px: number, tradeDate: string, why: string) => {
    if (usdtBal >= 0 || btcBal <= 0 || px <= 0) return;
    const shortfall = -usdtBal;
    const btcSold = Math.min(btcBal, shortfall / (px * (1 - p.tradeFeeRate)));
    const feeBtc = btcSold * p.tradeFeeRate;
    const usdtReceived = (btcSold - feeBtc) * px;
    btcBal -= btcSold;
    usdtBal += usdtReceived;
    exchangeFeesBtcCum += feeBtc;
    exchangeFeeBtcToday += feeBtc;
    ledger(tradeDate, "fee", { amount_btc: -btcSold, amount_usdt: usdtReceived, fee_btc: feeBtc, note: `BTC→USDT conversion to cover ${why} shortfall` });
  };

  const applyContrib = (tradeDate: string, gross: number) => {
    const exchangeFee = gross * p.contribFeeRate;
    const afterExchangeFee = gross - exchangeFee;
    const platformFee = p.feePlan === "platform" ? afterExchangeFee * p.platformFeeRate : 0;
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
    return net;
  };

  const applyContribStd = (tradeDate: string, gross: number, px: number) => {
    const exchangeFee = gross * p.contribFeeRate;
    const net = gross - exchangeFee;
    stdContribGrossCum += gross;
    stdContribFeeCum += exchangeFee;
    stdContribNetCum += net;
    stdExchangeFeesUsdtCum += exchangeFee;
    if (!stdFirstContribDate) stdFirstContribDate = tradeDate;
    if (net > 0 && px > 0) {
      const btcGross = net / px;
      const feeBtc = btcGross * p.tradeFeeRate;
      stdBtcBal += btcGross - feeBtc;
      stdExchangeFeesBtcCum += feeBtc;
      if (wantLedger) stdLedger.push({ trade_date: tradeDate, close_date: tradeDate, usdt_spent: net, btc_bought: btcGross - feeBtc, price_used: px, fee_btc: feeBtc });
    } else {
      stdUsdtBal += net;
    }
  };

  // Buy BTC with `tradeUsdt` of USDT (already ensured). Returns BTC received net of fee.
  const buyBtc = (tradeUsdt: number, px: number, tradeDate: string, rule: string) => {
    const btcGross = tradeUsdt / px;
    const feeBtc = btcGross * p.tradeFeeRate;
    usdtBal -= tradeUsdt;
    btcBal += btcGross - feeBtc;
    exchangeFeesBtcCum += feeBtc;
    exchangeFeeBtcToday += feeBtc;
    ledger(tradeDate, "buy", { amount_btc: btcGross - feeBtc, amount_usdt: tradeUsdt, note: rule });
    if (feeBtc > 0) ledger(tradeDate, "fee", { fee_btc: feeBtc, note: "VALR BTC/USDT trade fee (BUY)" });
    return btcGross - feeBtc;
  };

  const sellBtc = (btcGross: number, px: number, tradeDate: string, rule: string) => {
    const feeBtc = btcGross * p.tradeFeeRate;
    const usdtReceived = (btcGross - feeBtc) * px;
    btcBal -= btcGross;
    if (btcBal < BTC_DUST) btcBal = 0;
    usdtBal += usdtReceived;
    exchangeFeesBtcCum += feeBtc;
    exchangeFeeBtcToday += feeBtc;
    ledger(tradeDate, "sell", { amount_btc: btcGross, amount_usdt: usdtReceived, note: rule });
    if (feeBtc > 0) ledger(tradeDate, "fee", { fee_btc: feeBtc, note: "VALR BTC/USDT trade fee (SELL)" });
    return usdtReceived;
  };

  // ── Main daily loop ───────────────────────────────────────────────────────
  let pending: SthCbSignal | null = p.executionLag === 1 ? lastSignal : null;
  let position = "cash";
  let currentAlloc = 0;

  for (let i = 0; i < prices.length; i++) {
    const row = prices[i];
    const gi = warmupCount + i;
    const tradeDate = row.close_date;
    const px = row.px;
    const cb = row.cb;
    const monthKey = tradeDate.slice(0, 7);

    platformFeeToday = 0; exchangeFeeBtcToday = 0; exchangeFeeUsdtToday = 0; usdpcConvFeeToday = 0;
    if (p.usdpcEnabled) {
      const daysFromStart = Math.max(0, Math.round((new Date(tradeDate).getTime() - new Date(p.startDate).getTime()) / 86_400_000));
      usdpcPriceToday = syntheticUsdpcPrice(daysFromStart, p.usdpcApy, 1);
      usdpcYieldToday = usdpcBal * (usdpcPriceToday - prevUsdpcPrice);
    } else {
      usdpcPriceToday = 1;
      usdpcYieldToday = 0;
    }

    // 1) Contributions (upfront day 0; monthly on first trading day of each month)
    let grossToday = 0;
    if (i === 0 && p.upfront > 0) grossToday += p.upfront;
    if (p.monthly > 0 && monthKey !== lastMonth) grossToday += p.monthly;
    lastMonth = monthKey;
    let contribNetToday = 0;
    if (grossToday > 0) {
      contribNetToday = applyContrib(tradeDate, grossToday);
      if (wantBench) applyContribStd(tradeDate, grossToday, px);
    }

    // HODL lump sum on day 0
    if (wantBench && i === 0 && hodlLumpSumGross > 0 && px > 0) {
      const feeUsdt = hodlLumpSumGross * p.contribFeeRate;
      const net = hodlLumpSumGross - feeUsdt;
      const btcGross = net / px;
      const feeBtc = btcGross * p.tradeFeeRate;
      hodlBtcBal += btcGross - feeBtc;
      hodlContribGrossCum += hodlLumpSumGross;
      hodlContribFeeCum += feeUsdt;
      hodlContribNetCum += net;
      hodlExchangeFeesUsdtCum += feeUsdt;
      hodlExchangeFeesBtcCum += feeBtc;
      hodlFirstContribDate = tradeDate;
      if (wantLedger) hodlLedger.push({ trade_date: tradeDate, close_date: tradeDate, usdt_spent: net, btc_bought: btcGross - feeBtc, price_used: px, fee_btc: feeBtc, fee_usdt: feeUsdt });
    }

    // 2) Today's close signal (used immediately when lag=0, else queued for tomorrow)
    const roc = rocSeries[gi] ?? 0;
    const todaySignal = decideSthCb(px, cb, roc, state, config, extraAt(gi));
    state = todaySignal.state;

    const exec: SthCbSignal | null = p.executionLag === 0 ? todaySignal : pending;
    const signalDate = p.executionLag === 0 ? tradeDate : (i > 0 ? prices[i - 1].close_date : (warmup.at(-1)?.close_date ?? null));

    // 3) Execute towards the target allocation
    let action: "BUY" | "SELL" | "HOLD" = "HOLD";
    let amountPct = 0;
    let rule = exec?.rule ?? "Hold";
    let note = exec?.note ?? "No signal yet";
    const wasInMarket = position !== "cash";

    if (exec && px > 0) {
      const target = exec.inMarket ? exec.targetAlloc : 0;
      if (target >= 1) {
        // All-in: deploy every unit of cash (identical to the MVP behaviour)
        const buyingPower = usdtBal + (p.usdpcEnabled ? usdpcBal * usdpcPriceToday : 0);
        if (buyingPower >= USDT_DUST) {
          ensureUsdt(buyingPower, tradeDate);
          const tradeUsdt = Math.max(0, usdtBal);
          if (tradeUsdt > 0) {
            action = "BUY";
            amountPct = 1;
            if (wasInMarket && currentAlloc >= 1) { rule = "Deploy contribution"; note = `In market (${exec.position}) — contribution deployed`; }
            else {
              tradesCount++;
              if (exec.rule === "Hold") { rule = `Initial deploy (${exec.position} from warm-up)`; note = exec.note; }
            }
            buyBtc(tradeUsdt, px, tradeDate, rule);
          }
        } else if (!wasInMarket) {
          note = `${exec.note} — no cash to deploy`;
        }
        position = exec.position;
        currentAlloc = 1;
      } else if (target <= 0) {
        // All-out: liquidate
        if (btcBal > BTC_DUST) {
          action = "SELL";
          amountPct = 1;
          tradesCount++;
          sellBtc(btcBal, px, tradeDate, rule);
        }
        position = "cash";
        currentAlloc = 0;
      } else {
        // Partial allocation (ideas 2): rebalance only when drift exceeds the band
        const nav = navNow(px);
        const desiredBtcUsd = target * nav;
        const delta = desiredBtcUsd - btcBal * px;
        const band = Math.max(USDT_DUST, REBALANCE_BAND * nav);
        const allocChanged = Math.abs(target - currentAlloc) > 1e-9;
        if (delta > band || (allocChanged && delta > USDT_DUST)) {
          ensureUsdt(delta, tradeDate);
          const tradeUsdt = Math.min(delta, Math.max(0, usdtBal));
          if (tradeUsdt > USDT_DUST) {
            action = "BUY";
            amountPct = (usdtBal + usdpcBal * usdpcPriceToday + tradeUsdt) > 0 ? tradeUsdt / (usdtBal + usdpcBal * usdpcPriceToday + tradeUsdt) : 1;
            if (!allocChanged) { rule = `Rebalance to ${Math.round(target * 100)}% BTC`; note = `drift ${(delta / nav * 100).toFixed(1)}% of NAV`; }
            else tradesCount++;
            buyBtc(tradeUsdt, px, tradeDate, rule);
          }
        } else if (delta < -band || (allocChanged && delta < -USDT_DUST)) {
          const btcToSell = Math.min(btcBal, -delta / px);
          if (btcToSell * px > USDT_DUST) {
            action = "SELL";
            amountPct = btcBal > 0 ? btcToSell / btcBal : 1;
            if (!allocChanged) { rule = `Rebalance to ${Math.round(target * 100)}% BTC`; note = `drift ${(delta / nav * 100).toFixed(1)}% of NAV`; }
            else tradesCount++;
            sellBtc(btcToSell, px, tradeDate, rule);
          }
        }
        position = exec.position;
        currentAlloc = target;
      }
    }
    if (position !== "cash") daysInMarket++;

    // 4) Monthly BitWealth fees (performance w/ high-water mark; management on NAV)
    let performanceFeeThisMonth = 0;
    if (monthKey !== lastMonthForPerfFee && lastMonthForPerfFee !== null) {
      const currentNav = navNow(px);
      const contribSinceHWM = contribNetCum - hwmContribNetCum;
      const navForPerfFee = currentNav - contribSinceHWM;
      if (navForPerfFee > highWaterMark && p.performanceFeeRate > 0) {
        performanceFeeThisMonth = (navForPerfFee - highWaterMark) * p.performanceFeeRate;
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
      if (p.feePlan === "management" && p.managementFeeRate > 0) {
        const mgmtFee = Math.max(0, navNow(px) * p.managementFeeRate / 12);
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

    // 6) Daily results + metrics
    const nav = navNow(px);
    if (i > 0 && prevNav > 0) {
      const base = prevNav + contribNetToday;
      const r = base > 0 ? nav / base - 1 : 0;
      unitIndex *= 1 + r;
      if (unitIndex > unitPeak) unitPeak = unitIndex;
      const dd = unitIndex / unitPeak - 1;
      if (dd < maxDD) maxDD = dd;
      retSum += r; retSumSq += r * r; retN++;
    }
    prevNav = nav;

    const roiPct = computeRoi(nav, contribGrossCum);
    const cagrPct = computeCagr(nav, contribGrossCum, firstContribDate, tradeDate);

    if (wantDaily || i === prices.length - 1) {
      results.push({
        close_date: tradeDate, trade_date: tradeDate, signal_date: signalDate,
        action, amount_pct: amountPct, rule, note,
        position_state: position,
        cap_latch: state.capLatch, trend_latch: state.trendLatch,
        signal_in_market: todaySignal.inMarket,
        target_alloc: currentAlloc,
        roc,
        btc_balance: btcBal, usdt_balance: usdtBal, nav_usd: nav,
        price_usd: px, sth_cost_basis_usd: cb,
        price_to_cb_ratio: cb > 0 ? px / cb : null,
        contrib_gross_usdt_cum: contribGrossCum, contrib_fee_usdt_cum: contribFeeCum, contrib_net_usdt_cum: contribNetCum,
        total_roi_percent: roiPct,
        cagr_percent: cagrPct,
        platform_fees_paid_usdt: platformFeeToday,
        performance_fees_paid_usdt: performanceFeeThisMonth,
        exchange_fees_paid_btc: exchangeFeeBtcToday,
        exchange_fees_paid_usdt: exchangeFeeUsdtToday,
        high_water_mark_usdt: highWaterMark,
        usdpc_balance: usdpcBal,
        usdpc_price_usd: p.usdpcEnabled ? usdpcPriceToday : null,
        usdpc_yield_usdt: usdpcYieldToday,
        usdpc_conversion_fee_usdt: usdpcConvFeeToday,
      });
    }

    if (wantBench && (wantDaily || i === prices.length - 1)) {
      const stdNav = stdUsdtBal + stdBtcBal * px;
      stdBalances.push({
        close_date: tradeDate, trade_date: tradeDate,
        btc_balance: stdBtcBal, usdt_balance: stdUsdtBal, nav_usd: stdNav,
        contrib_gross_usdt_cum: stdContribGrossCum, contrib_fee_usdt_cum: stdContribFeeCum, contrib_net_usdt_cum: stdContribNetCum,
        total_roi_percent: computeRoi(stdNav, stdContribGrossCum),
        cagr_percent: computeCagr(stdNav, stdContribGrossCum, stdFirstContribDate, tradeDate),
        total_exchange_fees_btc: stdExchangeFeesBtcCum, total_exchange_fees_usdt: stdExchangeFeesUsdtCum,
      });
      const hodlNav = hodlBtcBal * px;
      hodlBalances.push({
        close_date: tradeDate, trade_date: tradeDate,
        btc_balance: hodlBtcBal, usdt_balance: 0, nav_usd: hodlNav,
        contrib_gross_usdt_cum: hodlContribGrossCum, contrib_fee_usdt_cum: hodlContribFeeCum, contrib_net_usdt_cum: hodlContribNetCum,
        total_roi_percent: computeRoi(hodlNav, hodlContribGrossCum),
        cagr_percent: computeCagr(hodlNav, hodlContribGrossCum, hodlFirstContribDate, tradeDate),
        total_exchange_fees_btc: hodlExchangeFeesBtcCum, total_exchange_fees_usdt: hodlExchangeFeesUsdtCum,
      });
    }

    pending = todaySignal;
  }

  const last = results[results.length - 1];
  const lastStd = stdBalances[stdBalances.length - 1];
  const lastHodl = hodlBalances[hodlBalances.length - 1];
  const meanR = retN > 0 ? retSum / retN : 0;
  const varR = retN > 1 ? Math.max(0, retSumSq / retN - meanR * meanR) : 0;
  const sharpe = varR > 0 ? (meanR / Math.sqrt(varR)) * Math.sqrt(365) : 0;
  const cagr = last.cagr_percent;

  const metrics: SthCbMetrics = {
    final_nav_usd: last.nav_usd,
    final_roi_percent: last.total_roi_percent,
    final_cagr_percent: cagr,
    total_contrib_gross_usdt: last.contrib_gross_usdt_cum,
    trades: tradesCount,
    days: prices.length,
    pct_time_in_market: prices.length ? Math.round((daysInMarket / prices.length) * 10_000) / 100 : 0,
    max_drawdown: maxDD,
    calmar: maxDD < 0 ? cagr / 100 / Math.abs(maxDD) : (cagr > 0 ? Infinity : 0),
    sharpe,
    nav_vs_hodl: lastHodl && lastHodl.nav_usd > 0 ? last.nav_usd / lastHodl.nav_usd : NaN,
    nav_vs_std_dca: lastStd && lastStd.nav_usd > 0 ? last.nav_usd / lastStd.nav_usd : NaN,
    fees: {
      exchange_btc: exchangeFeesBtcCum, exchange_usdt: exchangeFeesUsdtCum,
      platform_or_mgmt_usdt: platformFeesCum, performance_usdt: performanceFeesCum,
      usdpc_conversion_usdt: usdpcConvFeeCum,
    },
  };

  return {
    results,
    ledger: ledgerRows,
    stdBalances,
    stdLedger,
    hodlBalances,
    hodlLedger,
    summary: {
      sth_cb: metrics,
      std_dca: lastStd ? { final_nav_usd: lastStd.nav_usd, final_roi_percent: lastStd.total_roi_percent, final_cagr_percent: lastStd.cagr_percent } : null,
      hodl: lastHodl ? { final_nav_usd: lastHodl.nav_usd, final_roi_percent: lastHodl.total_roi_percent, final_cagr_percent: lastHodl.cagr_percent, total_contrib_gross_usdt: lastHodl.contrib_gross_usdt_cum } : null,
      warmup: { rows: warmupCount, from: warmup[0]?.close_date ?? null, state_at_start: stateAtStart },
    },
  };
}
