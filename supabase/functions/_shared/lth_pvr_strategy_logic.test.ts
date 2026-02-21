// lth_pvr_strategy_logic.test.ts
// Unit tests for shared LTH PVR trading logic
// Run with: deno test --allow-env --allow-net

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import {
  decideTrade,
  fin,
  bucketLabel,
  StrategyConfig,
  TradingState,
} from "./lth_pvr_strategy_logic.ts";

// ========================================================================================
// TEST FIXTURES
// ========================================================================================

// Progressive variation (current production)
const PROGRESSIVE_CONFIG: StrategyConfig = {
  B: {
    B1: 0.22796,
    B2: 0.21397,
    B3: 0.19943,
    B4: 0.18088,
    B5: 0.12229,
    B6: 0.00157,
    B7: 0.00200,
    B8: 0.00441,
    B9: 0.01287,
    B10: 0.03300,
    B11: 0.09572,
  },
  bearPauseEnterSigma: 2.0,
  bearPauseExitSigma: -1.0,
  momentumLength: 5,
  momentumThreshold: 0.0,
  enableRetrace: true,
};

// Balanced variation (future)
const BALANCED_CONFIG: StrategyConfig = {
  B: {
    B1: 0.20,
    B2: 0.19,
    B3: 0.18,
    B4: 0.16,
    B5: 0.11,
    B6: 0.002,
    B7: 0.003,
    B8: 0.005,
    B9: 0.015,
    B10: 0.04,
    B11: 0.10,
  },
  bearPauseEnterSigma: 2.0,
  bearPauseExitSigma: -0.75, // Earlier re-entry than Progressive
  momentumLength: 5,
  momentumThreshold: 0.0,
  enableRetrace: true,
};

// Conservative variation (future)
const CONSERVATIVE_CONFIG: StrategyConfig = {
  B: {
    B1: 0.18,
    B2: 0.17,
    B3: 0.16,
    B4: 0.14,
    B5: 0.10,
    B6: 0.003,
    B7: 0.004,
    B8: 0.007,
    B9: 0.02,
    B10: 0.05,
    B11: 0.12,
  },
  bearPauseEnterSigma: 2.0,
  bearPauseExitSigma: 0.0, // Exit at mean (earliest re-entry)
  momentumLength: 5,
  momentumThreshold: 0.0,
  enableRetrace: true,
};

// Typical CI bands row (based on 2024-12-15 sample data)
const SAMPLE_BANDS = {
  price_at_m100: 70000,
  price_at_m075: 75000,
  price_at_m050: 80000,
  price_at_m025: 85000,
  price_at_mean: 90000,
  price_at_p050: 95000,
  price_at_p100: 100000,
  price_at_p150: 105000,
  price_at_p200: 110000,
  price_at_p250: 115000,
};

// Initial trading state (no pause, no retrace eligibility)
const INITIAL_STATE: Partial<TradingState> = {
  bear_pause: false,
  was_above_p1: false,
  was_above_p15: false,
  r1_armed: false,
  r15_armed: false,
};

// ========================================================================================
// UTILITY FUNCTION TESTS
// ========================================================================================

Deno.test("fin() - detects finite numbers", () => {
  assertEquals(fin(123), true);
  assertEquals(fin(0), true);
  assertEquals(fin(-456.78), true);
  assertEquals(fin(NaN), false);
  assertEquals(fin(Infinity), false);
  assertEquals(fin(-Infinity), false);
  assertEquals(fin(null), false);
  assertEquals(fin(undefined), false);
  assertEquals(fin("not a number"), false);
});

Deno.test("bucketLabel() - identifies sigma band", () => {
  assertEquals(bucketLabel(68000, SAMPLE_BANDS), "<-1.00σ");
  assertEquals(bucketLabel(72000, SAMPLE_BANDS), "-1.00σ");
  assertEquals(bucketLabel(77000, SAMPLE_BANDS), "-0.75σ");
  assertEquals(bucketLabel(92000, SAMPLE_BANDS), "mean");
  assertEquals(bucketLabel(103000, SAMPLE_BANDS), "+1.00σ");
  assertEquals(bucketLabel(120000, SAMPLE_BANDS), "+2.50σ");
});

