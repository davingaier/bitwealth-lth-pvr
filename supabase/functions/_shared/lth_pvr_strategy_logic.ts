// lth_pvr_strategy_logic.ts
// Shared LTH PVR trading logic - single source of truth
// Used by: ef_generate_decisions (live trading), ef_bt_execute (back-testing), ef_run_lth_pvr_simulator

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// ========================================================================================
// TYPES & INTERFACES
// ========================================================================================

export interface StrategyConfig {
  // Order sizes (as decimal fractions, e.g., 0.22796 = 22.796%)
  B: {
    B1: number;  // Buy tier 1: < -1.0σ
    B2: number;  // Buy tier 2: -1.0σ ... -0.75σ
    B3: number;  // Buy tier 3: -0.75σ ... -0.5σ
    B4: number;  // Buy tier 4: -0.5σ ... -0.25σ
    B5: number;  // Buy tier 5: -0.25σ ... mean
    B6: number;  // Sell tier 1: mean ... +0.5σ
    B7: number;  // Sell tier 2: +0.5σ ... +1.0σ
    B8: number;  // Sell tier 3: +1.0σ ... +1.5σ
    B9: number;  // Sell tier 4: +1.5σ ... +2.0σ
    B10: number; // Sell tier 5: +2.0σ ... +2.5σ
    B11: number; // Sell tier 6: > +2.5σ
  };

  // Bear pause configuration (in sigma units)
  // All variations ENTER pause at +2.0σ, but EXIT at different thresholds
  bearPauseEnterSigma: number;  // e.g., 2.0 (enter pause when price > +2.0σ)
  bearPauseExitSigma: number;   // e.g., -1.0 for Progressive, -0.75 for Balanced, 0.0 for Conservative

  // Momentum configuration
  momentumLength: number;       // e.g., 5 (days for ROC calculation)
  momentumThreshold: number;    // e.g., 0.0 (0% - sell only if ROC > threshold)

  // Retrace configuration
  enableRetrace: boolean;       // e.g., true (enable retrace exception buys)
}

export interface TradingState {
  bear_pause: boolean;
  was_above_p1: boolean;   // Was in +1.0σ ... +1.5σ range
  was_above_p15: boolean;  // Was in +1.5σ ...2.0σ range
  r1_armed: boolean;       // Retrace eligibility armed for +1.0σ case
  r15_armed: boolean;      // Retrace eligibility armed for +1.5σ case
}

export interface TradeDecision {
  action: "BUY" | "SELL" | "HOLD";
  pct: number;             // Decimal fraction (0.22796 = 22.796%)
  rule: string;            // e.g., "Base 1"
  note: string;            // Human-readable explanation
  state: TradingState;     // Updated state for next day
}

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Check if value is a finite number
 */
export const fin = (x: any): boolean => Number.isFinite(Number(x));

/**
 * Determine which sigma bucket the price falls into
 */
export function bucketLabel(px: number, r: any): string {
  const lvls: [string, any][] = [
    ["-1.00σ", r.price_at_m100],
    ["-0.75σ", r.price_at_m075],
    ["-0.50σ", r.price_at_m050],
    ["-0.25σ", r.price_at_m025],
    ["mean", r.price_at_mean],
    ["+0.50σ", r.price_at_p050],
    ["+1.00σ", r.price_at_p100],
    ["+1.50σ", r.price_at_p150],
    ["+2.00σ", r.price_at_p200],
    ["+2.50σ", r.price_at_p250],
  ];

  let last = "<-1.00σ";
  for (const [name, v] of lvls) {
    if (fin(v) && px >= Number(v)) last = name;
  }
  return last;
}

/**
 * Compute bear pause state up to a given date
 * Replays historical price action to determine if we should be paused today
 * 
 * NOTE: Uses config.bearPauseEnterSigma and config.bearPauseExitSigma for thresholds
 */
