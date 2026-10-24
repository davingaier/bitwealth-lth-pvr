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
