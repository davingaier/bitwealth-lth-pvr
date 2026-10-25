// tools/sth_cb_lab/lth_core.ts
// LTH PVR engine (B1–B11 / momentum / bear-pause+retrace) driven by "sth_cb"
// bands: mean = STH cost basis, ±σ bands per _shared/sth_cb_bands.ts.
// Shared by lth_run.ts, lth_optimize.ts and lth_worker.ts.

import { runSimulation, SimulationParams, SimulationResult, CIBandData } from "../../supabase/functions/_shared/lth_pvr_simulator.ts";
import { StrategyConfig } from "../../supabase/functions/_shared/lth_pvr_strategy_logic.ts";
import { computeSthCbBands, SthCbBandParams, bandSpecString, parseBandSpec } from "../../supabase/functions/_shared/sth_cb_bands.ts";
import { SthCbSeriesRow } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { Fold, LabArgs } from "./lab_core.ts";

/** Production "Progressive" LTH PVR variation — the starting point for every search. */
export const PROD_LTH_CONFIG: StrategyConfig = {
  B: { B1: 0.22796, B2: 0.21397, B3: 0.19943, B4: 0.18088, B5: 0.12229, B6: 0.00157, B7: 0.002, B8: 0.00441, B9: 0.01287, B10: 0.033, B11: 0.09572 },
  bearPauseEnterSigma: 2.0,
  bearPauseExitSigma: -1.0,
  momentumLength: 5,
  momentumThreshold: 0.0,
  enableRetrace: true,
  retraceBase: 3,
};

/** One candidate = band definition + LTH strategy config. */
export interface LthCandidate {
  bands: SthCbBandParams;
  config: StrategyConfig;
}

export interface LthMetrics {
  final_nav_usd: number;
  final_roi_percent: number;
  final_cagr_percent: number;
  max_drawdown_percent: number;
  sharpe_ratio: number;
  nav_vs_hodl: number;
  nav_vs_std_dca: number;
  hodl_final_nav_usd: number;
  std_dca_final_nav_usd: number;
  trades: number;
  buys: number;
  sells: number;
  pct_time_invested: number; // % of days with BTC > 0
  fees_total_usdt: number;
}

export interface LthEval {
  cand: LthCandidate;
  metrics: LthMetrics;
  folds?: Array<{ fold: Fold; nav_vs_hodl: number; roi: number; beat_hodl: boolean }>;
  folds_beating_hodl?: number;
}

// Silence the simulator's console chatter (it logs debug blocks on every run)
export function muteConsole() {
  console.log = () => {};
  console.info = () => {};
}

const bandCache = new Map<string, CIBandData[]>();

/** Band rows for a given definition, memoised per worker (band calc is the expensive part). */
export function bandRows(series: SthCbSeriesRow[], bp: SthCbBandParams): CIBandData[] {
  const key = bandSpecString(bp);
  let rows = bandCache.get(key);
  if (!rows) {
    rows = computeSthCbBands(series, bp) as unknown as CIBandData[];
    bandCache.set(key, rows);
  }
  return rows;
}

export function simParamsLth(l: LabArgs, start: string): SimulationParams {
  const full = l.fees === "full";
  return {
    upfront_usd: l.upfront,
    monthly_usd: l.monthly,
    org_id: "lab",
    trade_fee_rate: l.tradeBps / 10_000,
    contrib_fee_rate: l.contribBps / 10_000,
    fee_plan: "management",
    platform_fee_rate: 0.0075,
    management_fee_rate: full ? 0.01 : 0,
    performance_fee_rate: full ? 0.10 : 0,
    usdpc_enabled: full,
    usdpc_apy: 0.10,
    usdpc_conversion_fee_rate: 0.001,
    sim_start_date: start,
  };
}

