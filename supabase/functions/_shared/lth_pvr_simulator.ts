/**
 * LTH PVR Strategy Simulator Module
 * 
 * Runs simulations of the LTH PVR BTC DCA strategy with configurable parameters.
 * Used by both the simulator edge function (ef_run_lth_pvr_simulator) and the
 * optimizer (ef_optimize_lth_pvr_strategy).
 * 
 * Key differences from ef_bt_execute:
 * - Returns results as objects (not database inserts)
 * - More modular (extractable functions)
 * - Supports both single config simulation and batch optimization
 * - Includes additional metrics (Sharpe ratio, cash drag, max drawdown)
 * 
 * Fee Structure (matches back-tester):
 * - Platform fee: 0.75% on contributions (charged in USDT)
 * - Exchange contribution fee: 18 bps (0.18%) on USDT/ZAR conversion
 * - Exchange trade fee: 8 bps (0.08%) on BTC/USDT trades (charged in BTC for BUY/SELL)
 * - Performance fee: 10% on NAV gains above high-water mark (monthly, charged in USDT)
 * 
 * @module lth_pvr_simulator
 * @version 1.0.0
 * @created 2026-02-21
 */

import { decideTrade, bucketLabel, StrategyConfig } from "./lth_pvr_strategy_logic.ts";
import { syntheticUsdpcPrice, sizeUsdpcToUsdt, sizeUsdtToUsdpc } from "./usdpc.ts";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Simulation parameters (investment amounts, fee rates, org context)
 */
export interface SimulationParams {
  /** Initial upfront investment (USD) */
  upfront_usd: number;
  
  /** Monthly recurring investment (USD) */
  monthly_usd: number;
  
  /** Organization ID */
  org_id: string;
  
  /** Platform fee rate (0.0075 = 0.75%) */
  platform_fee_rate?: number;
  
  /** Exchange trade fee rate (0.0008 = 8 bps) */
  trade_fee_rate?: number;
  
  /** Performance fee rate (0.10 = 10%) */
  performance_fee_rate?: number;
  
  /** Exchange contribution fee rate (0.0018 = 18 bps) */
  contrib_fee_rate?: number;

  /**
   * Financial simulation start date (YYYY-MM-DD).
   * Rows before this date are used ONLY to warm up the LTH state machine
   * (bear_pause, retrace eligibility) but no contributions or trades are applied.
   * This ensures bear_pause is correctly initialised when the test window begins
   * mid-cycle (e.g. starting in 2022 when bear_pause was entered in late 2021).
   */
  sim_start_date?: string;

  /** Enable USDPC yield-stablecoin modelling (idle USDT swept to USDPC). */
  usdpc_enabled?: boolean;
  /** USDPC annual percentage yield (0.10 = 10%), compounded daily. */
  usdpc_apy?: number;
  /** USDPC conversion taker fee rate (0.001 = 0.1%). */
  usdpc_conversion_fee_rate?: number;
}

/**
 * CI band data for a single date
 */
export interface CIBandData {
  close_date: string;
  btc_price_usd: number | string;
  price_at_mean?: number | string;
  price_at_m025?: number | string;
  price_at_m050?: number | string;
  price_at_m075?: number | string;
  price_at_m100?: number | string;
  price_at_p025?: number | string;
  price_at_p050?: number | string;
  price_at_p075?: number | string;
  price_at_p100?: number | string;
  price_at_p125?: number | string;
  price_at_p150?: number | string;
  price_at_p175?: number | string;
  price_at_p200?: number | string;
  price_at_p250?: number | string;
  bear_pause?: boolean | null;
  [key: string]: any; // Allow additional properties
}

/**
 * Daily ledger entry (contribution, buy, sell, or fee)
 */
export interface LedgerEntry {
  trade_date: string;
  close_date: string;
  kind: "contrib" | "buy" | "sell" | "fee" | "convert";
  amount_btc: number;
  amount_usdt: number;
  fee_btc: number;
  fee_usdt: number;
  amount_usdpc?: number;
  fee_usdpc?: number;
  note: string;
}

/**
 * Daily simulation results (balances, NAV, performance metrics)
 */
export interface DailyResult {
  trade_date: string;
  close_date: string;
  action: string;
  amount_pct: number;
  rule: string;
  note: string;
  btc_balance: number;
  usdt_balance: number;
  nav_usd: number;
  price_usd: number;
  band_bucket: string;
  contrib_gross_usdt_cum: number;
  contrib_net_usdt_cum: number;
  total_roi_percent: number;
  cagr_percent: number;
  platform_fees_paid_usdt: number;
  performance_fees_paid_usdt: number;
  exchange_fees_paid_btc: number;
  exchange_fees_paid_usdt: number;
  high_water_mark_usdt: number;
  usdpc_balance?: number;
  usdpc_price_usd?: number | null;
  usdpc_yield_usdt?: number;
  usdpc_conversion_fee_usdt?: number;
}

