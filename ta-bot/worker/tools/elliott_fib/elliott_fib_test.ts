import { assert, assertEquals } from "@std/assert";
import type { Candle } from "../../exchange/types.ts";
import { zigzag } from "../indicators.ts";
import { extensions, retraceRatio, retracements } from "./fib.ts";
import { evaluateImpulse, findWaveCounts } from "./waves.ts";
import { elliottFibTool } from "./index.ts";

/** Build a candle path that visits the given pivot prices with small noise-free steps. */
function synth(pivotPrices: number[], barsPerLeg = 20): Candle[] {
  const out: Candle[] = [];
  let t = Date.UTC(2026, 0, 1);
  for (let i = 1; i < pivotPrices.length; i++) {
    const a = pivotPrices[i - 1]!, b = pivotPrices[i]!;
    for (let k = 1; k <= barsPerLeg; k++) {
      const prev = a + (b - a) * ((k - 1) / barsPerLeg);
      const cur = a + (b - a) * (k / barsPerLeg);
      const hi = Math.max(prev, cur) + 0.5, lo = Math.min(prev, cur) - 0.5;
      out.push({ exchange: "test", symbol: "T", timeframe: "1h", openTime: new Date(t), open: prev, high: hi, low: lo, close: cur, volume: 1, confirmed: true });
      t += 3_600_000;
    }
  }
  return out;
}

// Textbook bull impulse: W1 100→150, W2 to 120 (0.6 retrace), W3 to 201 (1.62×W1), W4 to 170 (0.38 retrace), W5 to 220 (=W1).
const IMPULSE = [100, 150, 120, 201, 170, 220];

Deno.test("fib retracement / extension arithmetic", () => {
  const r = retracements(100, 200, [0.5]);
  assertEquals(r[0]!.price, 150);
  const e = extensions(100, 150, 120, [1.618]);
  assertEquals(Math.round(e[0]!.price * 10) / 10, 200.9);
  assertEquals(retraceRatio(100, 150, 120), 0.6);
});

Deno.test("zigzag recovers synthetic pivots", () => {
  const candles = synth(IMPULSE);
  const piv = zigzag(candles, 2.0);
  // First pivot may be dropped by warm-up; the remaining committed pivots must alternate and match prices within noise.
  assert(piv.length >= 4, `expected ≥4 pivots, got ${piv.length}`);
  for (let i = 1; i < piv.length; i++) assert(piv[i]!.kind !== piv[i - 1]!.kind, "pivots must alternate");
  const near = (x: number) => IMPULSE.some((p) => Math.abs(p - x) <= 1);
  for (const p of piv) assert(near(p.price), `pivot ${p.price} not near a synthetic pivot`);
});

Deno.test("evaluateImpulse: textbook count scores high, hard-rule breaches rejected", () => {
  const bars = [0, 20, 40, 60, 80, 100];
  const good = evaluateImpulse({ p: IMPULSE, bars }, 5);
  assert(good && good.score > 0.7, `score ${good?.score}`);
  assert(good.flags.includes("w3_extended"));

  // HARD-1: W2 below origin
  assertEquals(evaluateImpulse({ p: [100, 150, 95, 201, 170, 220], bars }, 5), undefined);
  // HARD-3: W4 into W1 territory (and not a wedge)
  assertEquals(evaluateImpulse({ p: [100, 150, 120, 201, 145, 260], bars }, 5), undefined);
  // HARD-2: W3 shortest
  assertEquals(evaluateImpulse({ p: [100, 150, 120, 140, 130, 190], bars }, 5), undefined);
});

Deno.test("findWaveCounts: wave 3 in progress detected with bullish direction", () => {
  const candles = synth([130, 100, 150, 120, 160]); // lead-in, then W1, W2 committed; price rising in W3
  const piv = zigzag(candles, 2.0);
  const counts = findWaveCounts(piv, { minScore: 0.2, livePrice: 160 });
  const best = counts[0];
  assert(best, "no counts");
  assertEquals(best.direction, 1);
  assert(["wave_3_in_progress", "wave_2_in_progress"].includes(best.stage), best.stage);
});

Deno.test("tool emits levels, invalidation and a bias on synthetic data", () => {
  const candles = synth([...IMPULSE, 180]); // impulse complete, wave A down to 180 → B in progress
  const out = elliottFibTool.compute({
    exchange: "test",
    symbol: "T",
    style: "day",
    candles: { "1h": candles },
    atr: { "1h": 2 },
    lastPrice: 190,
    now: new Date(),
    params: { ...elliottFibTool.defaultParams, reversalAtrHigher: 3, reversalAtrLower: 2 },
  });
  assert(out.levels.length > 0, "no levels");
  assert(out.levels.some((l) => l.levelType === "invalidation"), "no invalidation level");
  assert(out.bias && out.bias.direction !== "neutral", "no directional bias");
  assert(out.bias!.invalidation !== undefined, "bias must carry invalidation");
});