export async function computeBearPauseAt(
  sb: SupabaseClient,
  orgId: string,
  upToDateStr: string,
  config: StrategyConfig
): Promise<boolean> {
  // Map sigma values to column names
  // Enter: +2.0σ = price_at_p200
  // Exit: Variable per variation (e.g., -1.0σ = price_at_m100, 0σ = price_at_mean)
  
  const enterColumn = `price_at_p${Math.abs(config.bearPauseEnterSigma * 100).toString().padStart(3, '0')}`;
  const exitColumn = config.bearPauseExitSigma < 0
    ? `price_at_m${Math.abs(config.bearPauseExitSigma * 100).toString().padStart(3, '0')}`
    : config.bearPauseExitSigma === 0
    ? "price_at_mean"
    : `price_at_p${Math.abs(config.bearPauseExitSigma * 100).toString().padStart(3, '0')}`;

  const { data, error } = await sb
    .from("ci_bands_daily")
    .select(`date, btc_price, ${enterColumn}, ${exitColumn}`)
    .eq("org_id", orgId)
    .lte("date", upToDateStr)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`computeBearPauseAt query failed: ${error.message}`);
  }

  let paused = false;

  for (const row of data ?? []) {
    const px = Number(row.btc_price ?? 0);
    const enterThreshold = fin(row[enterColumn]) ? Number(row[enterColumn]) : NaN;
    const exitThreshold = fin(row[exitColumn]) ? Number(row[exitColumn]) : NaN;

    if (!fin(px)) continue;

    // Enter pause once we go above configured entry threshold (e.g., +2.0σ)
    if (fin(enterThreshold) && px > enterThreshold) {
      paused = true;
    }

    // While paused, leave pause once price drops below configured exit threshold
    // e.g., Progressive: -1.0σ, Balanced: -0.75σ, Conservative: mean
    if (paused && fin(exitThreshold) && px < exitThreshold) {
      paused = false;
    }
  }

  return paused;
}

// ========================================================================================
// CORE TRADING LOGIC
// ========================================================================================

/**
 * Decide trading action based on current price, CI bands, momentum, and state
 * 
 * This is the heart of the LTH PVR strategy:
 * - 11 trading tiers (5 buy, 6 sell)
 * - Bear pause mechanism (disables buys during overvaluation)
 * - Momentum filter (blocks sells in Base 7-9 if ROC <= threshold)
 * - Retrace exceptions (opportunistic buys after extreme highs)
 * 
 * @param px - Current BTC price
 * @param r - CI bands row (contains price_at_mean, price_at_m100, etc.)
 * @param roc5 - 5-day rate of change (e.g., 0.05 = 5% gain over 5 days)
 * @param state - Current trading state (bear_pause, retrace eligibility, etc.)
 * @param config - Strategy configuration (B1-B11, pause triggers, momentum params)
 * @returns TradeDecision with action, percentage, rule name, and updated state
 */