export function metricsOf(r: SimulationResult): LthMetrics {
  let buys = 0, sells = 0, invested = 0;
  for (const d of r.daily) {
    if (d.action === "BUY") buys++;
    else if (d.action === "SELL") sells++;
    if (d.btc_balance > 1e-9) invested++;
  }
  return {
    final_nav_usd: r.final_nav_usd,
    final_roi_percent: r.final_roi_percent,
    final_cagr_percent: r.final_cagr_percent,
    max_drawdown_percent: r.max_drawdown_percent,
    sharpe_ratio: r.sharpe_ratio,
    nav_vs_hodl: r.hodl_final_nav_usd > 0 ? r.final_nav_usd / r.hodl_final_nav_usd : NaN,
    nav_vs_std_dca: r.std_dca_final_nav_usd > 0 ? r.final_nav_usd / r.std_dca_final_nav_usd : NaN,
    hodl_final_nav_usd: r.hodl_final_nav_usd,
    std_dca_final_nav_usd: r.std_dca_final_nav_usd,
    trades: buys + sells,
    buys,
    sells,
    pct_time_invested: r.daily.length ? Math.round(invested / r.daily.length * 10_000) / 100 : 0,
    fees_total_usdt: (r.total_platform_fees_usdt ?? 0) + (r.total_management_fees_usdt ?? 0) + (r.total_performance_fees_usdt ?? 0) + (r.total_usdpc_conversion_fees_usdt ?? 0),
  };
}

export function runLth(series: SthCbSeriesRow[], l: LabArgs, cand: LthCandidate, start = l.start, end = l.end): SimulationResult {
  // Bands use the full history (expanding statistics); the engine only needs ~2 years of warm-up
  // before `start` to seed bear-pause / retrace state (same convention as ef_bt_execute).
  const warmFrom = `${Number(start.slice(0, 4)) - 2}${start.slice(4)}`;
  const rows = bandRows(series, cand.bands).filter((r) => r.close_date >= warmFrom && r.close_date <= end);
  return runSimulation(cand.config, rows, simParamsLth(l, start));
}

export function evaluateLth(series: SthCbSeriesRow[], l: LabArgs, cand: LthCandidate, folds?: Fold[]): LthEval {
  const r = runLth(series, l, cand);
  const out: LthEval = { cand, metrics: metricsOf(r) };
  if (folds?.length) {
    out.folds = folds.map((f) => {
      const fr = runLth(series, l, cand, f.oosStart, f.oosEnd);
      const nvh = fr.hodl_final_nav_usd > 0 ? fr.final_nav_usd / fr.hodl_final_nav_usd : NaN;
      return { fold: f, nav_vs_hodl: nvh, roi: fr.final_roi_percent, beat_hodl: nvh > 1 };
    });
    out.folds_beating_hodl = out.folds.filter((f) => f.beat_hodl).length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search space
// ---------------------------------------------------------------------------
export type Gene =
  | "bandSpec"
  | "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7" | "B8" | "B9" | "B10" | "B11"
  | "momentumLength" | "momentumThreshold"
  | "bearPauseEnterSigma" | "bearPauseExitSigma"
  | "enableRetrace" | "retraceBase";

export const GENES: Record<Gene, unknown[]> = {
  bandSpec: [
    "sth_pvr:auto", "sth_pvr:0.25", "sth_pvr:0.35", "sth_pvr:0.5", "sth_pvr:0.75", "sth_pvr:1", "sth_pvr:1.25", "sth_pvr:1.5", "sth_pvr:2", "sth_pvr:3",
    "ratio_sigma:90:1", "ratio_sigma:180:1", "ratio_sigma:365:1", "ratio_sigma:730:1", "ratio_sigma:0:1",
    "ratio_sigma:180:0.5", "ratio_sigma:365:0.5", "ratio_sigma:180:0.75", "ratio_sigma:365:0.75",
    "ratio_sigma:365:1.5", "ratio_sigma:730:1.5", "ratio_sigma:365:2", "ratio_sigma:730:2",
  ],
  B1: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 1.0],
  B2: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 1.0],
  B3: [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 1.0],
  B4: [0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0],
  B5: [0, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0],
  B6: [0, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05],
  B7: [0, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1],
  B8: [0, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2],
  B9: [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0],
  B10: [0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0],
  B11: [0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0],
  momentumLength: [3, 5, 7, 10, 14, 21, 30],
  momentumThreshold: [-0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1, 0.2],
  bearPauseEnterSigma: [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 9.0],   // 9.0 = effectively never pause
  bearPauseExitSigma: [-1.5, -1.25, -1.0, -0.75, -0.5, -0.25, 0, 0.5, 1.0],
  enableRetrace: [true, false],
  retraceBase: [1, 2, 3, 4, 5],
};

export const GENE_NAMES = Object.keys(GENES) as Gene[];

