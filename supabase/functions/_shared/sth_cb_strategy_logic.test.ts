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

// ========================================================================================
// Ideas 7–12 (lump-sum campaign mechanics)
// ========================================================================================

Deno.test("Idea 7: σ-adaptive thresholds replace fixed ratios when sigma is supplied", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, sigmaMode: "ratio_sigma", sigmaWindow: 365, capBuySigma: -1.5, trendEnterSigma: 0.5, trendExitSigma: -0.5 };
  const sg = 0.2; // ln-σ → cap buy at exp(-0.3)=0.741, trend entry at exp(0.1)=1.105, trend exit at exp(-0.1)=0.905
  const noBuy = decideSthCb(75_000, CB, 0, CASH, cfg, { sigma: sg });
  assertEquals(noBuy.inMarket, false, "0.75 > 0.741 → no capitulation buy");
  const buy = decideSthCb(74_000, CB, 0, CASH, cfg, { sigma: sg });
  assertEquals(buy.position, "cap_hold");
  const noTrend = decideSthCb(108_000, CB, 0, CASH, cfg, { sigma: sg });
  assertEquals(noTrend.inMarket, false, "1.08 < 1.105 → no trend entry under σ thresholds");
  const trend = decideSthCb(111_000, CB, 0, CASH, cfg, { sigma: sg });
  assertEquals(trend.position, "trend_hold");
  // Without a sigma input the fixed ratios apply (back-compat)
  const fixed = decideSthCb(69_000, CB, 0, CASH, cfg);
  assertEquals(fixed.position, "cap_hold");
});

Deno.test("Idea 8: momentum re-entry fires after a trend exit when ROC recovers (ratio floor 1.0)", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, reentryRocThreshold: 0.03 };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const exit = decideSthCb(94_000, CB, 0, held, cfg);
  assertEquals(exit.state.reentryArmed, true);
  const below = decideSthCb(99_000, CB, 0.05, exit.state, cfg);
  assertEquals(below.inMarket, false, "ratio < 1.0 → floor blocks");
  const weak = decideSthCb(101_000, CB, 0.01, below.state, cfg);
  assertEquals(weak.inMarket, false, "ROC below threshold");
  const re = decideSthCb(101_000, CB, 0.04, weak.state, cfg);
  assertEquals(re.position, "trend_hold");
  assertEquals(re.rule, "R8 Trend re-entry (momentum)");
});

Deno.test("Idea 9: minHoldDays suppresses exits until the position is old enough", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, minHoldDays: 3 };
  let d = decideSthCb(69_000, CB, 0, CASH, cfg);       // day 0 entry (cap)
  d = decideSthCb(101_000, CB, 0, d.state, cfg);       // day 1: exit condition met but locked
  assertEquals(d.inMarket, true);
  d = decideSthCb(101_000, CB, 0, d.state, cfg);       // day 2: locked
  assertEquals(d.inMarket, true);
  d = decideSthCb(101_000, CB, 0, d.state, cfg);       // day 3: holdDays=3 → unlocked
  assertEquals(d.inMarket, false);
});

Deno.test("Idea 10: blockEntryAboveSigma stops trend entries above the LTH band", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, blockEntryAboveSigma: 2 };
  const blocked = decideSthCb(106_000, CB, 0, CASH, cfg, { bands: { p200: 100_000 } });
  assertEquals(blocked.inMarket, false);
  assertEquals(blocked.rule, "R10 Entry blocked (LTH macro)");
  const ok = decideSthCb(106_000, CB, 0, CASH, cfg, { bands: { p200: 200_000 } });
  assertEquals(ok.position, "trend_hold");
  // capitulation buys are never blocked
  const cap = decideSthCb(69_000, CB, 0, CASH, cfg, { bands: { p200: 50_000 } });
  assertEquals(cap.position, "cap_hold");
});

Deno.test("Idea 11: capBuyRocThreshold waits for ROC before a capitulation buy", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, capBuyRocThreshold: 0 };
  const wait = decideSthCb(65_000, CB, -0.1, CASH, cfg);
  assertEquals(wait.inMarket, false);
  assertEquals(wait.rule, "R1 waiting (ROC)");
  const buy = decideSthCb(66_000, CB, 0.01, wait.state, cfg);
  assertEquals(buy.position, "cap_hold");
});