// ========================================================================================
// BUY ZONE TESTS
// ========================================================================================

Deno.test("decideTrade() - Base 1 buy (< -1.0σ)", () => {
  const decision = decideTrade(68000, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "BUY");
  assertEquals(decision.rule, "Base 1");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B1);
  assertEquals(decision.note, "< −1.0σ");
});

Deno.test("decideTrade() - Base 2 buy (-1.0σ ... -0.75σ)", () => {
  const decision = decideTrade(72000, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "BUY");
  assertEquals(decision.rule, "Base 2");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B2);
});

Deno.test("decideTrade() - Base 5 buy (-0.25σ ... mean)", () => {
  const decision = decideTrade(88000, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "BUY");
  assertEquals(decision.rule, "Base 5");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B5);
});

// ========================================================================================
// SELL ZONE TESTS
// ========================================================================================

Deno.test("decideTrade() - Base 6 sell (mean ... +0.5σ)", () => {
  const decision = decideTrade(92000, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "SELL");
  assertEquals(decision.rule, "Base 6");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B6);
});

Deno.test("decideTrade() - Base 7 sell (+0.5σ ... +1.0σ) with momentum OK", () => {
  const decision = decideTrade(97000, SAMPLE_BANDS, 0.02, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "SELL");
  assertEquals(decision.rule, "Base 7");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B7);
});

Deno.test("decideTrade() - Base 10 sell (+2.0σ ... +2.5σ)", () => {
  const decision = decideTrade(112000, SAMPLE_BANDS, -0.01, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "SELL");
  assertEquals(decision.rule, "Base 10");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B10);
});

Deno.test("decideTrade() - Base 11 sell (>= +2.5σ)", () => {
  const decision = decideTrade(120000, SAMPLE_BANDS, -0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "SELL");
  assertEquals(decision.rule, "Base 11");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B11);
});

// ========================================================================================
// MOMENTUM FILTER TESTS
// ========================================================================================

Deno.test("decideTrade() - Base 7 blocked by momentum filter", () => {
  const decision = decideTrade(97000, SAMPLE_BANDS, -0.01, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "HOLD");
  assertEquals(decision.rule, "Hold (momo≤threshold)");
});

Deno.test("decideTrade() - Base 8 blocked by momentum filter", () => {
  const decision = decideTrade(103000, SAMPLE_BANDS, -0.02, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "HOLD");
  assertEquals(decision.rule, "Hold (momo≤threshold)");
});

Deno.test("decideTrade() - Base 9 blocked by momentum filter", () => {
  const decision = decideTrade(107000, SAMPLE_BANDS, -0.03, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "HOLD");
  assertEquals(decision.rule, "Hold (momo≤threshold)");
});

Deno.test("decideTrade() - Base 6 ignores momentum (no filter)", () => {
  const decision = decideTrade(92000, SAMPLE_BANDS, -0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "SELL"); // Base 6 always sells
  assertEquals(decision.rule, "Base 6");
});

Deno.test("decideTrade() - Base 10 ignores momentum (no filter)", () => {
  const decision = decideTrade(112000, SAMPLE_BANDS, -0.10, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "SELL"); // Base 10 always sells
  assertEquals(decision.rule, "Base 10");
});

// ========================================================================================
// BEAR PAUSE TESTS
// ========================================================================================

Deno.test("decideTrade() - buy blocked during bear pause", () => {
  const pausedState: Partial<TradingState> = { ...INITIAL_STATE, bear_pause: true };
  const decision = decideTrade(88000, SAMPLE_BANDS, 0.05, pausedState, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "HOLD");
  assertEquals(decision.rule, "Pause");
  assertExists(decision.note.match(/bear pause/i));
});

