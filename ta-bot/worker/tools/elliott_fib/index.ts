// Tool: Elliott Wave + Fibonacci (retracements, trend-based extensions, time-based extensions).
// Spec: ta-bot/knowledge/elliott_wave.md
import { z } from "zod";
import type { Candle, Timeframe } from "../../exchange/types.ts";
import type { BiasDirection, LevelType, TaTool, ToolBias, ToolContext, ToolLevel, ToolOutput, ToolTimeWindow } from "../types.ts";
import { STYLE_TIMEFRAMES } from "../types.ts";
import { lastAtr, liveExtreme, type Pivot, zigzag } from "../indicators.ts";
import { extensions, retracements, timeWindows } from "./fib.ts";
import { type Direction, findWaveCounts, type WaveCount, type WaveStage } from "./waves.ts";

export const ElliottFibParams = z.object({
  reversalAtrHigher: z.number().positive().default(4),
  reversalAtrLower: z.number().positive().default(2.5),
  minWaveScore: z.number().min(0).max(1).default(0.35),
  levelBandAtr: z.number().positive().default(0.15), // half-width of each fib level band, in ATR
  maxLookbackPivots: z.number().int().positive().default(24),
});
export type ElliottFibParams = z.infer<typeof ElliottFibParams>;

interface DegreeResult {
  degree: "higher" | "lower";
  pivots: Pivot[];
  best?: WaveCount;
  alternatives: WaveCount[];
}

export const elliottFibTool: TaTool<ElliottFibParams> = {
  code: "elliott_fib",
  name: "Elliott Wave + Fibonacci",
  version: 1,
  description: "Two-degree Elliott wave count with fib retracement/extension price levels, fib time windows and directional bias.",
  paramsSchema: ElliottFibParams,
  defaultParams: ElliottFibParams.parse({}),
  minCandles: 120,

  compute(ctx: ToolContext<ElliottFibParams>): ToolOutput {
    const levels: ToolLevel[] = [];
    const windows: ToolTimeWindow[] = [];
    const perTf: Record<string, unknown> = {};
    let bias: ToolBias | undefined;
    const primaryTf = STYLE_TIMEFRAMES[ctx.style][0]!;

    for (const [tfKey, candles] of Object.entries(ctx.candles) as [Timeframe, Candle[]][]) {
      if (!candles || candles.length < this.minCandles) continue;
      const atr = ctx.atr[tfKey] ?? lastAtr(candles);
      const degrees = [
        analyseDegree("higher", candles, ctx.params.reversalAtrHigher, ctx.params),
        analyseDegree("lower", candles, ctx.params.reversalAtrLower, ctx.params),
      ];
      const higher = degrees[0]!, lower = degrees[1]!;
      const primary = lower.best ?? higher.best;
      // Both thresholds can resolve to the same pivots on quiet series; emit that count once (at higher-degree weight).
      const sameCount = !!(higher.best && lower.best && samePivots(higher.best, lower.best));

      for (const dg of degrees) {
        if (!dg.best) continue;
        if (sameCount && dg.degree === "lower") continue;
        const degMult = dg.degree === "higher" ? 1.15 : 1.0;
        const built = buildLevels(dg.best, candles, tfKey, atr, ctx.params.levelBandAtr, degMult);
        levels.push(...built.levels);
        windows.push(...built.windows);
      }

      const tfBias = primary ? deriveBias(primary, higher.best, ctx.lastPrice, atr) : neutralBias();
      perTf[tfKey] = {
        lower: summarise(lower),
        higher: summarise(higher),
        bias: tfBias,
      };
      if (tfKey === primaryTf) bias = tfBias;
    }

    return { levels, timeWindows: windows, bias: bias ?? neutralBias(), meta: { perTimeframe: perTf } };
  },
};

// ------------------------------------------------------------------ analysis
function analyseDegree(degree: "higher" | "lower", candles: Candle[], reversalAtr: number, params: ElliottFibParams): DegreeResult {
  const pivots = zigzag(candles, reversalAtr);
  const live = liveExtreme(candles, pivots);
  const counts = findWaveCounts(pivots, {
    maxLookbackPivots: params.maxLookbackPivots,
    minScore: params.minWaveScore,
    livePrice: live?.price,
  });
  return { degree, pivots, best: counts[0], alternatives: counts.slice(1, 4) };
}

function samePivots(a: WaveCount, b: WaveCount): boolean {
  return a.direction === b.direction && a.stage === b.stage && a.pivots.length === b.pivots.length &&
    a.pivots.every((p, i) => p.index === b.pivots[i]!.index);
}

