// tools/sth_cb_lab/ideas.ts
// Parameter grids for each refinement idea. Keys are SthCbConfig fields; every
// combination in the cartesian product is evaluated (or randomly sampled when
// the product is larger than --samples). `null` means "flag off".

import type { AllocTier } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";

export interface IdeaSpec {
  title: string;
  description: string;
  grid: Record<string, unknown[]>;
}

const TIERS_IN: (AllocTier[] | null)[] = [
  null,
  [{ ratio: 0.70, alloc: 0.5 }, { ratio: 0.60, alloc: 1 }],
  [{ ratio: 0.75, alloc: 0.34 }, { ratio: 0.65, alloc: 0.67 }, { ratio: 0.55, alloc: 1 }],
  [{ ratio: 0.70, alloc: 0.6 }, { ratio: 0.55, alloc: 1 }],
  [{ ratio: 0.80, alloc: 0.25 }, { ratio: 0.70, alloc: 0.5 }, { ratio: 0.60, alloc: 0.75 }, { ratio: 0.50, alloc: 1 }],
];

const TIERS_OUT: (AllocTier[] | null)[] = [
  null,
  [{ ratio: 1.50, alloc: 0.66 }, { ratio: 2.00, alloc: 0.33 }],
  [{ ratio: 1.40, alloc: 0.75 }, { ratio: 1.70, alloc: 0.50 }, { ratio: 2.00, alloc: 0.25 }],
  [{ ratio: 1.60, alloc: 0.50 }, { ratio: 2.20, alloc: 0 }],
  [{ ratio: 1.30, alloc: 0.80 }, { ratio: 1.60, alloc: 0.50 }, { ratio: 2.00, alloc: 0.20 }],
];

