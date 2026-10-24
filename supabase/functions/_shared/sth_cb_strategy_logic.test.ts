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
  assertEquals(d.state, held);
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
  assertEquals(s, { capLatch: true, trendLatch: false });
});
