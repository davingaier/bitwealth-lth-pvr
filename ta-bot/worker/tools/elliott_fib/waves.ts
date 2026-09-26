// Deterministic Elliott wave counting over ZigZag pivots. Rules/guidelines: knowledge/elliott_wave.md §2, §3, §6.
import type { Pivot } from "../indicators.ts";
import { bell, retraceRatio } from "./fib.ts";

export type Direction = 1 | -1; // 1 = bullish impulse (normalised), -1 = bearish

export type WaveStage =
  | "wave_2_in_progress"
  | "wave_3_in_progress"
  | "wave_4_in_progress"
  | "wave_5_in_progress"
  | "impulse_complete"
  | "wave_B_in_progress"
  | "wave_C_in_progress"
  | "abc_complete";

export interface WaveCount {
  direction: Direction;
  /** Committed pivots p0..pk (impulse) followed by any corrective pivots (A,B,C). Original prices. */
  pivots: Pivot[];
  impulsePivots: number; // 2..6 = p0..pk
  stage: WaveStage;
  score: number; // 0..1 wave-count quality
  rank: number; // score × stage weight, used for selection
  components: Record<string, number>;
  flags: string[];
}

export const SCORE_WEIGHTS = {
  w2Retrace: 0.2,
  w3Extension: 0.25,
  w4Retrace: 0.15,
  w5Relation: 0.15,
  alternation: 0.1,
  timeProportion: 0.1,
  extensionPresent: 0.05,
} as const;

const STAGE_WEIGHT: Record<WaveStage, number> = {
  wave_2_in_progress: 0.7,
  wave_3_in_progress: 0.9,
  wave_4_in_progress: 0.85,
  wave_5_in_progress: 0.85,
  impulse_complete: 1.0,
  wave_B_in_progress: 0.8,
  wave_C_in_progress: 0.85,
  abc_complete: 0.95,
};

interface Norm {
  p: number[]; // normalised prices (× direction) so the impulse is always "up"
  bars: number[]; // bar index per pivot
}

function normalise(pivots: Pivot[], d: Direction): Norm {
  return { p: pivots.map((x) => x.price * d), bars: pivots.map((x) => x.index) };
}

/**
 * Evaluate p0..pk (k = impulsePivots-1 completed waves) as a bullish impulse in normalised space.
 * Returns undefined when a HARD rule is violated.
 */
export function evaluateImpulse(n: Norm, k: number, livePrice?: number): { score: number; components: Record<string, number>; flags: string[] } | undefined {
  const p = n.p;
  if (k < 1 || p.length < k + 1) return undefined;
  const flags: string[] = [];

  // HARD-4: strict alternation up/down.
  for (let i = 1; i <= k; i++) {
    const up = p[i]! > p[i - 1]!;
    if ((i % 2 === 1) !== up) return undefined;
  }
  const w1 = p[1]! - p[0]!;
  const w3 = k >= 3 ? p[3]! - p[2]! : undefined;
  const w5 = k >= 5 ? p[5]! - p[4]! : undefined;

  if (k >= 2 && p[2]! <= p[0]!) return undefined; // HARD-1
  if (k >= 4 && p[4]! <= p[1]!) {
    // HARD-3 violated → only survivable as a diagonal (wedge: 1 > 3 > 5, 2 > 4).
    const wedge = w3! < w1 && (w5 === undefined || w5 < w3!) && (p[1]! - p[2]!) > (p[3]! - p[4]!);
    if (!wedge) return undefined;
    flags.push("diagonal_candidate");
  }
  if (k >= 5 && w3! < w1 && w3! < w5!) return undefined; // HARD-2
  if (k >= 5 && p[5]! < p[3]!) {
    if (w3! < 1.618 * w1) return undefined;
    flags.push("truncated_fifth");
  }
  // Live price must not have already broken the structure of the wave in progress.
  if (livePrice !== undefined) {
    if (k === 1 && livePrice <= p[0]!) return undefined;
    if (k === 3 && livePrice <= p[1]!) return undefined;
  }

  const c: Record<string, number> = {};
  let wsum = 0;
  const add = (key: keyof typeof SCORE_WEIGHTS, v: number) => {
    c[key] = v;
    wsum += SCORE_WEIGHTS[key];
  };

  if (k >= 2) {
    const r2 = retraceRatio(p[0]!, p[1]!, p[2]!);
    add("w2Retrace", r2 >= 0.382 && r2 <= 0.786 ? Math.max(bell(r2, 0.5, 0.35), bell(r2, 0.618, 0.3), 0.6) : bell(r2, 0.6, 0.45));
  }
  if (k >= 3) {
    const ratio = w3! / w1;
    add("w3Extension", ratio >= 1.382 && ratio <= 2.8 ? Math.max(bell(ratio, 1.618, 0.9), 0.6) : bell(ratio, 1.618, 1.3));
    if (ratio >= 1.618) flags.push("w3_extended");
  }
  if (k >= 4) {
    const r4 = retraceRatio(p[2]!, p[3]!, p[4]!);
    add("w4Retrace", r4 >= 0.236 && r4 <= 0.5 ? Math.max(bell(r4, 0.382, 0.25), 0.6) : bell(r4, 0.382, 0.4));
    const r2 = retraceRatio(p[0]!, p[1]!, p[2]!);
    add("alternation", Math.min(1, Math.abs(r2 - r4) / 0.3));
  }
  if (k >= 5) {
    const rel1 = w5! / w1;
    const rel03 = w5! / (0.618 * (p[3]! - p[0]!));
    add("w5Relation", Math.max(bell(rel1, 1.0, 0.5), bell(rel1, 0.618, 0.3), bell(rel03, 1.0, 0.35)));
    const b1 = n.bars[1]! - n.bars[0]!, b2 = n.bars[2]! - n.bars[1]!, b3 = n.bars[3]! - n.bars[2]!;
    const b4 = n.bars[4]! - n.bars[3]!, b5 = n.bars[5]! - n.bars[4]!;
    const t1 = b3 >= b1 ? 1 : b3 / Math.max(1, b1);
    const t2 = (b2 + b4) / Math.max(1, 0.5 * (b1 + b3 + b5));
    add("timeProportion", 0.5 * t1 + 0.5 * Math.min(1, t2));
    const waves = [w1, w3!, w5!].sort((a, b) => a - b);
    add("extensionPresent", waves[2]! >= 1.618 * waves[1]! ? 1 : waves[2]! / (1.618 * waves[1]!));
  }
  let score = wsum > 0 ? Object.entries(c).reduce((a, [key, v]) => a + v * SCORE_WEIGHTS[key as keyof typeof SCORE_WEIGHTS], 0) / wsum : 0.5;
  if (flags.includes("diagonal_candidate")) score *= 0.6;
  if (flags.includes("truncated_fifth")) score *= 0.85;
  return { score, components: c, flags };
}