export const IDEAS: Record<string, IdeaSpec> = {
  base: {
    title: "Base thresholds + momentum",
    description: "Sweep the four ratio thresholds and the momentum gate of the original strategy.",
    grid: {
      capBuyRatio: [0.60, 0.65, 0.70, 0.75, 0.80],
      capExitRatio: [0.95, 1.00, 1.05, 1.10],
      trendEnterRatio: [1.02, 1.05, 1.08, 1.10],
      trendExitRatio: [0.90, 0.92, 0.95, 0.97],
      momoLength: [3, 5, 7, 10],
      momoThreshold: [-0.02, 0, 0.02],
    },
  },
  "1": {
    title: "Anti-whipsaw trend exit",
    description: "Confirmation days and/or a slower ROC on exits, across exit depths.",
    grid: {
      trendExitConfirmDays: [1, 2, 3, 5, 7],
      exitRocLength: [null, 10, 14, 20, 30],
      trendExitRatio: [0.90, 0.92, 0.95, 0.97],
    },
  },
  "2": {
    title: "Scale in / scale out",
    description: "Tiered capitulation buys and tiered distribution sells.",
    grid: {
      capBuyTiers: TIERS_IN,
      sellTiers: TIERS_OUT,
    },
  },
  "3": {
    title: "Cost-basis slope filter",
    description: "Only honour the −5 % trend exit when the STH cost basis is flat or falling.",
    grid: {
      cbSlopeDays: [null, 7, 14, 30, 60],
      trendExitRatio: [0.90, 0.92, 0.95, 0.97],
    },
  },
  "4": {
    title: "Hybrid: distribute at LTH PVR bands",
    description: "Exit at +1.5σ/+2σ/+2.5σ LTH PVR bands, with or without the −5 % trend exit.",
    grid: {
      distributeAtSigma: [null, 1.5, 2.0, 2.5],
      disableTrendExit: [false, true],
      trendExitRatio: [0.90, 0.95],
    },
  },
  "5": {
    title: "Re-entry ladder",
    description: "After a trend exit, re-enter at a lower ratio than the fresh 105 % entry.",
    grid: {
      trendReentryRatio: [null, 0.98, 1.00, 1.02, 1.04],
      trendExitRatio: [0.90, 0.92, 0.95, 0.97],
      trendEnterRatio: [1.05, 1.08, 1.10],
    },
  },
  "7": {
    title: "σ-adaptive thresholds",
    description: "Express entry/exit levels in σ of ln(price/CB) so they widen in volatile regimes and tighten in calm ones.",
    grid: {
      sigmaMode: ["ratio_sigma"],
      sigmaWindow: [90, 180, 365, 730, 0],
      capBuySigma: [-2.5, -2, -1.5, -1.25, -1],
      capExitSigma: [-0.5, -0.25, 0, 0.25],
      trendEnterSigma: [0.25, 0.5, 0.75, 1],
      trendExitSigma: [-0.75, -0.5, -0.25, 0],
    },
  },
  "8": {
    title: "Momentum re-entry",
    description: "After a trend exit, re-board when ROC recovers instead of waiting for +5 %.",
    grid: { reentryRocThreshold: [null, 0, 0.02, 0.05, 0.1], trendReentryRatio: [null, 0.98, 1.0, 1.02], trendExitRatio: [0.9, 0.92, 0.95] },
  },
  "9": {
    title: "Minimum hold",
    description: "Ignore exits for N days after an entry.",
    grid: { minHoldDays: [null, 5, 10, 20, 30, 60], trendExitRatio: [0.92, 0.95, 0.97] },
  },
  "10": {
    title: "LTH macro filter",
    description: "No trend entries while price is above an LTH PVR +σ band.",
    grid: { blockEntryAboveSigma: [null, 1.5, 2, 2.5], distributeAtSigma: [null, 2, 2.5], disableTrendExit: [false, true] },
  },
  "11": {
    title: "Capitulation confirmation",
    description: "Only buy the 70 % level once ROC has turned.",
    grid: { capBuyRocThreshold: [null, -0.05, 0, 0.02, 0.05], momoLength: [3, 5, 7, 10], capBuyRatio: [0.65, 0.7, 0.75] },
  },
  "12": {
    title: "Trailing stop",
    description: "Exit a trend hold X % below its running peak.",
    grid: { trailingStopPct: [null, 0.15, 0.2, 0.25, 0.3, 0.4], disableTrendExit: [false, true], trendReentryRatio: [null, 1.0, 1.02] },
  },
  hybrid: {
    title: "Hybrid neighbourhood (R1 winner region)",
    description: "LTH +σ distribution + no −5 % exit + cheap re-entry; sweeps the knobs that mattered in the first lump-sum campaign.",
    grid: {
      capBuyRatio: [0.6, 0.65, 0.7, 0.75],
      capExitRatio: [0.9, 0.95, 1.0],
      trendEnterRatio: [1.02, 1.05, 1.08, 1.1, 1.15],
      trendReentryRatio: [null, 1.0, 1.02, 1.05],
      momoLength: [3, 5, 7, 10],
      momoThreshold: [-0.05, -0.02, 0, 0.02],
      distributeAtSigma: [1.5, 2, 2.5],
      disableTrendExit: [false, true],
      trendExitRatio: [0.85, 0.9, 0.92, 0.95],
      trendExitConfirmDays: [1, 3, 7],
      cbSlopeDays: [null, 14, 30],
      trailingStopPct: [null, 0.25, 0.35, 0.45],
      reentryRocThreshold: [null, 0.02, 0.05],
      minHoldDays: [null, 10, 30],
      blockEntryAboveSigma: [null, 2.5],
      capBuyRocThreshold: [null, 0],
      distReentryClearRatio: [null, 1.1, 1.0, 0.95, 0.9],
      capBuyAtLthSigma: [null, 0, -0.5, -1],
    },
  },
  fine: {
    title: "Fine local search around the R3 winner",
    description: "Tighter steps on every knob that mattered; use with --base set to the R3 winner.",
    grid: {
      capBuyRatio: [0.65, 0.7, 0.75, 0.8],
      capExitRatio: [0.85, 0.88, 0.9, 0.92, 0.95],
      trendEnterRatio: [1.05, 1.06, 1.08, 1.1, 1.12],
      trendExitRatio: [0.9, 0.93, 0.95, 0.97],
      trendExitConfirmDays: [1, 2, 3],
      momoLength: [2, 3, 4, 5, 7],
      momoThreshold: [-0.08, -0.05, -0.03, -0.02, 0],
      distributeAtSigma: [2, 2.5],
      cbSlopeDays: [null, 14, 21, 30, 45, 60],
      trailingStopPct: [0.25, 0.3, 0.33, 0.35, 0.38, 0.4, 0.45],
      reentryRocThreshold: [null, 0.03, 0.05, 0.08, 0.1],
      trendReentryRatio: [null, 1.0, 1.02],
      minHoldDays: [null, 5, 10, 15, 20],
      blockEntryAboveSigma: [null, 2, 2.5],
      distReentryClearRatio: [null, 0.8, 0.85, 0.9, 0.95],
      capBuyAtLthSigma: [null, -0.25, -0.5, -0.75, -1],
      capBuyRocThreshold: [null, 0],
      sellTiers: [null, [{ ratio: 1.8, alloc: 0 }], [{ ratio: 2.0, alloc: 0 }], [{ ratio: 1.6, alloc: 0.5 }, { ratio: 2.0, alloc: 0 }]],
      capBuyTiers: [null, [{ ratio: 0.7, alloc: 0.6 }, { ratio: 0.55, alloc: 1 }]],
    },
  },
  v2: {
    title: "v2 — scale-out into euphoria + re-accumulate on the pull-back",
    description: "LTH-band sell ladders (optionally momentum-gated) and dip re-buy rules, on top of hybrid v1 (--base). Also re-tunes the knobs that interact with scale-out.",
    grid: {
      lthSellTiers: [
        null,
        [{ sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 2, alloc: 0.75 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 2, alloc: 0.25 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1.5, alloc: 0.75 }, { sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1.5, alloc: 0.8 }, { sigma: 2, alloc: 0.6 }, { sigma: 2.5, alloc: 0.3 }],
        [{ sigma: 2, alloc: 0.6 }, { sigma: 2.5, alloc: 0.3 }],
        [{ sigma: 2, alloc: 0.5 }],
        [{ sigma: 2.5, alloc: 0.5 }],
        [{ sigma: 1.5, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1, alloc: 0.85 }, { sigma: 1.5, alloc: 0.7 }, { sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }],
      ],
      lthSellMomoGate: [false, true],
      dipRebuyPct: [null, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4],
      dipRebuyAtCbRatio: [null, 1.0, 1.05, 1.1],
      dipRebuyMax: [null, 1, 2],
      // interacting knobs
      distributeAtSigma: [null, 2.5],
      sellTiers: [null, [{ ratio: 2, alloc: 0 }], [{ ratio: 2.5, alloc: 0 }]],
      trailingStopPct: [null, 0.3, 0.35, 0.45],
      distReentryClearRatio: [null, 0.9, 1.0],
      momoLength: [2, 3, 5],
      momoThreshold: [-0.05, -0.02, 0],
    },
  },
  v2fine: {
    title: "v2 fine — around the first scale-out winner",
    description: "Tier allocations and σ placements, dip re-buy depth, gate, on top of the v2 R1 winner (--base).",
    grid: {
      lthSellTiers: [
        [{ sigma: 1, alloc: 0.85 }, { sigma: 1.5, alloc: 0.7 }, { sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1, alloc: 0.9 }, { sigma: 1.5, alloc: 0.75 }, { sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1, alloc: 0.8 }, { sigma: 1.5, alloc: 0.6 }, { sigma: 2, alloc: 0.4 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1, alloc: 0.85 }, { sigma: 1.5, alloc: 0.7 }, { sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0.25 }],
        [{ sigma: 1, alloc: 0.85 }, { sigma: 1.5, alloc: 0.7 }, { sigma: 2, alloc: 0.4 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1, alloc: 0.9 }, { sigma: 1.5, alloc: 0.8 }, { sigma: 2, alloc: 0.6 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 0.5, alloc: 0.9 }, { sigma: 1, alloc: 0.8 }, { sigma: 1.5, alloc: 0.65 }, { sigma: 2, alloc: 0.45 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1, alloc: 0.85 }, { sigma: 1.5, alloc: 0.7 }, { sigma: 2, alloc: 0.5 }],
        [{ sigma: 1.5, alloc: 0.7 }, { sigma: 2, alloc: 0.5 }, { sigma: 2.5, alloc: 0 }],
        [{ sigma: 1, alloc: 0.75 }, { sigma: 1.5, alloc: 0.5 }, { sigma: 2, alloc: 0.25 }, { sigma: 2.5, alloc: 0 }],
      ],
      lthSellMomoGate: [true, false],
      dipRebuyPct: [null, 0.05, 0.08, 0.1, 0.12, 0.15, 0.2],
      dipRebuyAtCbRatio: [null, 1.0, 1.02, 1.05, 1.08, 1.1, 1.15],
      dipRebuyMax: [1, 2, 3, null],
      scaleCooldownDays: [null, 2, 3, 4, 5, 6, 7, 10],
      momoLength: [2, 3, 4],
      momoThreshold: [-0.03, -0.02, -0.01, 0],
      trailingStopPct: [0.3, 0.35, 0.4, 0.45, null],
      minHoldDays: [10, 15, 20],
      distReentryClearRatio: [0.85, 0.9, 0.95, 1.0],
      trendExitRatio: [0.95, 0.97, 0.98],
    },
  },
  all: {
    title: "Everything (random search only)",
    description: "Union of all grids — far too large to enumerate; use --mode random --samples N.",
    grid: {
      capBuyRatio: [0.60, 0.65, 0.70, 0.75],
      capExitRatio: [0.95, 1.00, 1.05],
      trendEnterRatio: [1.02, 1.05, 1.08, 1.10],
      trendExitRatio: [0.90, 0.92, 0.95, 0.97],
      momoLength: [3, 5, 7, 10],
      momoThreshold: [-0.02, 0, 0.02],
      trendExitConfirmDays: [1, 2, 3, 5],
      exitRocLength: [null, 10, 20],
      capBuyTiers: TIERS_IN,
      sellTiers: TIERS_OUT,
      cbSlopeDays: [null, 14, 30],
      distributeAtSigma: [null, 2.0, 2.5],
      disableTrendExit: [false, true],
      trendReentryRatio: [null, 1.00, 1.02],
      sigmaMode: [null, "ratio_sigma"],
      sigmaWindow: [180, 365, 730],
      capBuySigma: [null, -2, -1.5],
      capExitSigma: [null, -0.25, 0],
      trendEnterSigma: [null, 0.5, 0.75],
      trendExitSigma: [null, -0.5, -0.25],
      reentryRocThreshold: [null, 0.02, 0.05],
      minHoldDays: [null, 10, 30],
      blockEntryAboveSigma: [null, 2, 2.5],
      capBuyRocThreshold: [null, 0],
      trailingStopPct: [null, 0.2, 0.3],
    },
  },
};