function summarise(d: DegreeResult) {
  const s = (c: WaveCount) => ({
    stage: c.stage,
    direction: c.direction === 1 ? "bullish" : "bearish",
    score: round(c.score),
    flags: c.flags,
    pivots: c.pivots.map((p) => ({ t: p.time.toISOString(), price: p.price, kind: p.kind })),
  });
  return { pivotCount: d.pivots.length, best: d.best ? s(d.best) : null, alternatives: d.alternatives.map(s) };
}

// ------------------------------------------------------------------ levels
function buildLevels(
  wc: WaveCount,
  candles: Candle[],
  tf: Timeframe,
  atr: number,
  bandAtr: number,
  mult: number,
): { levels: ToolLevel[]; windows: ToolTimeWindow[] } {
  const d = wc.direction;
  const p = wc.pivots.map((x) => x.price * d); // normalised bullish space
  const bars = wc.pivots.map((x) => x.index);
  const levels: ToolLevel[] = [];
  const windows: ToolTimeWindow[] = [];
  const q = wc.score * mult;
  const tag = d === 1 ? "bull" : "bear";

  // Normalised "support" (below in bull space) maps to support for bull, resistance for bear.
  const S: LevelType = d === 1 ? "support" : "resistance";
  const R: LevelType = d === 1 ? "resistance" : "support";
  const push = (type: LevelType, normPrice: number, strength: number, label: string, meta: Record<string, unknown> = {}) => {
    const price = normPrice * d;
    const half = bandAtr * atr;
    levels.push({
      timeframe: tf,
      levelType: type,
      priceLow: price - half,
      priceHigh: price + half,
      strength: clamp01(strength * q),
      label: `[${tag} ${wc.stage}] ${label}`,
      meta: { stage: wc.stage, direction: tag, ...meta },
    });
  };
  const win = (fromBar: number, refBars: number, ratios: readonly number[], label: string) => {
    for (const w of timeWindows(fromBar, refBars, ratios)) {
      const from = barToTime(candles, w.fromBar), to = barToTime(candles, w.toBar);
      if (!from || !to) continue;
      windows.push({ timeframe: tf, from, to, label: `[${tag} ${wc.stage}] ${label} ×${w.ratio}`, strength: clamp01(0.6 * q) });
    }
  };

  const w1 = p[1]! - p[0]!;
  const b1 = bars[1]! - bars[0]!;

  switch (wc.stage) {
    case "wave_2_in_progress":
      for (const f of retracements(p[0]!, p[1]!, [0.5, 0.618, 0.786, 0.382])) push(S, f.price, f.strength, `W2 ${f.ratio} retrace of W1`, { ratio: f.ratio });
      push("invalidation", p[0]!, 1, "W1 origin (W2 may not exceed)");
      break;
    case "wave_3_in_progress":
      for (const f of extensions(p[0]!, p[1]!, p[2]!, [1.618, 2.618, 1.0])) push(R, f.price, f.strength, `W3 target ${f.ratio}×W1 from W2`, { ratio: f.ratio });
      push("invalidation", p[0]!, 1, "W1 origin");
      win(bars[2]!, b1, [1.0, 1.618, 2.618], "W3 time vs bars(W1)");
      break;
    case "wave_4_in_progress":
      for (const f of retracements(p[2]!, p[3]!, [0.382, 0.236, 0.5])) push(S, f.price, f.strength, `W4 ${f.ratio} retrace of W3`, { ratio: f.ratio });
      push("invalidation", p[1]!, 1, "W1 high (W4 may not overlap)");
      break;
    case "wave_5_in_progress": {
      for (const r of [1.0, 0.618, 1.618]) push(R, p[4]! + w1 * r, r === 1.0 ? 0.9 : r === 0.618 ? 0.8 : 0.6, `W5 = ${r}×W1 from W4`, { ratio: r });
      push(R, p[4]! + 0.618 * (p[3]! - p[0]!), 0.85, "W5 = 0.618×(0→3) from W4", { ratio: 0.618 });
      push("invalidation", p[4]!, 1, "W4 low");
      win(bars[4]!, b1, [0.618, 1.0, 1.618], "W5 time vs bars(W1)");
      break;
    }
    case "impulse_complete":
      for (const f of retracements(p[0]!, p[5]!, [0.382, 0.5, 0.618])) push(S, f.price, f.strength, `ABC target ${f.ratio} retrace of 0→5`, { ratio: f.ratio });
      push(S, p[4]!, 0.8, "prior W4 terminus");
      push("invalidation", p[5]!, 1, "W5 high (new high = W5 extending)");
      break;
    case "wave_B_in_progress":
      for (const f of retracements(p[5]!, p[6]!, [0.382, 0.5, 0.618, 0.786])) push(R, f.price, f.strength, `B ${f.ratio} retrace of A`, { ratio: f.ratio });
      push("invalidation", p[5]! + 0.382 * (p[5]! - p[6]!), 0.7, "B > 1.382×A (not a correction)");
      break;
    case "wave_C_in_progress": {
      const lenA = p[5]! - p[6]!;
      for (const r of [1.0, 0.618, 1.618]) push(S, p[7]! - lenA * r, r === 1.0 ? 1 : 0.75, `C = ${r}×A from B`, { ratio: r });
      for (const f of retracements(p[0]!, p[5]!, [0.382, 0.5, 0.618])) push(S, f.price, f.strength * 0.9, `ABC target ${f.ratio} retrace of 0→5`, { ratio: f.ratio });
      push(S, p[4]!, 0.8, "prior W4 terminus");
      win(bars[7]!, bars[6]! - bars[5]!, [1.0, 1.618], "C time vs bars(A)");
      break;
    }
    case "abc_complete":
      push(S, p[8]!, 1, "C terminus — reversal zone");
      push("invalidation", p[8]!, 1, "C low");
      break;
  }
  return { levels, windows };
}