/**
 * LTH PVR state (bear pause, retrace eligibility)
 */
export interface LTHState {
  bear_pause: boolean;
  was_above_p1: boolean;
  was_above_p15: boolean;
  r1_armed: boolean;
  r15_armed: boolean;
}

/**
 * Simulation results (summary + daily data)
 */
export interface SimulationResult {
  // Summary metrics
  final_nav_usd: number;
  final_roi_percent: number;
  final_cagr_percent: number;
  max_drawdown_percent: number;
  sharpe_ratio: number;
  cash_drag_percent: number;
  
  // Cumulative totals
  total_contrib_gross_usdt: number;
  total_contrib_net_usdt: number;
  total_platform_fees_usdt: number;
  total_performance_fees_usdt: number;
  total_exchange_fees_btc: number;
  total_exchange_fees_usdt: number;
  
  // Final balances
  final_btc_balance: number;
  final_usdt_balance: number;
  final_usdpc_balance?: number;
  total_usdpc_conversion_fees_usdt?: number;
  
  // Date range
  start_date: string;
  end_date: string;
  days: number;
  
  // Daily results
  daily: DailyResult[];
  
  // Ledger entries
  ledger: LedgerEntry[];

  // Standard DCA benchmark (buy-and-hold, same contribution schedule, same exchange fees, no platform/performance fees)
  std_dca_final_nav_usd: number;
  std_dca_final_roi_percent: number;
  std_dca_final_cagr_percent: number;
  std_dca_max_drawdown_percent: number;
  std_dca_sharpe_ratio: number;
  std_dca_total_contrib_gross_usdt: number;
  std_dca_daily: { trade_date: string; nav_usd: number; contrib_gross_usdt_cum: number; }[];