Deno.test("Idea 17: an armed capitulation buy fires once ROC turns, even after the bounce above the level", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, capBuyRocThreshold: 0, capBuyArmDays: 5, capBuyArmCeilingRatio: 0.8 };
  const touch = decideSthCb(65_000, CB, -0.1, CASH, cfg);            // 65 % ≤ 70 %, falling → arms
  assertEquals(touch.inMarket, false);
  assertEquals(touch.state.capArmDaysLeft, 5);
  const bounce = decideSthCb(75_000, CB, 0.05, touch.state, cfg);    // 75 % ≤ ceiling 80 %, ROC up → fires
  assertEquals(bounce.position, "cap_hold");
  assertEquals(bounce.rule, "R17 Capitulation buy (armed)");
  assertEquals(bounce.state.capArmDaysLeft, 0);
  // above the ceiling the arm does not chase
  const touch2 = decideSthCb(65_000, CB, -0.1, CASH, cfg);
  const chase = decideSthCb(85_000, CB, 0.05, touch2.state, cfg);
  assertEquals(chase.inMarket, false);
  // the arm expires
  let s = touch2.state;
  for (let i = 0; i < 5; i++) s = decideSthCb(72_000, CB, -0.01, s, cfg).state;
  assertEquals(decideSthCb(72_000, CB, 0.05, s, cfg).inMarket, false);
});

Deno.test("Idea 18: split entry — partial on the touch, full on confirmation; R16 must not restore it", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, capBuyRocThreshold: 0, capBuyTouchAlloc: 0.5, dipRebuyAtCbRatio: 1.05 };
  const touch = decideSthCb(65_000, CB, -0.1, CASH, cfg);
  assertEquals(touch.position, "cap_hold");
  assertEquals(touch.targetAlloc, 0.5);
  assertEquals(touch.rule, "R18 Capitulation touch → 50% BTC");
  const still = decideSthCb(64_000, CB, -0.05, touch.state, cfg);  // still falling: no dip re-buy to 100 %
  assertEquals(still.targetAlloc, 0.5);
  const confirm = decideSthCb(66_000, CB, 0.02, still.state, cfg);
  assertEquals(confirm.targetAlloc, 1);
  assertEquals(confirm.rule, "R18 Capitulation confirm → 100% BTC");
  // exit to cash clears the partial
  const exit = decideSthCb(101_000, CB, 0, { ...confirm.state, holdDays: 30 }, cfg);
  assertEquals(exit.inMarket, false);
  assertEquals(exit.state.capTouchAlloc, undefined);
});

Deno.test("Idea 19: capBuyRocLength gates R1 on extra.rocCap instead of the fast ROC", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, capBuyRocThreshold: 0, capBuyRocLength: 4 };
  const wait = decideSthCb(65_000, CB, +0.05, CASH, cfg, { rocCap: -0.02 }); // fast ROC up, slow ROC still down → wait
  assertEquals(wait.inMarket, false);
  assertEquals(wait.rule, "R1 waiting (ROC)");
  const buy = decideSthCb(65_000, CB, -0.05, wait.state, cfg, { rocCap: 0.01 }); // slow ROC turned → buy
  assertEquals(buy.position, "cap_hold");
  // without extra.rocCap the gate falls back to the fast ROC
  assertEquals(decideSthCb(65_000, CB, 0.01, CASH, cfg).position, "cap_hold");
});

Deno.test("Idea 12: trailing stop exits a trend hold X% below its peak and arms re-entry", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, trailingStopPct: 0.2, disableTrendExit: true };
  let d = decideSthCb(106_000, CB, 0, CASH, cfg);     // entry, peak 106k
  d = decideSthCb(150_000, CB, 0, d.state, cfg);      // peak 150k
  d = decideSthCb(125_000, CB, 0, d.state, cfg);      // −16.7% → hold
  assertEquals(d.inMarket, true);
  d = decideSthCb(119_000, CB, 0, d.state, cfg);      // −20.7% → stop
  assertEquals(d.inMarket, false);
  assertEquals(d.rule, "R12 Trailing stop (20%)");
  assertEquals(d.state.reentryArmed, true);
});

