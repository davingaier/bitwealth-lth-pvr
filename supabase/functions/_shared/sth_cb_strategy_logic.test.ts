// sth_cb_strategy_logic.test.ts
// Unit tests for the shared STH Cost Basis strategy logic.
// Run with: deno test supabase/functions/_shared/sth_cb_strategy_logic.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import {
  DEFAULT_STH_CB_CONFIG,
  INITIAL_STH_CB_STATE,
  SthCbConfig,
  SthCbState,
  computeRocSeries,
  decideSthCb,
  warmupSthCbState,
} from "./sth_cb_strategy_logic.ts";

const CB = 100_000; // STH cost basis fixed at $100k for readability
const NO_MOMO: SthCbConfig = { ...DEFAULT_STH_CB_CONFIG, momoEnabled: false };
const CASH: SthCbState = { ...INITIAL_STH_CB_STATE };
const latches = (s: SthCbState) => ({ capLatch: s.capLatch, trendLatch: s.trendLatch });

Deno.test("R1: capitulation buy latches at <= 70% of STH CB", () => {
  const d = decideSthCb(69_999, CB, 0, CASH, NO_MOMO);
  assertEquals(d.inMarket, true);
  assertEquals(d.position, "cap_hold");
  assertEquals(d.rule, "R1 Capitulation buy");
});

Deno.test("R1: 70.01% does not trigger a capitulation buy", () => {
  const d = decideSthCb(70_010, CB, 0, CASH, NO_MOMO);
  assertEquals(d.inMarket, false);
  assertEquals(d.position, "cash");
});

Deno.test("R2: capitulation exit at >= 100% of STH CB (no momentum gate)", () => {
  const held: SthCbState = { capLatch: true, trendLatch: false };
  const hold = decideSthCb(99_000, CB, 0.1, held, NO_MOMO);
  assertEquals(hold.inMarket, true, "below CB → keep holding");
  const exit = decideSthCb(100_000, CB, 0.1, held, NO_MOMO);
  assertEquals(exit.inMarket, false);
  assertEquals(exit.position, "cash");
  assertEquals(exit.rule, "R2 Capitulation exit");
});

Deno.test("R2 momentum gate: sell deferred while ROC > thr, fires once ROC <= thr", () => {
  const held: SthCbState = { capLatch: true, trendLatch: false };
  const deferred = decideSthCb(101_000, CB, +0.03, held, DEFAULT_STH_CB_CONFIG);
  assertEquals(deferred.inMarket, true);
  assertEquals(deferred.sellDeferred, true);
  assertEquals(deferred.rule, "R2 deferred (momentum)");
  const fired = decideSthCb(101_000, CB, -0.01, deferred.state, DEFAULT_STH_CB_CONFIG);
  assertEquals(fired.inMarket, false);
  assertEquals(fired.rule, "R2 Capitulation exit");
});

Deno.test("R3: trend entry at >= 105% and exit at <= 95% (hysteresis)", () => {
  const enter = decideSthCb(105_000, CB, 0, CASH, NO_MOMO);
  assertEquals(enter.position, "trend_hold");
  assertEquals(enter.rule, "R3 Trend entry");
  // Dips to the cost basis itself do NOT exit the trend position
  const dip = decideSthCb(99_000, CB, 0, enter.state, NO_MOMO);
  assertEquals(dip.inMarket, true);
  assertEquals(dip.rule, "Hold");
  const exit = decideSthCb(95_000, CB, 0, dip.state, NO_MOMO);
  assertEquals(exit.inMarket, false);
  assertEquals(exit.rule, "R3 Trend exit");
});

Deno.test("R3 momentum gate honours momoOnTrendExit=false", () => {
  const cfg: SthCbConfig = { ...DEFAULT_STH_CB_CONFIG, momoOnTrendExit: false };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const d = decideSthCb(94_000, CB, +0.05, held, cfg);
  assertEquals(d.inMarket, false, "exit not gated → sells despite positive ROC");
});

Deno.test("OR-latch: capitulation hold that runs straight through CB to +5% never round-trips", () => {
  const held: SthCbState = { capLatch: true, trendLatch: false };
  // Gap day: 0.98 → 1.06 of CB. Cap exit AND trend entry both true on the same close.
  const d = decideSthCb(106_000, CB, 0.1, held, NO_MOMO);
  assertEquals(d.inMarket, true);
  assertEquals(d.position, "trend_hold");
  assertEquals(d.state.capLatch, false, "cap latch released on upgrade");
});

