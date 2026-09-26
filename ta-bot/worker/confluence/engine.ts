// Confluence engine: clusters price levels from all tools/timeframes into zones and scores them.
import type { Timeframe } from "../exchange/types.ts";
import type { ToolLevel, ToolTimeWindow } from "../tools/types.ts";

export interface WeightedLevel extends ToolLevel {
  toolCode: string;
  toolWeight: number;
  levelId?: string;
}

export interface ConfluenceZone {
  priceLow: number;
  priceHigh: number;
  mid: number;
  bias: "support" | "resistance";
  score: number;
  rawScore: number;
  toolCodes: string[];
  timeframes: Timeframe[];
  levels: WeightedLevel[];
  distancePct: number; // from last price, signed (+ above)
  timeWindowBonus: boolean;
  /** Uncalibrated prior; replaced by calibrated model output in Phase 2. */
  probPrior: number;
  rationale: string;
}

export interface ConfluenceOptions {
  atr: number; // execution-timeframe ATR
  lastPrice: number;
  now: Date;
  toleranceAtr?: number; // cluster radius, default 0.5 ATR
  maxZoneWidthAtr?: number; // default 1.5 ATR
  maxDistancePct?: number; // ignore zones further than this from price
  timeWindows?: ToolTimeWindow[];
}

export const TF_MULTIPLIER: Record<Timeframe, number> = { "1m": 0.6, "5m": 0.7, "15m": 0.8, "1h": 1.0, "4h": 1.2, "1d": 1.4 };

export function buildConfluenceZones(levels: WeightedLevel[], opts: ConfluenceOptions): ConfluenceZone[] {
  const tol = (opts.toleranceAtr ?? 0.5) * opts.atr;
  const maxWidth = (opts.maxZoneWidthAtr ?? 1.5) * opts.atr;
  const maxDist = opts.maxDistancePct ?? 0.15;

  const usable = levels
    .filter((l) => l.levelType === "support" || l.levelType === "resistance" || l.levelType === "zone" || l.levelType === "pivot")
    .filter((l) => Math.abs(mid(l) - opts.lastPrice) / opts.lastPrice <= maxDist)
    .sort((a, b) => mid(a) - mid(b));

  // Greedy single-pass clustering on sorted mids (adequate for a few hundred levels).
  const clusters: WeightedLevel[][] = [];
  for (const l of usable) {
    const cur = clusters[clusters.length - 1];
    if (cur && Math.abs(mid(l) - centroid(cur)) <= tol && spanWith(cur, l) <= maxWidth) cur.push(l);
    else clusters.push([l]);
  }

  const windowsOpen = (opts.timeWindows ?? []).some((w) => w.from <= opts.now && opts.now <= w.to);
  const zones = clusters.map((c) => scoreCluster(c, opts, windowsOpen));
  return zones.sort((a, b) => b.score - a.score);
}

function scoreCluster(levels: WeightedLevel[], opts: ConfluenceOptions, windowsOpen: boolean): ConfluenceZone {
  const raw = levels.reduce((a, l) => a + l.toolWeight * l.strength * TF_MULTIPLIER[l.timeframe], 0);
  const toolCodes = [...new Set(levels.map((l) => l.toolCode))];
  const timeframes = [...new Set(levels.map((l) => l.timeframe))];
  let score = raw;
  if (toolCodes.length >= 2) score *= 1.25;
  if (timeframes.length >= 2) score *= 1.15;
  if (levels.length >= 3) score *= 1.1;
  if (windowsOpen) score *= 1.1;

  const lo = Math.min(...levels.map((l) => l.priceLow));
  const hi = Math.max(...levels.map((l) => l.priceHigh));
  const m = (lo + hi) / 2;
  const bias = m < opts.lastPrice ? "support" : "resistance";
  // Structural votes: a zone where most levels agree with its position relative to price is cleaner.
  const agree = levels.filter((l) => l.levelType === bias || l.levelType === "zone" || l.levelType === "pivot").length / levels.length;
  score *= 0.7 + 0.3 * agree;

  return {
    priceLow: lo,
    priceHigh: hi,
    mid: m,
    bias,
    score: round(score),
    rawScore: round(raw),
    toolCodes,
    timeframes,
    levels,
    distancePct: round((m - opts.lastPrice) / opts.lastPrice * 100),
    timeWindowBonus: windowsOpen,
    probPrior: round(priorProbability(score)),
    rationale: levels.slice(0, 4).map((l) => `${l.timeframe} ${l.toolCode}: ${l.label}`).join(" | ") + (levels.length > 4 ? ` (+${levels.length - 4})` : ""),
  };
}

/** Logistic prior on score, clamped to [0.30, 0.85]. NOT calibrated — Phase 2 replaces with fitted model. */
export function priorProbability(score: number): number {
  const p = 1 / (1 + Math.exp(-(score - 1.6) / 0.8));
  return Math.min(0.85, Math.max(0.3, p));
}

function mid(l: ToolLevel): number {
  return (l.priceLow + l.priceHigh) / 2;
}
function centroid(c: WeightedLevel[]): number {
  return c.reduce((a, l) => a + mid(l), 0) / c.length;
}
function spanWith(c: WeightedLevel[], l: WeightedLevel): number {
  return Math.max(...c.map((x) => x.priceHigh), l.priceHigh) - Math.min(...c.map((x) => x.priceLow), l.priceLow);
}
function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}