// ------------------------------------------------------------------ bias
const STAGE_BIAS: Record<WaveStage, { withTrend: boolean; base: number }> = {
  wave_2_in_progress: { withTrend: true, base: 0.45 },
  wave_3_in_progress: { withTrend: true, base: 0.7 },
  wave_4_in_progress: { withTrend: true, base: 0.55 },
  wave_5_in_progress: { withTrend: true, base: 0.55 },
  impulse_complete: { withTrend: false, base: 0.5 },
  wave_B_in_progress: { withTrend: false, base: 0.45 },
  wave_C_in_progress: { withTrend: false, base: 0.6 },
  abc_complete: { withTrend: true, base: 0.6 },
};

function deriveBias(primary: WaveCount, higher: WaveCount | undefined, lastPrice: number, atr: number): ToolBias {
  const sb = STAGE_BIAS[primary.stage];
  const dir: Direction = sb.withTrend ? primary.direction : (-primary.direction as Direction);
  let conf = sb.base;
  if (primary.score >= 0.75) conf += 0.1;
  if (higher) {
    const hb = STAGE_BIAS[higher.stage];
    const hdir: Direction = hb.withTrend ? higher.direction : (-higher.direction as Direction);
    conf += hdir === dir ? 0.05 : -0.15;
  }
  const inval = invalidationPrice(primary);
  if (inval !== undefined && Math.abs(lastPrice - inval) < 0.5 * atr) conf -= 0.2;
  conf = Math.min(0.95, Math.max(0.05, conf));
  const direction: BiasDirection = dir === 1 ? "bullish" : "bearish";
  return {
    direction,
    confidence: round(conf),
    invalidation: inval,
    rationale: `${primary.direction === 1 ? "Bull" : "Bear"} count ${primary.stage} (score ${round(primary.score)}${primary.flags.length ? ", " + primary.flags.join("/") : ""})` +
      (higher ? `; higher degree ${higher.direction === 1 ? "bull" : "bear"} ${higher.stage}` : ""),
    meta: { stage: primary.stage, score: primary.score, flags: primary.flags },
  };
}

function invalidationPrice(wc: WaveCount): number | undefined {
  const p = wc.pivots.map((x) => x.price);
  switch (wc.stage) {
    case "wave_2_in_progress":
    case "wave_3_in_progress":
      return p[0];
    case "wave_4_in_progress":
      return p[1];
    case "wave_5_in_progress":
      return p[4];
    case "impulse_complete":
      return p[5];
    case "wave_B_in_progress":
      return p[5];
    case "wave_C_in_progress":
      return p[7];
    case "abc_complete":
      return p[8];
  }
}

function neutralBias(): ToolBias {
  return { direction: "neutral", confidence: 0.2, rationale: "No valid wave count" };
}

// ------------------------------------------------------------------ utils
function barToTime(candles: Candle[], bar: number): Date | undefined {
  const n = candles.length;
  if (n < 2) return undefined;
  const tfMs = candles[1]!.openTime.getTime() - candles[0]!.openTime.getTime();
  const t0 = candles[0]!.openTime.getTime();
  return new Date(t0 + bar * tfMs);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
