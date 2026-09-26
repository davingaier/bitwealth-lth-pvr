// Fibonacci helpers. All functions are direction-agnostic: pass the actual swing prices.

export const RETRACE_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;
export const EXTENSION_RATIOS = [0.618, 1.0, 1.272, 1.618, 2.0, 2.618] as const;
export const TIME_RATIOS = [0.618, 1.0, 1.618, 2.618] as const;

/** Preference weight of each ratio for its typical use (see knowledge doc §4). */
export const RETRACE_STRENGTH: Record<number, number> = { 0.236: 0.5, 0.382: 0.75, 0.5: 0.9, 0.618: 1.0, 0.786: 0.8 };
export const EXTENSION_STRENGTH: Record<number, number> = { 0.618: 0.7, 1.0: 0.9, 1.272: 0.7, 1.618: 1.0, 2.0: 0.6, 2.618: 0.8 };

export interface FibLevel {
  ratio: number;
  price: number;
  strength: number;
}

/** Retracement of the move start→end: price = end − (end − start) × ratio. */
export function retracements(start: number, end: number, ratios: readonly number[] = RETRACE_RATIOS): FibLevel[] {
  return ratios.map((r) => ({ ratio: r, price: end - (end - start) * r, strength: RETRACE_STRENGTH[r] ?? 0.6 }));
}

/** Trend-based extension: project |A→B| × ratio from C in the A→B direction. */
export function extensions(a: number, b: number, c: number, ratios: readonly number[] = EXTENSION_RATIOS): FibLevel[] {
  const len = b - a;
  return ratios.map((r) => ({ ratio: r, price: c + len * r, strength: EXTENSION_STRENGTH[r] ?? 0.6 }));
}

/** How far price has retraced a move start→end (0 = at end, 1 = back at start). */
export function retraceRatio(start: number, end: number, price: number): number {
  const len = end - start;
  if (len === 0) return 0;
  return (end - price) / len;
}

/**
 * Time projection: bars measured from `fromBar`, scaled by fib ratios of a reference bar-count.
 * Returns [from,to] windows ±10 % (min 1 bar) as bar indices (may exceed series length = future).
 */
export function timeWindows(fromBar: number, referenceBars: number, ratios: readonly number[] = TIME_RATIOS) {
  return ratios.map((r) => {
    const dist = referenceBars * r;
    const pad = Math.max(1, dist * 0.1);
    return { ratio: r, fromBar: fromBar + dist - pad, toBar: fromBar + dist + pad };
  });
}

/** Score in [0,1] for how close `x` is to `peak`, reaching 0 at `peak ± halfWidth`. */
export function bell(x: number, peak: number, halfWidth: number): number {
  const d = Math.abs(x - peak) / halfWidth;
  return d >= 1 ? 0 : 1 - d * d;
}