Deno.test("Deferred R2 is released when trend latch engages, so a later trend exit really exits", () => {
  const held: SthCbState = { capLatch: true, trendLatch: false };
  const deferred = decideSthCb(101_000, CB, +0.05, held, DEFAULT_STH_CB_CONFIG);
  assertEquals(deferred.sellDeferred, true);
  const upgraded = decideSthCb(106_000, CB, +0.05, deferred.state, DEFAULT_STH_CB_CONFIG);
  assertEquals(upgraded.position, "trend_hold");
  assertEquals(upgraded.state.capLatch, false);
  const exit = decideSthCb(94_000, CB, -0.02, upgraded.state, DEFAULT_STH_CB_CONFIG);
  assertEquals(exit.inMarket, false, "no stale cap latch keeps us in market");
});

Deno.test("Capitulation entry while trend-latched converts to cap_hold", () => {
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const d = decideSthCb(65_000, CB, -0.2, held, NO_MOMO);
  assertEquals(d.position, "cap_hold");
  assertEquals(d.state.trendLatch, false);
});

Deno.test("Missing inputs carry state forward without trading", () => {
  const held: SthCbState = { capLatch: true, trendLatch: false };
  const d = decideSthCb(0, CB, 0, held, NO_MOMO);
  assertEquals(d.inMarket, true);
  assertEquals(latches(d.state), { capLatch: true, trendLatch: false });
});

Deno.test("computeRocSeries: zero during look-back, then px[i]/px[i-len]-1", () => {
  const roc = computeRocSeries([100, 110, 121, 133.1], 2);
  assertEquals(roc[0], 0);
  assertEquals(roc[1], 0);
  assertEquals(Math.round(roc[2] * 1e6) / 1e6, 0.21);
  assertEquals(Math.round(roc[3] * 1e6) / 1e6, 0.21);
});

Deno.test("warmupSthCbState replays history to seed latches", () => {
  const rows = [
    { px: 110_000, cb: CB }, // trend entry
    { px: 100_000, cb: CB }, // hold
    { px: 60_000, cb: CB },  // capitulation (converts to cap_hold)
    { px: 80_000, cb: CB },  // hold
  ];
  const s = warmupSthCbState(rows, NO_MOMO);
  assertEquals(latches(s), { capLatch: true, trendLatch: false });
});

// ========================================================================================
// Experimental refinement flags (ideas 1–5)
// ========================================================================================

Deno.test("Base config: targetAlloc is 1 in market, 0 in cash", () => {
  const inMkt = decideSthCb(69_000, CB, 0, CASH, NO_MOMO);
  assertEquals(inMkt.targetAlloc, 1);
  const out = decideSthCb(100_000, CB, 0, inMkt.state, NO_MOMO);
  assertEquals(out.targetAlloc, 0);
});

Deno.test("Idea 1: trendExitConfirmDays requires N consecutive closes", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, trendExitConfirmDays: 3 };
  let s: SthCbState = { capLatch: false, trendLatch: true };
  let d = decideSthCb(94_000, CB, 0, s, cfg); assertEquals(d.inMarket, true); assertEquals(d.rule, "R3 deferred (confirm 1/3)");
  d = decideSthCb(94_000, CB, 0, d.state, cfg); assertEquals(d.inMarket, true);
  // a close back above 95% resets the streak
  d = decideSthCb(96_000, CB, 0, d.state, cfg); assertEquals(d.state.exitConfirmCount, 0);
  d = decideSthCb(94_000, CB, 0, d.state, cfg);
  d = decideSthCb(94_000, CB, 0, d.state, cfg);
  d = decideSthCb(94_000, CB, 0, d.state, cfg);
  assertEquals(d.inMarket, false);
  assertEquals(d.rule, "R3 Trend exit");
});

Deno.test("Idea 1: exitRocLength gates on the slower ROC supplied via extra.rocExit", () => {
  const cfg: SthCbConfig = { ...DEFAULT_STH_CB_CONFIG, exitRocLength: 20 };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  // fast ROC negative but slow ROC positive → deferred
  const d1 = decideSthCb(94_000, CB, -0.05, held, cfg, { rocExit: +0.10 });
  assertEquals(d1.inMarket, true);
  assertEquals(d1.sellDeferred, true);
  // slow ROC negative → exit
  const d2 = decideSthCb(94_000, CB, +0.05, held, cfg, { rocExit: -0.01 });
  assertEquals(d2.inMarket, false);
});