Deno.test("Idea 13: after a distribution, trend entries are blocked until price returns to the clear ratio", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, distributeAtSigma: 2, distReentryClearRatio: 1.0 };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const dist = decideSthCb(150_000, CB, 0, held, cfg, { bands: { p200: 140_000 } });
  assertEquals(dist.inMarket, false);
  assertEquals(dist.state.distLatch, true);
  const blocked = decideSthCb(130_000, CB, 0, dist.state, cfg, { bands: { p200: 140_000 } });
  assertEquals(blocked.inMarket, false);
  assertEquals(blocked.rule, "R13 Entry blocked (post-distribution)");
  const cleared = decideSthCb(99_000, CB, 0, blocked.state, cfg, { bands: { p200: 140_000 } });
  assertEquals(cleared.state.distLatch, false);
  const re = decideSthCb(106_000, CB, 0, cleared.state, cfg, { bands: { p200: 140_000 } });
  assertEquals(re.position, "trend_hold");
});

Deno.test("Idea 14: LTH PVR lower band triggers a capitulation buy even above 70% of STH CB", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, capBuyAtLthSigma: -0.5 };
  const d = decideSthCb(80_000, CB, 0, CASH, cfg, { bands: { m050: 85_000 } });
  assertEquals(d.position, "cap_hold");
  assertEquals(d.rule, "R14 Capitulation buy (LTH m050)");
  const none = decideSthCb(80_000, CB, 0, CASH, cfg, { bands: { m050: 70_000 } });
  assertEquals(none.inMarket, false);
});

// ========================================================================================
// v2: scale-out at LTH bands + dip re-accumulation
// ========================================================================================

Deno.test("Idea 15: LTH scale-out tiers reduce targetAlloc step-wise and latch; alloc 0 = full exit", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, lthSellTiers: [{ sigma: 1.5, alloc: 0.75 }, { sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }] };
  const bands = { p150: 150_000, p200: 200_000, p250: 250_000 };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const a = decideSthCb(140_000, CB, 0, held, cfg, { bands }); assertEquals(a.targetAlloc, 1);
  const b = decideSthCb(155_000, CB, 0, a.state, cfg, { bands }); assertEquals(b.targetAlloc, 0.75); assertEquals(b.rule.startsWith("R15"), true);
  const c = decideSthCb(145_000, CB, 0, b.state, cfg, { bands }); assertEquals(c.targetAlloc, 0.75, "tier latches on a dip");
  const d = decideSthCb(205_000, CB, 0, c.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.5);
  const e = decideSthCb(260_000, CB, 0, d.state, cfg, { bands }); assertEquals(e.inMarket, false); assertEquals(e.state.distLatch, true);
});

Deno.test("Idea 15: lthSellMomoGate defers the partial sell while ROC > threshold", () => {
  const cfg: SthCbConfig = { ...DEFAULT_STH_CB_CONFIG, lthSellTiers: [{ sigma: 2, alloc: 0.5 }], lthSellMomoGate: true };
  const held: SthCbState = { capLatch: false, trendLatch: true };
  const deferred = decideSthCb(205_000, CB, +0.05, held, cfg, { bands: { p200: 200_000 } });
  assertEquals(deferred.targetAlloc, 1); assertEquals(deferred.sellDeferred, true);
  const fired = decideSthCb(205_000, CB, -0.01, deferred.state, cfg, { bands: { p200: 200_000 } });
  assertEquals(fired.targetAlloc, 0.5);
});

Deno.test("Idea 16: dip re-buy restores 100% after a pull-back from the post-sell peak and re-arms the tiers", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, lthSellTiers: [{ sigma: 2, alloc: 0.5 }], dipRebuyPct: 0.2 };
  const bands = { p200: 200_000 };
  let d = decideSthCb(205_000, CB, 0, { capLatch: false, trendLatch: true }, cfg, { bands }); assertEquals(d.targetAlloc, 0.5);
  d = decideSthCb(230_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.state.postSellPeak, 230_000);
  d = decideSthCb(190_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.5, "−17% not enough");
  d = decideSthCb(183_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 1); assertEquals(d.rule, "R16 Dip re-buy → 100% BTC");
  // next leg up through +2σ sells again
  d = decideSthCb(210_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.5);
  assertEquals(d.state.dipRebuys, 1);
});