/** Validate A-B-C pivots after a completed impulse (normalised: correction goes DOWN). m = corrective pivots available (1..3). */
function evaluateCorrection(n: Norm, m: number): { ok: boolean; flags: string[]; penalty: number } {
  const p = n.p;
  const p5 = p[5]!, a = p[6];
  const flags: string[] = [];
  let penalty = 1;
  if (m >= 1) {
    if (a === undefined || a >= p5) return { ok: false, flags, penalty };
  }
  if (m >= 2) {
    const b = p[7]!;
    const rB = retraceRatio(p5, a!, b); // how much of A was retraced by B
    if (rB < 0.236) return { ok: false, flags, penalty };
    if (rB > 1.382) return { ok: false, flags, penalty };
    if (rB > 1.0) flags.push("expanded_flat");
    else if (rB >= 0.9) flags.push("flat");
    else flags.push("zigzag");
    if (rB > 0.786 && rB < 0.9) penalty *= 0.85;
  }
  if (m >= 3) {
    const c = p[8]!, b = p[7]!;
    const lenA = p5 - a!, lenC = b - c;
    if (lenC <= 0) return { ok: false, flags, penalty };
    const ratio = lenC / lenA;
    if (c > a! && ratio < 0.618) return { ok: false, flags, penalty }; // C failed to make meaningful progress
    if (c > a!) flags.push("running_correction");
    if (ratio < 0.5 || ratio > 2.8) penalty *= 0.7;
  }
  return { ok: true, flags, penalty };
}

export interface FindOptions {
  maxLookbackPivots?: number;
  minScore?: number;
  livePrice?: number;
}

/** Enumerate wave counts that END at the latest pivot (structure currently unfolding), both directions. */
export function findWaveCounts(pivots: Pivot[], opts: FindOptions = {}): WaveCount[] {
  const maxLook = opts.maxLookbackPivots ?? 24;
  const minScore = opts.minScore ?? 0.35;
  const out: WaveCount[] = [];
  const last = pivots.length - 1;
  if (last < 1) return out;

  for (const d of [1, -1] as Direction[]) {
    const norm = normalise(pivots, d);
    const live = opts.livePrice !== undefined ? opts.livePrice * d : undefined;
    for (let origin = Math.max(0, last - maxLook); origin < last; origin++) {
      // Impulse origin must be a low in normalised space.
      if (norm.p[origin + 1]! <= norm.p[origin]!) continue;
      const span = last - origin; // pivots after origin
      // Case A: impulse still unfolding or just completed at the last pivot.
      if (span <= 5) {
        const sub: Norm = { p: norm.p.slice(origin, last + 1), bars: norm.bars.slice(origin, last + 1) };
        const ev = evaluateImpulse(sub, span, live);
        if (ev && ev.score >= minScore) {
          const stage: WaveStage = span === 5 ? "impulse_complete" : (`wave_${span + 1}_in_progress` as WaveStage);
          out.push(build(d, pivots.slice(origin, last + 1), span + 1, stage, ev.score, ev.components, ev.flags));
        }
      }
      // Case B: completed impulse followed by 1..3 corrective pivots.
      if (span >= 6 && span <= 8) {
        const sub: Norm = { p: norm.p.slice(origin, last + 1), bars: norm.bars.slice(origin, last + 1) };
        const ev = evaluateImpulse({ p: sub.p.slice(0, 6), bars: sub.bars.slice(0, 6) }, 5);
        if (!ev || ev.score < minScore) continue;
        const m = span - 5;
        const corr = evaluateCorrection(sub, m);
        if (!corr.ok) continue;
        const stage: WaveStage = m === 1 ? "wave_B_in_progress" : m === 2 ? "wave_C_in_progress" : "abc_complete";
        out.push(build(d, pivots.slice(origin, last + 1), 6, stage, ev.score * corr.penalty, ev.components, [...ev.flags, ...corr.flags]));
      }
    }
  }
  return out.sort((a, b) => b.rank - a.rank);
}

function build(
  direction: Direction,
  pivots: Pivot[],
  impulsePivots: number,
  stage: WaveStage,
  score: number,
  components: Record<string, number>,
  flags: string[],
): WaveCount {
  return { direction, pivots, impulsePivots, stage, score, rank: score * STAGE_WEIGHT[stage], components, flags };
}
