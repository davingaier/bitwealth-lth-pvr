import type { Candle } from "../exchange/types.ts";

/** Wilder ATR; returns the series (NaN for warm-up bars). */
export function atrSeries(candles: Candle[], period = 14): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRange(candles[i]!, candles[i - 1]!);
  let atr = sum / period;
  out[period] = atr;
  for (let i = period + 1; i < candles.length; i++) {
    atr = (atr * (period - 1) + trueRange(candles[i]!, candles[i - 1]!)) / period;
    out[i] = atr;
  }
  return out;
}

export function lastAtr(candles: Candle[], period = 14): number {
  const s = atrSeries(candles, period);
  for (let i = s.length - 1; i >= 0; i--) if (!Number.isNaN(s[i]!)) return s[i]!;
  // Fallback for very short series: mean high-low range.
  return candles.reduce((a, c) => a + (c.high - c.low), 0) / Math.max(1, candles.length);
}

function trueRange(c: Candle, prev: Candle): number {
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}

export interface Pivot {
  index: number;
  time: Date;
  price: number;
  kind: "H" | "L";
}

/**
 * ATR-scaled ZigZag. A new pivot is committed when price reverses from the running extreme by
 * at least `reversalAtr × ATR(index)`. Returns alternating H/L pivots, ascending. The running
 * (uncommitted) extreme is NOT included — callers treat "price since last pivot" as the live wave.
 */
export function zigzag(candles: Candle[], reversalAtr: number, atrPeriod = 14): Pivot[] {
  const n = candles.length;
  if (n < atrPeriod + 2) return [];
  const atr = atrSeries(candles, atrPeriod);
  const pivots: Pivot[] = [];

  let dir: 1 | -1 = candles[atrPeriod + 1]!.close >= candles[atrPeriod]!.close ? 1 : -1;
  let extIdx = atrPeriod;
  let extPrice = dir === 1 ? candles[extIdx]!.high : candles[extIdx]!.low;
  let lastPivotIdx = -1;

  for (let i = atrPeriod + 1; i < n; i++) {
    const c = candles[i]!;
    const thr = reversalAtr * (atr[i] ?? atr[atrPeriod]!);
    if (dir === 1) {
      if (c.high >= extPrice) {
        extPrice = c.high;
        extIdx = i;
      } else if (extPrice - c.low >= thr) {
        if (extIdx !== lastPivotIdx) pivots.push({ index: extIdx, time: candles[extIdx]!.openTime, price: extPrice, kind: "H" });
        lastPivotIdx = extIdx;
        dir = -1;
        extPrice = c.low;
        extIdx = i;
      }
    } else {
      if (c.low <= extPrice) {
        extPrice = c.low;
        extIdx = i;
      } else if (c.high - extPrice >= thr) {
        if (extIdx !== lastPivotIdx) pivots.push({ index: extIdx, time: candles[extIdx]!.openTime, price: extPrice, kind: "L" });
        lastPivotIdx = extIdx;
        dir = 1;
        extPrice = c.high;
        extIdx = i;
      }
    }
  }
  return pivots;
}

/** Live (uncommitted) extreme since the last pivot — the wave currently forming. */
export function liveExtreme(candles: Candle[], pivots: Pivot[]): { price: number; index: number; kind: "H" | "L" } | undefined {
  const last = pivots[pivots.length - 1];
  if (!last) return undefined;
  let idx = last.index;
  let price = last.kind === "H" ? Infinity : -Infinity;
  for (let i = last.index + 1; i < candles.length; i++) {
    const c = candles[i]!;
    if (last.kind === "H" ? c.low < price : c.high > price) {
      price = last.kind === "H" ? c.low : c.high;
      idx = i;
    }
  }
  if (!Number.isFinite(price)) return undefined;
  return { price, index: idx, kind: last.kind === "H" ? "L" : "H" };
}