Deno.test("Idea 16: dipRebuyMax caps re-accumulations; dipRebuyAtCbRatio alternative trigger", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, lthSellTiers: [{ sigma: 2, alloc: 0.5 }], dipRebuyAtCbRatio: 1.0, dipRebuyMax: 1 };
  const bands = { p200: 200_000 };
  let d = decideSthCb(205_000, CB, 0, { capLatch: false, trendLatch: true }, cfg, { bands }); assertEquals(d.targetAlloc, 0.5);
  d = decideSthCb(99_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 1, "re-buy at the cost basis");
  d = decideSthCb(205_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.5);
  d = decideSthCb(99_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.5, "max 1 re-buy per hold");
});

Deno.test("v2: a slice and a dip re-buy never happen in the same tick (same-tick cancellation bug, 2026-11-03)", () => {
  // Price above +1σ with negative momentum AND ≤ 110 % of CB on the same close: the slice must stand.
  const cfg: SthCbConfig = { ...NO_MOMO, momoEnabled: true, momoLength: 2, momoThreshold: -0.02, lthSellTiers: [{ sigma: 1, alloc: 0.3 }, { sigma: 2.5, alloc: 0 }], lthSellMomoGate: true, dipRebuyAtCbRatio: 1.1, dipRebuyMax: 3 };
  const bands = { p100: 100_000, p250: 300_000 };
  const cb = 95_000; // price 102k → 107 % of CB (≤ 110 %) while ≥ +1σ
  const d = decideSthCb(102_000, cb, -0.05, { capLatch: false, trendLatch: true, holdDays: 30 }, cfg, { bands });
  assertEquals(d.targetAlloc, 0.3, "slice to 30 % must not be reversed in the same tick");
  assertEquals(d.state.dipRebuys ?? 0, 0, "no re-buy consumed");
  assertEquals(d.state.lthTierLevel, 1);
  // Next day (no cooldown configured) the ≤ 110 % CB trigger may legitimately re-buy
  const n = decideSthCb(101_000, cb, 0.0, d.state, cfg, { bands });
  assertEquals(n.targetAlloc, 1);
  assertEquals(n.state.dipRebuys, 1);
});

Deno.test("v3 ①: exitBlockBelowLthSigma suppresses R2 / R3 / R12 while price ≤ the LTH band", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, exitBlockBelowLthSigma: -0.5, trailingStopPct: 0.35 };
  const bands = { m050: 27_200 };
  // cap hold, price ≥ capExitRatio × CB but below the LTH −0.5σ band → no R2
  let d = decideSthCb(27_000, 26_500, 0, { capLatch: true, trendLatch: false, holdDays: 40 }, cfg, { bands });
  assertEquals(d.inMarket, true); assertEquals(d.rule, "R2 deferred (LTH buy zone)");
  // same price, band lower → R2 fires
  d = decideSthCb(27_000, 26_500, 0, { capLatch: true, trendLatch: false, holdDays: 40 }, cfg, { bands: { m050: 25_000 } });
  assertEquals(d.inMarket, false); assertEquals(d.rule, "R2 Capitulation exit");
  // trend hold at 92 % of CB below the band → R3 deferred; trailing stop also held
  d = decideSthCb(25_900, 28_200, 0, { capLatch: false, trendLatch: true, holdDays: 200, peakPx: 45_000 }, cfg, { bands });
  assertEquals(d.inMarket, true); assertEquals(d.rule, "R3 deferred (LTH buy zone)");
});

Deno.test("v3 ②: exitSkipAboveLowPct skips the trend exit after a V-bottom recovery", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, exitSkipAboveLowPct: 0.10 };
  // price 59k, 10-day low 53.3k → +10.7 % above the low → skip
  let d = decideSthCb(59_000, 64_600, 0, { capLatch: false, trendLatch: true, holdDays: 100 }, cfg, { lowN: 53_300 });
  assertEquals(d.inMarket, true); assertEquals(d.rule, "R3 deferred (recovered from low)");
  // low closer to price → exit allowed
  d = decideSthCb(59_000, 64_600, 0, { capLatch: false, trendLatch: true, holdDays: 100 }, cfg, { lowN: 57_000 });
  assertEquals(d.inMarket, false); assertEquals(d.rule, "R3 Trend exit");
});