Deno.test("Idea 2: capBuyTiers scale in and exit sells all", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, capBuyTiers: [{ ratio: 0.70, alloc: 0.5 }, { ratio: 0.60, alloc: 1 }] };
  const t1 = decideSthCb(69_000, CB, 0, CASH, cfg);
  assertEquals(t1.position, "cap_hold");
  assertEquals(t1.targetAlloc, 0.5);
  const hold = decideSthCb(65_000, CB, 0, t1.state, cfg);
  assertEquals(hold.targetAlloc, 0.5, "between tiers → unchanged");
  const t2 = decideSthCb(59_000, CB, 0, hold.state, cfg);
  assertEquals(t2.targetAlloc, 1);
  assertEquals(t2.rule, "R1 Capitulation tier 2");
  const exit = decideSthCb(100_000, CB, 0, t2.state, cfg);
  assertEquals(exit.targetAlloc, 0);
  assertEquals(exit.position, "cash");
});

Deno.test("Idea 2: sellTiers scale out while trend-latched; alloc 0 tier is a full exit", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, sellTiers: [{ ratio: 1.5, alloc: 0.66 }, { ratio: 2.0, alloc: 0 }] };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const a = decideSthCb(140_000, CB, 0, held, cfg); assertEquals(a.targetAlloc, 1);
  const b = decideSthCb(150_000, CB, 0, a.state, cfg); assertEquals(b.targetAlloc, 0.66); assertEquals(b.position, "trend_hold");
  const c = decideSthCb(145_000, CB, 0, b.state, cfg); assertEquals(c.targetAlloc, 0.66, "tier latches — no re-buy on dip");
  const d = decideSthCb(200_000, CB, 0, c.state, cfg); assertEquals(d.position, "cash"); assertEquals(d.targetAlloc, 0);
});

Deno.test("Idea 3: cbSlopeDays blocks a trend exit while the cost basis is rising", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, cbSlopeDays: 14 };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const rising = decideSthCb(94_000, CB, 0, held, cfg, { cbSlope: +0.03 });
  assertEquals(rising.inMarket, true);
  assertEquals(rising.rule, "R3 deferred (CB rising)");
  const flat = decideSthCb(94_000, CB, 0, held, cfg, { cbSlope: -0.001 });
  assertEquals(flat.inMarket, false);
  // No slope input supplied → filter is inert (back-compat)
  const noInput = decideSthCb(94_000, CB, 0, held, cfg);
  assertEquals(noInput.inMarket, false);
});

Deno.test("Idea 4: distributeAtSigma exits at the LTH PVR band; disableTrendExit skips −5% exit", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, distributeAtSigma: 2.0, disableTrendExit: true };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const dip = decideSthCb(90_000, CB, 0, held, cfg, { bands: { p200: 180_000 } });
  assertEquals(dip.inMarket, true, "−10% dip ignored because trend exit disabled");
  const top = decideSthCb(181_000, CB, 0, dip.state, cfg, { bands: { p200: 180_000 } });
  assertEquals(top.inMarket, false);
  assertEquals(top.rule, "R4 Distribution at +2σ");
  // Re-entry after distribution uses the normal 105% rule (not the ladder)
  const re = decideSthCb(105_000, CB, 0, top.state, cfg);
  assertEquals(re.rule, "R3 Trend entry");
});

Deno.test("Idea 5: trendReentryRatio arms a cheaper re-entry only after a trend exit", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, trendReentryRatio: 1.00 };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const exit = decideSthCb(94_000, CB, 0, held, cfg);
  assertEquals(exit.state.reentryArmed, true);
  const noYet = decideSthCb(99_000, CB, 0, exit.state, cfg);
  assertEquals(noYet.inMarket, false);
  const re = decideSthCb(100_500, CB, 0, noYet.state, cfg);
  assertEquals(re.inMarket, true);
  assertEquals(re.rule, "R5 Trend re-entry (ladder)");
  // After a capitulation exit the ladder is NOT armed → needs 105%
  const capHeld: SthCbState = { capLatch: true, trendLatch: false };
  const capExit = decideSthCb(100_000, CB, 0, capHeld, cfg);
  const tryRe = decideSthCb(101_000, CB, 0, capExit.state, cfg);
  assertEquals(tryRe.inMarket, false);
});