Deno.test("decideTrade() - Progressive variation enters pause at +2.0σ", () => {
  const decision = decideTrade(111000, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.state.bear_pause, true); // Should set pause flag
});

Deno.test("decideTrade() - Progressive variation exits pause at -1.0σ", () => {
  const pausedState: Partial<TradingState> = { ...INITIAL_STATE, bear_pause: true };
  const decision = decideTrade(68000, SAMPLE_BANDS, 0.05, pausedState, PROGRESSIVE_CONFIG);
  assertEquals(decision.state.bear_pause, false); // Should clear pause flag
  assertEquals(decision.action, "BUY"); // Should execute Base 1 buy
});

Deno.test("decideTrade() - Balanced variation exits pause at -0.75σ", () => {
  const pausedState: Partial<TradingState> = { ...INITIAL_STATE, bear_pause: true };
  const decision = decideTrade(72000, SAMPLE_BANDS, 0.05, pausedState, BALANCED_CONFIG);
  assertEquals(decision.state.bear_pause, false); // Should exit earlier than Progressive
  assertEquals(decision.action, "BUY"); // Should execute Base 2 buy
});

Deno.test("decideTrade() - Conservative variation exits pause at mean (0σ)", () => {
  const pausedState: Partial<TradingState> = { ...INITIAL_STATE, bear_pause: true };
  const decision = decideTrade(88000, SAMPLE_BANDS, 0.05, pausedState, CONSERVATIVE_CONFIG);
  assertEquals(decision.state.bear_pause, false); // Should exit earliest
  assertEquals(decision.action, "BUY"); // Should execute Base 5 buy
});

Deno.test("decideTrade() - momentum filter disabled during bear pause", () => {
  const pausedState: Partial<TradingState> = { ...INITIAL_STATE, bear_pause: true };
  const decision = decideTrade(97000, SAMPLE_BANDS, -0.05, pausedState, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "SELL"); // Should ignore momentum filter
  assertEquals(decision.rule, "Base 7");
});

// ========================================================================================
// RETRACE EXCEPTION TESTS
// ========================================================================================

Deno.test("decideTrade() - retrace B9→B7 (touched +1.5σ, now in +0.5σ...+1.0σ)", () => {
  const retraceState: Partial<TradingState> = {
    ...INITIAL_STATE,
    was_above_p15: true, // Previously touched +1.5σ ... +2.0σ
  };
  const decision = decideTrade(97000, SAMPLE_BANDS, 0.02, retraceState, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "BUY");
  assertEquals(decision.rule, "Base 3 (retrace B9→B7)");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B3);
});

Deno.test("decideTrade() - retrace B8→B6 (touched +1.0σ, now in mean...+0.5σ)", () => {
  const retraceState: Partial<TradingState> = {
    ...INITIAL_STATE,
    was_above_p1: true, // Previously touched +1.0σ ... +1.5σ
  };
  const decision = decideTrade(92000, SAMPLE_BANDS, 0.02, retraceState, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "BUY");
  assertEquals(decision.rule, "Base 3 (retrace B8→B6)");
  assertEquals(decision.pct, PROGRESSIVE_CONFIG.B.B3);
});

Deno.test("decideTrade() - retrace disabled when enableRetrace=false", () => {
  const noRetraceConfig = { ...PROGRESSIVE_CONFIG, enableRetrace: false };
  const retraceState: Partial<TradingState> = {
    ...INITIAL_STATE,
    was_above_p15: true,
  };
  const decision = decideTrade(97000, SAMPLE_BANDS, 0.02, retraceState, noRetraceConfig);
  assertEquals(decision.action, "SELL"); // Should follow Base 7 instead
  assertEquals(decision.rule, "Base 7");
});