export function candidateFromGenes(g: Record<string, unknown>): LthCandidate {
  const B = { ...PROD_LTH_CONFIG.B };
  for (const k of Object.keys(B) as (keyof typeof B)[]) if (typeof g[k] === "number") B[k] = g[k] as number;
  return {
    bands: parseBandSpec(String(g.bandSpec ?? "sth_pvr:auto")),
    config: {
      B,
      bearPauseEnterSigma: Number(g.bearPauseEnterSigma ?? PROD_LTH_CONFIG.bearPauseEnterSigma),
      bearPauseExitSigma: Number(g.bearPauseExitSigma ?? PROD_LTH_CONFIG.bearPauseExitSigma),
      momentumLength: Number(g.momentumLength ?? PROD_LTH_CONFIG.momentumLength),
      momentumThreshold: Number(g.momentumThreshold ?? PROD_LTH_CONFIG.momentumThreshold),
      enableRetrace: typeof g.enableRetrace === "boolean" ? g.enableRetrace : PROD_LTH_CONFIG.enableRetrace,
      retraceBase: Number(g.retraceBase ?? PROD_LTH_CONFIG.retraceBase),
    },
  };
}

export function genesFromCandidate(c: LthCandidate): Record<string, unknown> {
  return {
    bandSpec: bandSpecString(c.bands),
    ...c.config.B,
    momentumLength: c.config.momentumLength,
    momentumThreshold: c.config.momentumThreshold,
    bearPauseEnterSigma: c.config.bearPauseEnterSigma,
    bearPauseExitSigma: c.config.bearPauseExitSigma,
    enableRetrace: c.config.enableRetrace,
    retraceBase: c.config.retraceBase,
  };
}

export const PROD_GENES = genesFromCandidate({ bands: parseBandSpec("sth_pvr:auto"), config: PROD_LTH_CONFIG });

/**
 * Structured starting points for a lump-sum regime: accumulate hard below the mean,
 * never sell in the lower sell bands, distribute heavily only in the top bands,
 * and let the bear-pause/exit sigma define the "wait in cash" leg.
 */
export function structuredSeeds(): Record<string, unknown>[] {
  const buyShapes: number[][] = [
    [1, 1, 1, 1, 1],            // all-in anywhere below the mean
    [1, 1, 0.5, 0.25, 0.1],     // front-loaded deep
    [0.5, 0.4, 0.3, 0.2, 0.1],  // tapered
    [1, 0.5, 0.2, 0.05, 0],     // deep only
    [0.3, 0.3, 0.3, 0.3, 0.3],  // steady
  ];
  const sellShapes: number[][] = [
    [0, 0, 0, 0, 0, 1],          // all-out only at +2.5σ
    [0, 0, 0, 0, 0.5, 1],        // half at +2σ, rest at +2.5σ
    [0, 0, 0, 0.1, 0.35, 1],     // ladder from +1.5σ
    [0, 0, 0.02, 0.05, 0.2, 0.5],// gentle ladder
    [0, 0, 0, 0, 1, 1],          // all-out at +2σ
    [0, 0, 0, 0.5, 1, 1],        // all-out at +1.5σ
  ];
  const pauses: [number, number][] = [[2, -1], [2, -0.5], [2.5, -1], [1.5, -0.5], [9, -1], [9, 0], [3, -0.75]];
  const out: Record<string, unknown>[] = [];
  for (const bandSpec of GENES.bandSpec as string[]) {
    for (const b of buyShapes) for (const s of sellShapes) for (const [pe, px] of pauses) {
      out.push({
        bandSpec,
        B1: b[0], B2: b[1], B3: b[2], B4: b[3], B5: b[4],
        B6: s[0], B7: s[1], B8: s[2], B9: s[3], B10: s[4], B11: s[5],
        momentumLength: 5, momentumThreshold: 0,
        bearPauseEnterSigma: pe, bearPauseExitSigma: px,
        enableRetrace: false, retraceBase: 3,
      });
    }
  }
  return out;
}

/** Short human-readable description of a candidate. */
export function describe(c: LthCandidate): string {
  const b = c.config.B;
  const f = (x: number) => (x >= 0.01 ? x.toFixed(2) : x.toFixed(4)).replace(/\.?0+$/, "");
  return `bands=${bandSpecString(c.bands)} buy[${[b.B1, b.B2, b.B3, b.B4, b.B5].map(f).join(",")}] sell[${[b.B6, b.B7, b.B8, b.B9, b.B10, b.B11].map(f).join(",")}] momo=${c.config.momentumLength}/${c.config.momentumThreshold} pause=${c.config.bearPauseEnterSigma}/${c.config.bearPauseExitSigma} retrace=${c.config.enableRetrace ? "B" + c.config.retraceBase : "off"}`;
}

/** xorshift32 PRNG for reproducible sampling. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