Deno.test("v3 ④: lthFirstRungMomoThreshold applies to rung 1 only", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, momoEnabled: true, momoLength: 2, momoThreshold: -0.02, lthSellTiers: [{ sigma: 1, alloc: 0.3 }, { sigma: 1.5, alloc: 0.2 }, { sigma: 2.5, alloc: 0 }], lthSellMomoGate: true, lthFirstRungMomoThreshold: 0 };
  const bands = { p100: 100_000, p150: 150_000, p250: 300_000 };
  // rung 1 with ROC −1 % (> −2 % but ≤ 0) → sells under the lighter threshold
  let d = decideSthCb(110_000, 90_000, -0.01, { capLatch: false, trendLatch: true, holdDays: 30 }, cfg, { bands });
  assertEquals(d.targetAlloc, 0.3);
  // rung 2 with ROC −1 % → regular threshold (−2 %) still gates
  d = decideSthCb(160_000, 90_000, -0.01, d.state, cfg, { bands });
  assertEquals(d.targetAlloc, 0.3); assertEquals(d.rule, "R15 deferred (momentum)");
  d = decideSthCb(160_000, 90_000, -0.03, d.state, cfg, { bands });
  assertEquals(d.targetAlloc, 0.2);
});

Deno.test("v2.2: no-loss ladder — re-buy only below the last slice, slice only above the last buy", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, lthSellTiers: [{ sigma: 1, alloc: 0.3 }, { sigma: 2.5, alloc: 0 }], dipRebuyPct: 0.1, rebuyBelowLastSellPct: 0, sliceAboveLastBuyPct: 0 };
  const bands = { p100: 100_000, p250: 300_000 };
  // entry at 90k (below +1σ) then slice at 101k
  let d = decideSthCb(90_000, 80_000, 0, CASH, cfg, { bands }); assertEquals(d.position, "trend_hold");
  d = decideSthCb(101_000, 80_000, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.3); assertEquals(d.state.lastSlicePx, 101_000);
  // −10 % from the post-slice peak but ABOVE the slice price (peak ran to 120k, now 106k) → blocked
  d = decideSthCb(120_000, 80_000, 0, d.state, cfg, { bands });
  d = decideSthCb(106_000, 80_000, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.3, "re-buy above the slice price is blocked");
  // below the slice price → allowed
  d = decideSthCb(100_000, 80_000, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 1); assertEquals(d.state.lastBuyPx, 100_000);
  // next slice attempt below the re-buy price (99k ≥ +1σ? no — use 100.5k ≥ p100 but ≥ lastBuy) — set p100 lower to force the rung
  const cfg2 = { ...cfg, lthSellTiers: [{ sigma: 1, alloc: 0.3 }, { sigma: 2.5, alloc: 0 }] };
  d = decideSthCb(99_500, 80_000, 0, d.state, cfg2, { bands: { p100: 95_000, p250: 300_000 } }); assertEquals(d.targetAlloc, 1, "slice below the last buy is blocked"); assertEquals(d.rule, "R15 deferred (below last buy)");
  d = decideSthCb(100_500, 80_000, 0, d.state, cfg2, { bands: { p100: 95_000, p250: 300_000 } }); assertEquals(d.targetAlloc, 0.3);
});

Deno.test("v2.2: reentryBelowLastExitPct — cheap re-entry only at or below the exit price; full entry still works", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, trendEnterRatio: 1.12, trendExitRatio: 0.97, trendReentryRatio: 1.02, reentryBelowLastExitPct: 0 };
  let d = decideSthCb(100_000, 85_000, 0, CASH, cfg); assertEquals(d.position, "trend_hold");
  d = decideSthCb(80_000, 85_000, 0, { ...d.state, holdDays: 40 }, cfg); assertEquals(d.inMarket, false); assertEquals(d.state.lastExitPx, 80_000);
  // 102 % of CB but above the exit price → no R5
  d = decideSthCb(86_700, 85_000, 0, d.state, cfg); assertEquals(d.inMarket, false);
  // 102 % of CB and ≤ exit price → R5
  d = decideSthCb(78_000, 76_000, 0, d.state, cfg); assertEquals(d.inMarket, true); assertEquals(d.rule, "R5 Trend re-entry (ladder)");
  // full 112 % entry is never guarded
  const e = decideSthCb(96_000, 85_000, 0, { capLatch: false, trendLatch: false, reentryArmed: true, lastExitPx: 80_000 }, cfg); assertEquals(e.inMarket, true); assertEquals(e.rule, "R3 Trend entry");
});