  // HODL benchmark (lump-sum buy-and-hold: deposit the FULL scheduled contribution PV on day 1,
  // pay the same VALR exchange fees (contrib + trade) once, never sell. No platform/performance fees.)
  hodl_final_nav_usd: number;
  hodl_final_roi_percent: number;
  hodl_final_cagr_percent: number;
  hodl_max_drawdown_percent: number;
  hodl_sharpe_ratio: number;
  hodl_total_contrib_gross_usdt: number;
  hodl_daily: { trade_date: string; nav_usd: number; contrib_gross_usdt_cum: number; }[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Safely coerce values to numbers
 */
const toNum = (v: any, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

/**
 * Compute simple ROC_n using btc_price_usd
 */
function computeRocSeries(rows: CIBandData[], len: number): number[] {
  const out = new Array(rows.length).fill(0);
  if (len <= 0) return out;
  
  for (let i = 0; i < rows.length; i++) {
    if (i < len) continue;
    
    const pxNow = toNum(rows[i].btc_price_usd, 0);
    const pxPrev = toNum(rows[i - len].btc_price_usd, 0);
    
    if (pxNow > 0 && pxPrev > 0) {
      out[i] = pxNow / pxPrev - 1;
    }
  }
  
  return out;
}

/**
 * Sync bear_pause state from CI band row
 */
function syncBearPauseFromRow(prev: LTHState, row: CIBandData): LTHState {
  const next: LTHState = {
    bear_pause: false,
    was_above_p1: false,
    was_above_p15: false,
    r1_armed: false,
    r15_armed: false,
    ...(prev || {})
  };
  
  if (!row || typeof row.bear_pause === "undefined" || row.bear_pause === null) {
    return next;
  }
  
  const prevPause = !!next.bear_pause;
  const nowPause = !!row.bear_pause;
  
  // When we *enter* bear pause on this row, clear retrace eligibility
  if (!prevPause && nowPause) {
    next.was_above_p1 = false;
    next.was_above_p15 = false;
    next.r1_armed = false;
    next.r15_armed = false;
  }
  
  next.bear_pause = nowPause;
  return next;
}

/**
 * Compute ROI based on gross contributions
 */
function computeRoi(nav: number, contribGrossCum: number): number {
  if (contribGrossCum <= 0) return 0;
  return (nav / contribGrossCum - 1) * 100;
}

/**
 * Compute CAGR based on gross contributions
 */
function computeCagr(nav: number, contribGrossCum: number, firstDate: string | null, currentDate: string): number {
  if (contribGrossCum <= 0 || !firstDate) return 0;
  
  const t0 = new Date(firstDate).getTime();
  const t1 = new Date(currentDate).getTime();
  const days = (t1 - t0) / (1000 * 3600 * 24);
  
  if (!Number.isFinite(days) || days <= 0) return 0;
  
  const ratio = nav / contribGrossCum;
  if (ratio <= 0) return 0;
  
  const years = days / 365;
  if (years <= 0) return 0;
  
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

// =============================================================================
// Main Simulation Functions
// =============================================================================

/**
 * Run a complete simulation with given configuration
 * 
 * @param config - Strategy configuration (B1-B11, bear pause, momentum, retrace)
 * @param ciData - CI band daily data (sorted by close_date ascending)
 * @param params - Simulation parameters (upfront, monthly, fees)
 * @returns Simulation results with summary metrics and daily data
 */
export function runSimulation(
  config: StrategyConfig,
  ciData: CIBandData[],
  params: SimulationParams
): SimulationResult {
  // Default fee rates
  const platformFeeRate = params.platform_fee_rate ?? 0.0075; // 0.75%
  const tradeFeeRate = params.trade_fee_rate ?? 0.0008; // 8 bps
  const performanceFeeRate = params.performance_fee_rate ?? 0.10; // 10%
  const contribFeeRate = params.contrib_fee_rate ?? 0.0018; // 18 bps

  // USDPC yield-stablecoin modelling (LTH PVR only; benchmarks stay plain cash).
  const usdpcEnabled = !!params.usdpc_enabled;
  const usdpcApy = params.usdpc_apy ?? 0.10;                       // 10% p.a.
  const usdpcConvFee = params.usdpc_conversion_fee_rate ?? 0.001;  // 0.1% taker
  const usdpcMinOrderUsdt = 5; // dust threshold
  
  // Resolve the first date for financial activity (contributions + trades).
  // If sim_start_date is provided, rows before it are warmup-only.
  const simStartDate = params.sim_start_date ?? null;

  // Pre-compute ROC series for momentum filter (over full dataset incl. warmup)
  const rocSeries = computeRocSeries(ciData, config.momentumLength);
  
  // ─────────────────────────────────────────────────────────
  // WARMUP PASS: run the state machine over any rows that
  // precede sim_start_date so bear_pause / retrace flags
  // reflect real historical context before the test window.
  // ─────────────────────────────────────────────────────────
  let lthState: LTHState = {
    bear_pause: false,
    was_above_p1: false,
    was_above_p15: false,
    r1_armed: false,
    r15_armed: false
  };

  if (simStartDate) {
    for (const row of ciData) {
      if (row.close_date >= simStartDate) break;
      // Only update state, no financial operations
      lthState = syncBearPauseFromRow(lthState, row);
      const px = toNum(row.btc_price_usd, 0);
      if (px > 0) {
        const roc5 = 0; // momentum not tracked during warmup
        const d = decideTrade(px, row, roc5, lthState, config);
        lthState = d.state || lthState;
      }
    }
    console.info(`Warmup complete: bear_pause=${lthState.bear_pause} was_above_p1=${lthState.was_above_p1} was_above_p15=${lthState.was_above_p15}`);
  }

  // Initialize state
  let btcBal = 0;
  let usdtBal = 0;
  let contribGrossCum = 0;
  let contribFeeCum = 0;
  let contribNetCum = 0;
  let platformFeesCum = 0;
  let performanceFeesCum = 0;
  let highWaterMark = 0;
  let hwmContribNetCum = 0;
  let exchangeFeesBtcCum = 0;
  let exchangeFeesUsdtCum = 0;
  let firstContribDate: string | null = null;
  let lastMonthForPerfFee: string | null = null;
  // USDPC yield-stablecoin state (LTH PVR only)
  let usdpcBal = 0;
  let prevUsdpcPrice = 1;
  let usdpcConvFeeCum = 0;
  
  // Standard DCA benchmark state (same contribution schedule, exchange fees only, immediate buy, never sell)
  let stdBtcBal = 0;
  let stdContribGrossCum = 0;
  let stdFirstContribDate: string | null = null;
  const stdDcaDaily: { trade_date: string; nav_usd: number; contrib_gross_usdt_cum: number; }[] = [];

  // HODL benchmark state (lump-sum on day 1 = sum of upfront + all scheduled monthly contributions,
  // same exchange fees as other strategies, never sells, no platform/performance fees).
  // Total contributions = upfront + monthly_usd × number_of_months_in_window.
  // We compute the month count from the financial window (sim_start_date → end of ciData).
  let hodlBtcBal = 0;
  let hodlContribGrossCum = 0;
  let hodlFirstContribDate: string | null = null;
  const hodlDaily: { trade_date: string; nav_usd: number; contrib_gross_usdt_cum: number; }[] = [];

  const daily: DailyResult[] = [];
  const ledger: LedgerEntry[] = [];
  
  // lthState is already initialised by the warmup pass above.
  // (If no warmup, it was initialised to all-false above.)
  
  let lastMonth: string | null = null;
  
  // Main simulation loop — skip warmup rows, but keep rocSeries index aligned
  const warmupCount = simStartDate
    ? Math.max(0, ciData.findIndex(r => r.close_date >= simStartDate))
    : 0;
  const financialRows = simStartDate
    ? ciData.filter(r => r.close_date >= simStartDate)
    : ciData;

  // Pre-compute HODL lump-sum: upfront + (monthly × number of distinct months in financial window).
  // This represents the total nominal cash an investor would deposit on day 1 to replicate the
  // scheduled contribution stream of the LTH PVR / Std DCA participants.
  const hodlMonthCount = (() => {
    const months = new Set<string>();
    for (const r of financialRows) months.add(r.close_date.slice(0, 7));
    return months.size;
  })();
  const hodlLumpSumUsdt = (params.upfront_usd ?? 0) + (params.monthly_usd ?? 0) * hodlMonthCount;

  for (let i = 0; i < financialRows.length; i++) {
    const row = financialRows[i];
    const tradeDate = row.close_date;
    const closeDate = row.close_date;
    const px = toNum(row.btc_price_usd, 0);
    const monthKey = tradeDate.slice(0, 7); // YYYY-MM
    
    // Reset daily fee trackers
    let platformFeeToday = 0;
    let performanceFeeToday = 0;
    let exchangeFeeBtcToday = 0;
    let exchangeFeeUsdtToday = 0;

    // USDPC: synthetic price + yield accrued on the holding carried into today.
    let usdpcConvFeeToday = 0;
    let usdpcPriceToday = 1;
    let usdpcYieldToday = 0;
    if (usdpcEnabled) {
      const daysFromStart = Math.max(0, Math.round(
        (new Date(tradeDate).getTime() - new Date(financialRows[0].close_date).getTime()) / 86400000));
      usdpcPriceToday = syntheticUsdpcPrice(daysFromStart, usdpcApy, 1);
      usdpcYieldToday = usdpcBal * (usdpcPriceToday - prevUsdpcPrice);
    }
    // Convert just-enough USDPC -> USDT so idle USDT covers `needed`.
    const ensureUsdtSim = (needed: number) => {
      if (!usdpcEnabled || usdpcBal <= 0 || usdtBal >= needed) return;
      const r = sizeUsdpcToUsdt(needed - usdtBal, usdpcBal, usdpcPriceToday, usdpcConvFee);
      if (r.usdpcToSell <= 0) return;
      usdpcBal -= r.usdpcToSell;
      usdtBal += r.usdtReceived;
      usdpcConvFeeCum += r.feeUsdt;
      usdpcConvFeeToday += r.feeUsdt;
      ledger.push({
        trade_date: tradeDate, close_date: closeDate, kind: "convert",
        amount_btc: 0, amount_usdt: r.usdtReceived, fee_btc: 0, fee_usdt: r.feeUsdt,
        amount_usdpc: -r.usdpcToSell, fee_usdpc: 0,
        note: "USDPC->USDT conversion (fund buy/fee)"
      });
    };
    // Sweep all idle USDT (above dust) into USDPC at end of day.
    const sweepUsdtSim = () => {
      if (!usdpcEnabled || usdtBal < usdpcMinOrderUsdt) return;
      const r = sizeUsdtToUsdpc(usdtBal, usdpcPriceToday, usdpcConvFee);
      if (r.usdpcReceived <= 0) return;
      const sweptUsdt = usdtBal;
      const feeUsdtEquiv = r.feeUsdpc * usdpcPriceToday;
      usdpcBal += r.usdpcReceived;
      usdtBal = 0;
      usdpcConvFeeCum += feeUsdtEquiv;
      usdpcConvFeeToday += feeUsdtEquiv;
      ledger.push({
        trade_date: tradeDate, close_date: closeDate, kind: "convert",
        amount_btc: 0, amount_usdt: -sweptUsdt, fee_btc: 0, fee_usdt: 0,
        amount_usdpc: r.usdpcReceived, fee_usdpc: r.feeUsdpc,
        note: "USDT->USDPC sweep (idle cash to yield)"
      });
    };
    
    // Contributions: upfront on first day, monthly on first day of month
    let grossContribToday = 0;
    if (i === 0 && params.upfront_usd > 0) {
      grossContribToday += params.upfront_usd;
    }
    if (params.monthly_usd > 0 && monthKey !== lastMonth) {
      grossContribToday += params.monthly_usd;
    }
    lastMonth = monthKey;

    // --- Standard DCA benchmark contribution + immediate buy ---
    if (grossContribToday > 0 && px > 0) {
      const stdExchangeFee = grossContribToday * contribFeeRate;
      const stdNet = grossContribToday - stdExchangeFee;
      if (stdNet > 0) {
        const stdTradeBtcGross = stdNet / px;
        const stdFeeBtc = stdTradeBtcGross * tradeFeeRate;
        stdBtcBal += stdTradeBtcGross - stdFeeBtc;
        stdContribGrossCum += grossContribToday;
        if (!stdFirstContribDate) stdFirstContribDate = tradeDate;
      }
    }

    // --- HODL benchmark: single lump-sum buy on day 1, then never trades again ---
    if (i === 0 && hodlLumpSumUsdt > 0 && px > 0) {
      const hodlExchangeFee = hodlLumpSumUsdt * contribFeeRate;
      const hodlNet = hodlLumpSumUsdt - hodlExchangeFee;
      if (hodlNet > 0) {
        const hodlTradeBtcGross = hodlNet / px;
        const hodlFeeBtc = hodlTradeBtcGross * tradeFeeRate;
        hodlBtcBal += hodlTradeBtcGross - hodlFeeBtc;
        hodlContribGrossCum += hodlLumpSumUsdt;
        hodlFirstContribDate = tradeDate;
      }
    }

    // Apply contribution
    if (grossContribToday > 0) {
      // Step 1: Deduct VALR USDT/ZAR exchange fee (18 bps)
      const exchangeFee = grossContribToday * contribFeeRate;
      const afterExchangeFee = grossContribToday - exchangeFee;
      
      // Step 2: Deduct BitWealth platform fee (0.75%)
      const platformFee = afterExchangeFee * platformFeeRate;
      const net = afterExchangeFee - platformFee;
      
      usdtBal += net;
      contribGrossCum += grossContribToday;
      contribFeeCum += exchangeFee;
      platformFeesCum += platformFee;
      platformFeeToday += platformFee;
      exchangeFeesUsdtCum += exchangeFee;
      exchangeFeeUsdtToday += exchangeFee;
      contribNetCum += net;
      
      if (!firstContribDate) firstContribDate = tradeDate;
      
      ledger.push({
        trade_date: tradeDate,
        close_date: closeDate,
        kind: "contrib",
        amount_btc: 0,
        amount_usdt: net,
        fee_btc: 0,
        fee_usdt: 0,
        note: `Contribution: $${grossContribToday.toFixed(2)} (net $${net.toFixed(2)} after fees)`
      });
      
      // Record platform fee
      if (platformFee > 0) {
        ledger.push({
          trade_date: tradeDate,
          close_date: closeDate,
          kind: "fee",
          amount_btc: 0,
          amount_usdt: 0,
          fee_btc: 0,
          fee_usdt: platformFee,
          note: "BitWealth platform fee (0.75%)"
        });
      }
      
      // Record exchange contribution fee
      if (exchangeFee > 0) {
        ledger.push({
          trade_date: tradeDate,
          close_date: closeDate,
          kind: "fee",
          amount_btc: 0,
          amount_usdt: 0,
          fee_btc: 0,
          fee_usdt: exchangeFee,
          note: "VALR USDT/ZAR conversion fee (18 bps)"
        });
      }
    }
    
    // LTH PVR decision
    const roc5 = rocSeries[warmupCount + i] ?? 0;
    
    // Sync precomputed bear_pause from CI view into state
    lthState = syncBearPauseFromRow(lthState, row);
    
    const decision = decideTrade(px, row, roc5, lthState, config);
    lthState = decision.state || lthState;
    
    // Execute BUY order
    if (decision.action === "BUY" && decision.pct > 0 && px > 0) {
      // Buying power includes USDPC value for usdpc_enabled portfolios; convert
      // just-enough USDPC->USDT to fund the buy before placing it.
      const baseUsdt = usdpcEnabled ? (usdtBal + usdpcBal * usdpcPriceToday) : usdtBal;
      let tradeUsdt = baseUsdt * decision.pct;
      if (usdpcEnabled && tradeUsdt > usdtBal) {
        ensureUsdtSim(tradeUsdt);
        if (tradeUsdt > usdtBal) tradeUsdt = usdtBal; // cap if USDPC couldn't fully cover
      }

      if (tradeUsdt > 0) {
        const tradeBtcGross = tradeUsdt / px;
        const feeBtc = tradeBtcGross * tradeFeeRate; // VALR BTC/USDT exchange fee in BTC
        const btcNet = tradeBtcGross - feeBtc;
        
        usdtBal -= tradeUsdt;
        btcBal += btcNet;
        exchangeFeesBtcCum += feeBtc;
        exchangeFeeBtcToday += feeBtc;
        
        ledger.push({
          trade_date: tradeDate,
          close_date: closeDate,
          kind: "buy",
          amount_btc: btcNet,
          amount_usdt: tradeUsdt,
          fee_btc: 0,
          fee_usdt: 0,
          note: decision.rule
        });
        
        if (feeBtc > 0) {
          ledger.push({
            trade_date: tradeDate,
            close_date: closeDate,
            kind: "fee",
            amount_btc: 0,
            amount_usdt: 0,
            fee_btc: feeBtc,
            fee_usdt: 0,
            note: "VALR BTC/USDT trade fee (BUY)"
          });
        }
      }
    }
    
    // Execute SELL order
    else if (decision.action === "SELL" && decision.pct > 0 && px > 0) {
      const baseBtc = btcBal;
      const tradeBtcGross = baseBtc * decision.pct;
      
      if (tradeBtcGross > 0) {
        const feeBtc = tradeBtcGross * tradeFeeRate; // VALR BTC/USDT exchange fee in BTC
        const grossUsdt = tradeBtcGross * px;
        
        btcBal -= tradeBtcGross + feeBtc;
        usdtBal += grossUsdt;
        exchangeFeesBtcCum += feeBtc;
        exchangeFeeBtcToday += feeBtc;
        
        ledger.push({
          trade_date: tradeDate,
          close_date: closeDate,
          kind: "sell",
          amount_btc: tradeBtcGross,
          amount_usdt: grossUsdt,
          fee_btc: 0,
          fee_usdt: 0,
          note: decision.rule
        });
        
        if (feeBtc > 0) {
          ledger.push({
            trade_date: tradeDate,
            close_date: closeDate,
            kind: "fee",
            amount_btc: 0,
            amount_usdt: 0,
            fee_btc: feeBtc,
            fee_usdt: 0,
            note: "VALR BTC/USDT trade fee (SELL)"
          });
        }
      }
    }
    
    // Monthly performance fee calculation (high-water mark)
    const isNewMonth = (monthKey !== lastMonthForPerfFee);
    const isNotFirstMonth = (lastMonthForPerfFee !== null);
    
    if (isNewMonth && isNotFirstMonth) {
      const currentNav = usdtBal + btcBal * px + usdpcBal * usdpcPriceToday;
      const contribSinceHWM = contribNetCum - hwmContribNetCum;
      const navForPerfFee = currentNav - contribSinceHWM;
      
      if (navForPerfFee > highWaterMark && performanceFeeRate > 0) {
        const profitAboveHWM = navForPerfFee - highWaterMark;
        performanceFeeToday = profitAboveHWM * performanceFeeRate;
        
        // Debug logging for performance fees
        if (performanceFeeToday > 100) {
          console.log(`📈 Performance Fee ${tradeDate}: $${performanceFeeToday.toFixed(2)} | HWM: $${highWaterMark.toFixed(2)} → $${navForPerfFee.toFixed(2)} | Profit: $${profitAboveHWM.toFixed(2)}`);
        }
        
        // Ensure USDT covers the fee (convert USDPC if needed), then deduct.
        ensureUsdtSim(performanceFeeToday);
        usdtBal -= performanceFeeToday;
        performanceFeesCum += performanceFeeToday;
        
        ledger.push({
          trade_date: tradeDate,
          close_date: closeDate,
          kind: "fee",
          amount_btc: 0,
          amount_usdt: 0,
          fee_btc: 0,
          fee_usdt: performanceFeeToday,
          note: "BitWealth performance fee (10% on profit above high-water mark)"
        });

        // USDT floor guard: if fee pushed USDT negative, sell BTC to cover shortfall.
        // Mirrors live system behaviour where we manually convert BTC for the customer.
        if (usdtBal < 0 && btcBal > 0 && px > 0) {
          const shortfall = -usdtBal;
          // BTC needed = shortfall / net proceeds per BTC after exchange fee
          const btcToSell = shortfall / (px * (1 - tradeFeeRate));
          const btcSold = Math.min(btcBal, btcToSell);
          const feeBtc = btcSold * tradeFeeRate;
          const usdtReceived = (btcSold - feeBtc) * px;
          btcBal -= btcSold;
          usdtBal += usdtReceived;
          exchangeFeesBtcCum += feeBtc;
          ledger.push({
            trade_date: tradeDate,
            close_date: closeDate,
            kind: "fee",
            amount_btc: -btcSold,
            amount_usdt: usdtReceived,
            fee_btc: feeBtc,
            fee_usdt: 0,
            note: "BTC→USDT conversion to cover performance fee shortfall"
          });
        }

        // Update high-water mark
        const navAfterFee = usdtBal + btcBal * px + usdpcBal * usdpcPriceToday;
        highWaterMark = navAfterFee - contribSinceHWM;
        hwmContribNetCum = contribNetCum;
      } else if (navForPerfFee > highWaterMark) {
        highWaterMark = navForPerfFee;
        hwmContribNetCum = contribNetCum;
      }
    }
    lastMonthForPerfFee = monthKey;
    
    // Initialize high-water mark on first day
    if (i === 0) {
      const initialNav = usdtBal + btcBal * px + usdpcBal * usdpcPriceToday;
      highWaterMark = initialNav;
      hwmContribNetCum = contribNetCum;
    }
    
    // End-of-day: sweep idle USDT into USDPC, then roll the synthetic price forward.
    sweepUsdtSim();
    prevUsdpcPrice = usdpcPriceToday;

    // Calculate daily NAV and performance
    const nav = usdtBal + btcBal * px + usdpcBal * usdpcPriceToday;
    const totalRoi = computeRoi(nav, contribGrossCum);
    const cagr = computeCagr(nav, contribGrossCum, firstContribDate, tradeDate);
    const band_bucket = bucketLabel(px, row);
    
    daily.push({
      trade_date: tradeDate,
      close_date: closeDate,
      action: decision.action,
      amount_pct: decision.pct,
      rule: decision.rule,
      note: decision.note,
      btc_balance: btcBal,
      usdt_balance: usdtBal,
      nav_usd: nav,
      price_usd: px,
      band_bucket,
      contrib_gross_usdt_cum: contribGrossCum,
      contrib_net_usdt_cum: contribNetCum,
      total_roi_percent: totalRoi,
      cagr_percent: cagr,
      platform_fees_paid_usdt: platformFeeToday,
      performance_fees_paid_usdt: performanceFeeToday,
      exchange_fees_paid_btc: exchangeFeeBtcToday,
      exchange_fees_paid_usdt: exchangeFeeUsdtToday,
      high_water_mark_usdt: highWaterMark,
      usdpc_balance: usdpcBal,
      usdpc_price_usd: usdpcEnabled ? usdpcPriceToday : null,
      usdpc_yield_usdt: usdpcYieldToday,
      usdpc_conversion_fee_usdt: usdpcConvFeeToday
    });

    // Standard DCA daily NAV
    stdDcaDaily.push({
      trade_date: tradeDate,
      nav_usd: stdBtcBal * px,
      contrib_gross_usdt_cum: stdContribGrossCum
    });

    // HODL daily NAV (lump-sum was bought on day 0; just mark-to-market)
    hodlDaily.push({
      trade_date: tradeDate,
      nav_usd: hodlBtcBal * px,
      contrib_gross_usdt_cum: hodlContribGrossCum
    });
  }
  
  // Calculate final metrics
  const lastDay = daily[daily.length - 1];
  const metrics = calculateMetrics(daily);

  // Compute Standard DCA summary metrics
  const stdLastDay = stdDcaDaily[stdDcaDaily.length - 1];
  const stdFinalNav = stdLastDay?.nav_usd ?? 0;
  const stdFinalRoi = stdContribGrossCum > 0 ? (stdFinalNav / stdContribGrossCum - 1) * 100 : 0;
  const stdFinalCagr = computeCagr(stdFinalNav, stdContribGrossCum, stdFirstContribDate, stdLastDay?.trade_date ?? "");
  let stdPeak = 0;
  let stdMaxDrawdown = 0;
  for (const d of stdDcaDaily) {
    if (d.nav_usd > stdPeak) stdPeak = d.nav_usd;
    if (stdPeak > 0) {
      const dd = (stdPeak - d.nav_usd) / stdPeak * 100;
      if (dd > stdMaxDrawdown) stdMaxDrawdown = dd;
    }
  }
  const stdSharpe = stdMaxDrawdown > 0 ? stdFinalCagr / stdMaxDrawdown : 0;

  // Compute HODL summary metrics (lump-sum on day 1, never sold).
  // Note: ROI/CAGR are measured against the lump-sum nominal cash deposit
  // (= upfront + monthly × months), so apples-to-apples vs the other strategies.
  const hodlLastDay = hodlDaily[hodlDaily.length - 1];
  const hodlFinalNav = hodlLastDay?.nav_usd ?? 0;
  const hodlFinalRoi = hodlContribGrossCum > 0 ? (hodlFinalNav / hodlContribGrossCum - 1) * 100 : 0;
  const hodlFinalCagr = computeCagr(hodlFinalNav, hodlContribGrossCum, hodlFirstContribDate, hodlLastDay?.trade_date ?? "");
  let hodlPeak = 0;
  let hodlMaxDrawdown = 0;
  for (const d of hodlDaily) {
    if (d.nav_usd > hodlPeak) hodlPeak = d.nav_usd;
    if (hodlPeak > 0) {
      const dd = (hodlPeak - d.nav_usd) / hodlPeak * 100;
      if (dd > hodlMaxDrawdown) hodlMaxDrawdown = dd;
    }
  }
  const hodlSharpe = hodlMaxDrawdown > 0 ? hodlFinalCagr / hodlMaxDrawdown : 0;
  
  // Debug logging: Compare first 5 and last 5 days
  console.log("🔬 Simulator Debug - First 5 days:");
  for (let i = 0; i < Math.min(5, daily.length); i++) {
    const d = daily[i];
    console.log(`  Day ${i}: ${d.trade_date} | Action: ${d.action} ${(d.amount_pct*100).toFixed(1)}% | NAV: $${d.nav_usd.toFixed(2)} | BTC: ${d.btc_balance.toFixed(8)} | USDT: $${d.usdt_balance.toFixed(2)}`);
  }
  console.log("🔬 Simulator Debug - Last 5 days:");
  for (let i = Math.max(0, daily.length - 5); i < daily.length; i++) {
    const d = daily[i];
    console.log(`  Day ${i}: ${d.trade_date} | Action: ${d.action} ${(d.amount_pct*100).toFixed(1)}% | NAV: $${d.nav_usd.toFixed(2)} | BTC: ${d.btc_balance.toFixed(8)} | USDT: $${d.usdt_balance.toFixed(2)}`);
  }
  console.log(`🔬 Final Balances: BTC=${btcBal.toFixed(8)}, USDT=$${usdtBal.toFixed(2)}, NAV=$${(btcBal * (daily[daily.length-1]?.price_usd || 0) + usdtBal).toFixed(2)}`);
  console.log(`🔬 Cumulative Fees: Platform=$${platformFeesCum.toFixed(2)}, Performance=$${performanceFeesCum.toFixed(2)}, ExchBTC=${exchangeFeesBtcCum.toFixed(8)}, ExchUSDT=$${exchangeFeesUsdtCum.toFixed(2)}`);
  
  // Count actions for debugging
  const actionCounts = daily.reduce((acc, d) => {
    acc[d.action] = (acc[d.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return {
    // Summary metrics
    final_nav_usd: lastDay?.nav_usd ?? 0,
    final_roi_percent: lastDay?.total_roi_percent ?? 0,
    final_cagr_percent: lastDay?.cagr_percent ?? 0,
    max_drawdown_percent: metrics.maxDrawdown,
    sharpe_ratio: metrics.sharpe,
    cash_drag_percent: metrics.cashDrag,
    
    // Cumulative totals
    total_contrib_gross_usdt: contribGrossCum,
    total_contrib_net_usdt: contribNetCum,
    total_platform_fees_usdt: platformFeesCum,
    total_performance_fees_usdt: performanceFeesCum,
    total_exchange_fees_btc: exchangeFeesBtcCum,
    total_exchange_fees_usdt: exchangeFeesUsdtCum,
    
    // Final balances
    final_btc_balance: btcBal,
    final_usdt_balance: usdtBal,
    final_usdpc_balance: usdpcBal,
    total_usdpc_conversion_fees_usdt: usdpcConvFeeCum,
    
    // Date range
    start_date: ciData[0]?.close_date ?? "",
    end_date: ciData[ciData.length - 1]?.close_date ?? "",
    days: ciData.length,
    
    // Action counts (for debugging vs back-tester)
    action_counts: actionCounts,
    
    // Daily results
    daily,
    
    // Ledger entries
    ledger,

    // Standard DCA benchmark
    std_dca_final_nav_usd: stdFinalNav,
    std_dca_final_roi_percent: stdFinalRoi,
    std_dca_final_cagr_percent: stdFinalCagr,
    std_dca_max_drawdown_percent: stdMaxDrawdown,
    std_dca_sharpe_ratio: stdSharpe,
    std_dca_total_contrib_gross_usdt: stdContribGrossCum,
    std_dca_daily: stdDcaDaily,

    // HODL benchmark (lump-sum on day 1, never sold)
    hodl_final_nav_usd: hodlFinalNav,
    hodl_final_roi_percent: hodlFinalRoi,
    hodl_final_cagr_percent: hodlFinalCagr,
    hodl_max_drawdown_percent: hodlMaxDrawdown,
    hodl_sharpe_ratio: hodlSharpe,
    hodl_total_contrib_gross_usdt: hodlContribGrossCum,
    hodl_daily: hodlDaily
  };
}

/**
 * Calculate advanced metrics from daily results
 * 
 * @param daily - Array of daily simulation results
 * @returns Object with maxDrawdown, sharpe, and cashDrag
 */
export function calculateMetrics(daily: DailyResult[]): {
  maxDrawdown: number;
  sharpe: number;
  cashDrag: number;
} {
  if (!daily || daily.length === 0) {
    return { maxDrawdown: 0, sharpe: 0, cashDrag: 0 };
  }
  
  // Calculate max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  
  for (const day of daily) {
    if (day.nav_usd > peak) {
      peak = day.nav_usd;
    }
    
    if (peak > 0) {
      const drawdown = (peak - day.nav_usd) / peak * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }
  
  // Calculate Sharpe ratio (approximation: CAGR / MaxDD)
  const finalCagr = daily[daily.length - 1]?.cagr_percent ?? 0;
  const sharpe = maxDrawdown > 0 ? finalCagr / maxDrawdown : 0;
  
  // Calculate cash drag (average USDT / NAV percentage)
  let cashDragSum = 0;
  let cashDragCount = 0;
  
  for (const day of daily) {
    if (day.nav_usd > 0) {
      cashDragSum += (day.usdt_balance / day.nav_usd) * 100;
      cashDragCount++;
    }
  }
  
  const cashDrag = cashDragCount > 0 ? cashDragSum / cashDragCount : 0;
  
  return {
    maxDrawdown,
    sharpe,
    cashDrag
  };
}