export function gridSize(grid: Record<string, unknown[]>): number {
  return Object.values(grid).reduce((n, vals) => n * vals.length, 1);
}

/** Cartesian product generator. */
export function* enumerateGrid(grid: Record<string, unknown[]>): Generator<Record<string, unknown>> {
  const keys = Object.keys(grid);
  const idx = new Array(keys.length).fill(0);
  if (!keys.length) { yield {}; return; }
  while (true) {
    const combo: Record<string, unknown> = {};
    keys.forEach((k, i) => { combo[k] = grid[k][idx[i]]; });
    yield combo;
    let i = keys.length - 1;
    while (i >= 0) {
      idx[i]++;
      if (idx[i] < grid[keys[i]].length) break;
      idx[i] = 0;
      i--;
    }
    if (i < 0) return;
  }
}

export function sampleGrid(grid: Record<string, unknown[]>, n: number, seed = 42): Record<string, unknown>[] {
  // xorshift32 for reproducible sampling
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const keys = Object.keys(grid);
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  const max = Math.min(n, gridSize(grid));
  let guard = 0;
  while (out.length < max && guard++ < max * 50) {
    const combo: Record<string, unknown> = {};
    for (const k of keys) combo[k] = grid[k][Math.floor(rnd() * grid[k].length)];
    const sig = JSON.stringify(combo);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(combo);
  }
  return out;
}

/** Drop `null` flags so the config falls back to "off" for that feature. */
export function cleanCombo(combo: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(combo)) if (v !== null && typeof v !== "undefined") out[k] = v;
  return out;
}