Deno.test("v2.2: exitMinGainPct — R2 / R3 wait for a gain over the entry; trailing stop still exits", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, exitMinGainPct: 0, trailingStopPct: 0.35 };
  // cap hold entered at 22k (CB 32k); later price 21k at 102 % of CB → R2 condition met but below entry → blocked
  let d = decideSthCb(22_000, 32_000, 0, CASH, cfg); assertEquals(d.position, "cap_hold");
  d = decideSthCb(21_000, 20_500, 0, { ...d.state, holdDays: 40 }, cfg);
  assertEquals(d.inMarket, true); assertEquals(d.rule, "R2 deferred (below entry)");
  d = decideSthCb(22_500, 22_000, 0, d.state, cfg); assertEquals(d.inMarket, false);
  assertEquals(d.rule, "R2 Capitulation exit");
  // trend hold entered at 95k, falls 36 % → trailing stop fires even though below entry
  let t = decideSthCb(95_000, 80_000, 0, CASH, cfg); assertEquals(t.position, "trend_hold");
  t = decideSthCb(60_000, 80_000, 0, { ...t.state, holdDays: 40, peakPx: 95_000 }, cfg); assertEquals(t.inMarket, false); assertEquals(t.rule, "R12 Trailing stop (35%)");
});

Deno.test("v2.2: ladder rungs as multiples of the STH cost basis (cbRatio)", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, lthSellTiers: [{ cbRatio: 1.25, alloc: 0.5 }, { cbRatio: 1.5, alloc: 0 }] };
  let d = decideSthCb(100_000, 90_000, 0, { capLatch: false, trendLatch: true, holdDays: 30 }, cfg); assertEquals(d.targetAlloc, 1);
  d = decideSthCb(113_000, 90_000, 0, d.state, cfg); assertEquals(d.targetAlloc, 0.5); assertEquals(d.rule, "R15 LTH scale-out tier 1 → 50% BTC (125% CB)");
  d = decideSthCb(136_000, 90_000, 0, d.state, cfg); assertEquals(d.inMarket, false);
});

Deno.test("v2: scaleCooldownDays blocks a re-buy / next partial sell inside the window; full exit always allowed", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, lthSellTiers: [{ sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }], dipRebuyAtCbRatio: 1.0, scaleCooldownDays: 3 };
  const bands = { p200: 200_000, p250: 250_000 };
  let d = decideSthCb(205_000, CB, 0, { capLatch: false, trendLatch: true, holdDays: 5 }, cfg, { bands }); assertEquals(d.targetAlloc, 0.5);
  d = decideSthCb(99_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.5, "day 1 after sell: cooldown");
  d = decideSthCb(99_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 0.5, "day 2");
  d = decideSthCb(99_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 1, "day 3: re-buy allowed");
  d = decideSthCb(205_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.targetAlloc, 1, "partial sell blocked by cooldown");
  d = decideSthCb(260_000, CB, 0, d.state, cfg, { bands }); assertEquals(d.inMarket, false, "full exit ignores cooldown");
});

Deno.test("v2: a hold entered above a tier does not scale out on entry day", () => {
  const cfg: SthCbConfig = { ...NO_MOMO, lthSellTiers: [{ sigma: 1, alloc: 0.8 }, { sigma: 2.5, alloc: 0 }] };
  const bands = { p100: 100_000, p250: 300_000 };
  const entry = decideSthCb(120_000, CB, 0, CASH, cfg, { bands }); // trend entry at 120% with price already above +1σ
  assertEquals(entry.position, "trend_hold");
  assertEquals(entry.targetAlloc, 1);
  const next = decideSthCb(121_000, CB, 0, entry.state, cfg, { bands });
  assertEquals(next.targetAlloc, 1, "tier 1 was initialised at entry; no sell until a higher tier");
});
