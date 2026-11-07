// tools/sth_cb_lab/factsheet_data_configs.ts
// The promoted STH_CB Hybrid configurations (v1 → v2.2). Kept in a side-effect-free module so other scripts
// (factsheet_data.ts, one_pager_data.ts) can import them without running a generator.

export const HYBRID_V1 = {
  capBuyRatio: 0.75, capExitRatio: 0.95, trendEnterRatio: 1.12, trendExitRatio: 0.97,
  momoLength: 2, momoThreshold: -0.02, distributeAtSigma: 2.5, cbSlopeDays: 21, trailingStopPct: 0.35,
  reentryRocThreshold: 0.1, minHoldDays: 15, blockEntryAboveSigma: 2.5, distReentryClearRatio: 0.9,
  capBuyAtLthSigma: -0.5, trendReentryRatio: 1.02, capBuyRocThreshold: 0, sellTiers: [{ ratio: 2, alloc: 0 }],
};

// v2 = v1 minus the single +2.5σ distribution, plus a momentum-gated scale-out ladder, dip re-buy and cooldown.
export const HYBRID_V2 = {
  capBuyRatio: 0.75, capExitRatio: 0.95, trendEnterRatio: 1.12, trendExitRatio: 0.97,
  momoLength: 2, momoThreshold: -0.02, cbSlopeDays: 21, trailingStopPct: 0.35,
  reentryRocThreshold: 0.1, minHoldDays: 15, blockEntryAboveSigma: 2.5, distReentryClearRatio: 0.85,
  capBuyAtLthSigma: -0.5, trendReentryRatio: 1.02, capBuyRocThreshold: 0,
  lthSellTiers: [{ sigma: 1, alloc: 0.75 }, { sigma: 1.5, alloc: 0.5 }, { sigma: 2, alloc: 0.25 }, { sigma: 2.5, alloc: 0 }],
  lthSellMomoGate: true, dipRebuyPct: 0.1, dipRebuyAtCbRatio: 1.1, dipRebuyMax: 3, scaleCooldownDays: 5,
};

// v2.1 = v2 with the slice sizes optimised by ladder_optimize.ts (2026-10-27): 30/20/10/0 % instead of 75/50/25/0 %.
// 2026-11-03: re-buy knobs corrected after the same-tick slice/re-buy bug fix — ≤105 % CB, max 1, cooldown 2
// (the previous ≤110 % / max 3 / cooldown 5 had been fitted against the bug and oscillates on the corrected engine).
export const HYBRID_V2_1 = {
  ...HYBRID_V2,
  lthSellTiers: [{ sigma: 1, alloc: 0.3 }, { sigma: 1.5, alloc: 0.2 }, { sigma: 2, alloc: 0.1 }, { sigma: 2.5, alloc: 0 }],
  dipRebuyAtCbRatio: 1.05, dipRebuyMax: 1, scaleCooldownDays: 2,
};

// v2.2 = v2.1 + the "no-loss ladder" rule (sliceAboveLastBuyPct 0: a slice is only sold above the last buy / re-buy
// price) which replaces the cooldown, plus an earlier first rung found by ladder_optimize.ts on that base (2026-11-03):
// 50/20/10/0 % at +0.5/1/1.5/2.5σ. Table basis ($2.4k + $200/mo to 2026-06-09) +9–12 % vs v2.1 on every horizon,
// walk-forward 8/10 standard / 7/11 table (v2.1: 6/11).
// 2026-11-06 (promoted in place, Davin): + capBuyRocLength 4 — the capitulation-buy confirmation reads a 4-day ROC
// instead of the 2-day momentum ROC, which could never confirm inside a V-shaped flush (Feb-2026: 11 closes ≤ 75 % of
// CB, no buy). UTC closes $1k 2017→2026-11-05: $2.47M / 32.6× HODL / DD 36 % (was $2.31M / 30.5× / 40 %).
export const HYBRID_V2_2 = (() => {
  const { scaleCooldownDays: _cd, ...rest } = HYBRID_V2_1;
  return {
    ...rest,
    lthSellTiers: [{ sigma: 0.5, alloc: 0.5 }, { sigma: 1, alloc: 0.2 }, { sigma: 1.5, alloc: 0.1 }, { sigma: 2.5, alloc: 0 }],
    sliceAboveLastBuyPct: 0,
    // 2026-11-07 (promoted in place, autonomous optimisation sprint): exit momentum gate −3 % (was −2 %, the edge of a
    // cliff: −1.5 % loses 21 %, −1 % halves) and 3-day capitulation ROC (was 4). Smooth hill in the 2-D map, wins
    // every start year 2017–2024, 2020→ test window 6.55× → 9.58×; 2015–19 slightly weaker (4.72× → 4.23×).
    momoThreshold: -0.03,
    capBuyRocLength: 3,
  };
})();

