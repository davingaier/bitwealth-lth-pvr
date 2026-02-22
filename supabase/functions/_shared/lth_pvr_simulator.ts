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
  bear_pause?: boolean | null;
  [key: string]: any; // Allow additional properties
}

/**
 * Daily ledger entry (contribution, buy, sell, or fee)
 */
export interface LedgerEntry {
  trade_date: string;
  close_date: string;
  kind: "contrib" | "buy" | "sell" | "fee";
  amount_btc: number;
  amount_usdt: number;
  fee_btc: number;
  fee_usdt: number;
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
  
  // Date range
  start_date: string;
  end_date: string;
  days: number;
  
  // Daily results
  daily: DailyResult[];
  
  // Ledger entries
  ledger: LedgerEntry[];
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
  
  // Pre-compute ROC series for momentum filter
  const rocSeries = computeRocSeries(ciData, config.momentumLength);
  
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
  
  const daily: DailyResult[] = [];
  const ledger: LedgerEntry[] = [];
  
  let lthState: LTHState = {
    bear_pause: false,
    was_above_p1: false,
    was_above_p15: false,
    r1_armed: false,
    r15_armed: false
  };
  
  let lastMonth: string | null = null;
  
  // Main simulation loop
  for (let i = 0; i < ciData.length; i++) {
    const row = ciData[i];
    const tradeDate = row.close_date;
    const closeDate = row.close_date;
    const px = toNum(row.btc_price_usd, 0);
    const monthKey = tradeDate.slice(0, 7); // YYYY-MM
    
    // Reset daily fee trackers
    let platformFeeToday = 0;
    let performanceFeeToday = 0;
    let exchangeFeeBtcToday = 0;
    let exchangeFeeUsdtToday = 0;
    
    // Contributions: upfront on first day, monthly on first day of month
    let grossContribToday = 0;
    if (i === 0 && params.upfront_usd > 0) {
      grossContribToday += params.upfront_usd;
    }
    if (params.monthly_usd > 0 && monthKey !== lastMonth) {
      grossContribToday += params.monthly_usd;
    }
    lastMonth = monthKey;
    
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
    const roc5 = rocSeries[i] ?? 0;
    
    // Sync precomputed bear_pause from CI view into state
    lthState = syncBearPauseFromRow(lthState, row);
    
    const decision = decideTrade(px, row, roc5, lthState, config);
    lthState = decision.state || lthState;
    
    // Execute BUY order
    if (decision.action === "BUY" && decision.pct > 0 && px > 0) {
      const baseUsdt = usdtBal;
      const tradeUsdt = baseUsdt * decision.pct;
      
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
      const currentNav = usdtBal + btcBal * px;
      const contribSinceHWM = contribNetCum - hwmContribNetCum;
      const navForPerfFee = currentNav - contribSinceHWM;
      
      if (navForPerfFee > highWaterMark && performanceFeeRate > 0) {
        const profitAboveHWM = navForPerfFee - highWaterMark;
        performanceFeeToday = profitAboveHWM * performanceFeeRate;
        
        // Deduct performance fee from USDT balance
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
        
        // Update high-water mark
        const navAfterFee = usdtBal + btcBal * px;
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
      const initialNav = usdtBal + btcBal * px;
      highWaterMark = initialNav;
      hwmContribNetCum = contribNetCum;
    }
    
    // Calculate daily NAV and performance
    const nav = usdtBal + btcBal * px;
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
      high_water_mark_usdt: highWaterMark
    });
  }
  
  // Calculate final metrics
  const lastDay = daily[daily.length - 1];
  const metrics = calculateMetrics(daily);
  
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
    
    // Date range
    start_date: ciData[0]?.close_date ?? "",
    end_date: ciData[ciData.length - 1]?.close_date ?? "",
    days: ciData.length,
    
    // Daily results
    daily,
    
    // Ledger entries
    ledger
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