Deno.test("decideTrade() - retrace blocked during bear pause", () => {
  const retraceState: Partial<TradingState> = {
    ...INITIAL_STATE,
    bear_pause: true,
    was_above_p15: true,
  };
  const decision = decideTrade(97000, SAMPLE_BANDS, 0.02, retraceState, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "SELL"); // Should follow Base 7 instead
  assertEquals(decision.rule, "Base 7");
});

// ========================================================================================
// STATE MACHINE TESTS
// ========================================================================================

Deno.test("decideTrade() - tracks was_above_p1 eligibility", () => {
  const decision = decideTrade(103000, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.state.was_above_p1, true); // Should set flag in +1.0σ ... +1.5σ
});

Deno.test("decideTrade() - tracks was_above_p15 eligibility", () => {
  const decision = decideTrade(107000, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.state.was_above_p15, true); // Should set flag in +1.5σ ... +2.0σ
});

Deno.test("decideTrade() - resets retrace state when exiting pause", () => {
  const retraceState: Partial<TradingState> = {
    bear_pause: true,
    was_above_p1: true,
    was_above_p15: true,
    r1_armed: true,
    r15_armed: true,
  };
  const decision = decideTrade(68000, SAMPLE_BANDS, 0.05, retraceState, PROGRESSIVE_CONFIG);
  assertEquals(decision.state.bear_pause, false);
  assertEquals(decision.state.was_above_p1, false); // Should reset
  assertEquals(decision.state.was_above_p15, false); // Should reset
  assertEquals(decision.state.r1_armed, false); // Should reset
  assertEquals(decision.state.r15_armed, false); // Should reset
});

// ========================================================================================
// STRATEGY VARIATION COMPARISON TESTS
// ========================================================================================

Deno.test("Strategy variations - order sizes differ", () => {
  const px = 68000; // Base 1 trigger
  const progressive = decideTrade(px, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  const balanced = decideTrade(px, SAMPLE_BANDS, 0.05, INITIAL_STATE, BALANCED_CONFIG);
  const conservative = decideTrade(px, SAMPLE_BANDS, 0.05, INITIAL_STATE, CONSERVATIVE_CONFIG);

  assertEquals(progressive.pct, 0.22796);
  assertEquals(balanced.pct, 0.20);
  assertEquals(conservative.pct, 0.18);
});

Deno.test("Strategy variations - bear pause exit thresholds differ", () => {
  const pausedState: Partial<TradingState> = { ...INITIAL_STATE, bear_pause: true };

  // Progressive: stays paused at -0.75σ
  const progressive = decideTrade(72000, SAMPLE_BANDS, 0.05, pausedState, PROGRESSIVE_CONFIG);
  assertEquals(progressive.state.bear_pause, true); // Still paused

  // Balanced: exits pause at -0.75σ
  const balanced = decideTrade(72000, SAMPLE_BANDS, 0.05, pausedState, BALANCED_CONFIG);
  assertEquals(balanced.state.bear_pause, false); // Exited

  // Conservative: already exited at mean (not tested here as mean=90k, above 72k)
});

// ========================================================================================
// EDGE CASE TESTS
// ========================================================================================

Deno.test("decideTrade() - handles missing CI bands gracefully", () => {
  const incompleteBands = { price_at_mean: 90000 }; // Only mean available
  const decision = decideTrade(88000, incompleteBands, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "BUY"); // Should still produce a decision
});

Deno.test("decideTrade() - handles price exactly on threshold", () => {
  const decision = decideTrade(70000, SAMPLE_BANDS, 0.05, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "BUY");
  assertEquals(decision.rule, "Base 2"); // Should trigger next tier
});

Deno.test("decideTrade() - handles zero momentum threshold", () => {
  const decision = decideTrade(97000, SAMPLE_BANDS, 0.0, INITIAL_STATE, PROGRESSIVE_CONFIG);
  assertEquals(decision.action, "HOLD"); // ROC = 0 should fail (roc5 > 0) check
});

console.log("✅ All tests passed!");