export function decideTrade(
  px: number,
  r: any,
  roc5: number,
  state: Partial<TradingState>,
  config: StrategyConfig
): TradeDecision {
  // Extract CI band thresholds
  const mean = fin(r.price_at_mean) ? Number(r.price_at_mean) : NaN;
  const p_m025 = fin(r.price_at_m025) ? Number(r.price_at_m025) : NaN;
  const p_m050 = fin(r.price_at_m050) ? Number(r.price_at_m050) : NaN;
  const p_m075 = fin(r.price_at_m075) ? Number(r.price_at_m075) : NaN;
  const p_m100 = fin(r.price_at_m100) ? Number(r.price_at_m100) : NaN;
  const p_p050 = fin(r.price_at_p050) ? Number(r.price_at_p050) : NaN;
  const p_p100 = fin(r.price_at_p100) ? Number(r.price_at_p100) : NaN;
  const p_p150 = fin(r.price_at_p150) ? Number(r.price_at_p150) : NaN;
  const p_p200 = fin(r.price_at_p200) ? Number(r.price_at_p200) : NaN;
  const p_p250 = fin(r.price_at_p250) ? Number(r.price_at_p250) : NaN;

  // Initialize state with defaults
  const s: TradingState = {
    bear_pause: false,
    was_above_p1: false,
    was_above_p15: false,
    r1_armed: false,
    r15_armed: false,
    ...state,
  };

  // ========================================
  // BEAR PAUSE STATE MACHINE (configurable thresholds)
  // ========================================
  
  // Enter pause: price crosses ABOVE configured enter threshold (e.g., +2.0σ)
  // NOTE: All variations use +2.0σ for entry (config.bearPauseEnterSigma = 2.0)
  const enterThresholdColumn = `price_at_p${Math.abs(config.bearPauseEnterSigma * 100).toString().padStart(3, '0')}`;
  const enterThreshold = fin(r[enterThresholdColumn]) ? Number(r[enterThresholdColumn]) : p_p200; // Fallback to +2.0σ
  
  if (fin(enterThreshold) && px > enterThreshold) {
    s.bear_pause = true;
  }

  // Exit pause: price crosses BELOW configured exit threshold (varies by variation)
  // Progressive: -1.0σ, Balanced: -0.75σ, Conservative: mean (0σ)
  let exitThreshold = NaN;
  if (config.bearPauseExitSigma < 0) {
    const exitColumn = `price_at_m${Math.abs(config.bearPauseExitSigma * 100).toString().padStart(3, '0')}`;
    exitThreshold = fin(r[exitColumn]) ? Number(r[exitColumn]) : NaN;
  } else if (config.bearPauseExitSigma === 0) {
    exitThreshold = mean;
  } else {
    const exitColumn = `price_at_p${Math.abs(config.bearPauseExitSigma * 100).toString().padStart(3, '0')}`;
    exitThreshold = fin(r[exitColumn]) ? Number(r[exitColumn]) : NaN;
  }

  if (fin(exitThreshold) && px < exitThreshold) {
    // Exit pause and reset all retrace state
    s.bear_pause = false;
    s.was_above_p1 = false;
    s.was_above_p15 = false;
    s.r1_armed = false;
    s.r15_armed = false;
  }

  // While paused, disable retrace eligibility
  if (s.bear_pause) {
    s.was_above_p1 = false;
    s.was_above_p15 = false;
    s.r1_armed = false;
    s.r15_armed = false;
  }

  // ========================================
  // RETRACE EXCEPTION ELIGIBILITY TRACKING
  // ========================================
  
  if (config.enableRetrace && !s.bear_pause) {
    // Mark eligibility: Was price in +1.0σ ... +1.5σ range?
    if (fin(p_p100) && fin(p_p150) && px >= p_p100 && px < p_p150) {
      s.was_above_p1 = true;
    }

    // Mark eligibility: Was price in +1.5σ ... +2.0σ range?
    if (fin(p_p150) && fin(p_p200) && px >= p_p150 && px < p_p200) {
      s.was_above_p15 = true;
    }

    // Re-arm when price bounces back above boundary
    if (s.was_above_p1 && fin(p_p050) && px >= p_p050) {
      s.r1_armed = true;
    }
    if (s.was_above_p15 && fin(p_p100) && px >= p_p100) {
      s.r15_armed = true;
    }
  }

  // ========================================
  // RETRACE EXCEPTIONS (BUY BASE 3)
  // ========================================
  
  // Exception 1: Touched +1.5σ ... +2.0σ, now retraced to +0.5σ ... +1.0σ
  let exc_b9_to_b7 =
    config.enableRetrace &&
    s.was_above_p15 &&
    fin(p_p050) &&
    fin(p_p100) &&
    px >= p_p050 &&
    px < p_p100;

  // Exception 2: Touched +1.0σ ... +1.5σ, now retraced to mean ... +0.5σ
  let exc_b8_to_b6 =
    config.enableRetrace &&
    s.was_above_p1 &&
    fin(mean) &&
    fin(p_p050) &&
    px >= mean &&
    px < p_p050;

  // Disable retrace exceptions during bear pause (unless exiting pause)
  if (s.bear_pause && !(fin(exitThreshold) && px < exitThreshold)) {
    exc_b8_to_b6 = false;
    exc_b9_to_b7 = false;
  }

  // Trigger retrace buys
  if (exc_b9_to_b7) {
    return {
      action: "BUY",
      pct: config.B.B3,
      rule: "Base 3 (retrace B9→B7)",
      note: "Retrace: touched +1.5σ…+2.0σ; now in +0.5σ…+1.0σ",
      state: s,
    };
  }

  if (exc_b8_to_b6) {
    return {
      action: "BUY",
      pct: config.B.B3,
      rule: "Base 3 (retrace B8→B6)",
      note: "Retrace: touched +1.0σ…+1.5σ; now in mean…+0.5σ",
      state: s,
    };
  }

  // ========================================
  // BUY ZONE (price < mean)
  // ========================================
  
  if (fin(mean) && px < mean) {
    // During bear pause, block all buys unless exiting pause
    if (s.bear_pause && !(fin(exitThreshold) && px < exitThreshold)) {
      return {
        action: "HOLD",
        pct: 0,
        rule: "Pause",
        note: `Bear pause active: buying disabled until < ${config.bearPauseExitSigma}σ`,
        state: s,
      };
    }

    // Base 1: < -1.0σ
    if (fin(p_m100) && px < p_m100) {
      return {
        action: "BUY",
        pct: config.B.B1,
        rule: "Base 1",
        note: "< −1.0σ",
        state: s,
      };
    }

    // Base 2: -1.0σ ... -0.75σ
    if (fin(p_m075) && px < p_m075) {
      return {
        action: "BUY",
        pct: config.B.B2,
        rule: "Base 2",
        note: "−1.0σ…−0.75σ",
        state: s,
      };
    }

    // Base 3: -0.75σ ... -0.5σ
    if (fin(p_m050) && px < p_m050) {
      return {
        action: "BUY",
        pct: config.B.B3,
        rule: "Base 3",
        note: "−0.75σ…−0.5σ",
        state: s,
      };
    }

    // Base 4: -0.5σ ... -0.25σ
    if (fin(p_m025) && px < p_m025) {
      return {
        action: "BUY",
        pct: config.B.B4,
        rule: "Base 4",
        note: "−0.5σ…−0.25σ",
        state: s,
      };
    }

    // Base 5: -0.25σ ... mean
    return {
      action: "BUY",
      pct: config.B.B5,
      rule: "Base 5",
      note: "−0.25σ…mean",
      state: s,
    };
  }

  // ========================================
  // SELL ZONE (price >= mean)
  // ========================================
  
  // Momentum filter: Only applies to Base 7-9
  // Rule change: When bear_pause is TRUE, momentum filter does NOT apply (sell regardless)
  const mom_ok = s.bear_pause ? true : roc5 > config.momentumThreshold;

  // Base 6: mean ... +0.5σ (no momentum filter)
  if (fin(p_p050) && px < p_p050) {
    return {
      action: "SELL",
      pct: config.B.B6,
      rule: "Base 6",
      note: "mean…+0.5σ",
      state: s,
    };
  }

  // Base 7: +0.5σ ... +1.0σ (momentum filter applies)
  if (fin(p_p100) && px < p_p100) {
    return mom_ok
      ? {
          action: "SELL",
          pct: config.B.B7,
          rule: "Base 7",
          note: "+0.5σ…+1.0σ",
          state: s,
        }
      : {
          action: "HOLD",
          pct: 0,
          rule: "Hold (momo≤threshold)",
          note: `Momentum blocks sell in +0.5σ…+1.0σ (ROC=${(roc5 * 100).toFixed(2)}%)`,
          state: s,
        };
  }

  // Base 8: +1.0σ ... +1.5σ (momentum filter applies)
  if (fin(p_p150) && px < p_p150) {
    return mom_ok
      ? {
          action: "SELL",
          pct: config.B.B8,
          rule: "Base 8",
          note: "+1.0σ…+1.5σ",
          state: s,
        }
      : {
          action: "HOLD",
          pct: 0,
          rule: "Hold (momo≤threshold)",
          note: `Momentum blocks sell in +1.0σ…+1.5σ (ROC=${(roc5 * 100).toFixed(2)}%)`,
          state: s,
        };
  }

  // Base 9: +1.5σ ... +2.0σ (momentum filter applies)
  if (fin(p_p200) && px < p_p200) {
    return mom_ok
      ? {
          action: "SELL",
          pct: config.B.B9,
          rule: "Base 9",
          note: "+1.5σ…+2.0σ",
          state: s,
        }
      : {
          action: "HOLD",
          pct: 0,
          rule: "Hold (momo≤threshold)",
          note: `Momentum blocks sell in +1.5σ…+2.0σ (ROC=${(roc5 * 100).toFixed(2)}%)`,
          state: s,
        };
  }

  // Base 10: +2.0σ ... +2.5σ (no momentum filter)
  if (fin(p_p250) && px < p_p250) {
    return {
      action: "SELL",
      pct: config.B.B10,
      rule: "Base 10",
      note: "+2.0σ…+2.5σ",
      state: s,
    };
  }

  // Base 11: >= +2.5σ (no momentum filter)
  return {
    action: "SELL",
    pct: config.B.B11,
    rule: "Base 11",
    note: "≥ +2.5σ",
    state: s,
  };
}
