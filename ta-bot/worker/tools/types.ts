// Plugin contract for TA tools. One file per tool under worker/tools/<code>/; register in registry.ts.
import type { z } from "zod";
import type { Candle, Timeframe } from "../exchange/types.ts";

export type Style = "scalp" | "day" | "swing";
export const STYLES: Style[] = ["scalp", "day", "swing"];

/** Timeframes analysed per style; first entry = execution timeframe (ATR reference for zone tolerance). */
export const STYLE_TIMEFRAMES: Record<Style, Timeframe[]> = {
  scalp: ["5m", "1m", "15m"],
  day: ["1h", "15m", "4h"],
  swing: ["4h", "1d"],
};

export type LevelType = "support" | "resistance" | "pivot" | "zone" | "invalidation";

export interface ToolLevel {
  timeframe: Timeframe;
  levelType: LevelType;
  priceLow: number;
  priceHigh: number;
  strength: number; // 0..1, tool-native
  label: string; // e.g. "W2 0.618 retrace of W1"
  touches?: number;
  firstSeen?: Date;
  lastSeen?: Date;
  meta?: Record<string, unknown>;
}

export interface ToolTimeWindow {
  timeframe: Timeframe;
  from: Date;
  to: Date;
  label: string;
  strength: number;
}

export type BiasDirection = "bullish" | "bearish" | "neutral";

export interface ToolBias {
  direction: BiasDirection;
  confidence: number; // 0..1
  invalidation?: number; // price that proves the read wrong
  rationale: string;
  meta?: Record<string, unknown>;
}

export interface ToolOutput {
  levels: ToolLevel[];
  timeWindows?: ToolTimeWindow[];
  bias?: ToolBias;
  meta?: Record<string, unknown>;
}

export interface ToolContext<P = unknown> {
  exchange: string;
  symbol: string;
  style: Style;
  /** Candles per timeframe, ascending, confirmed only. */
  candles: Partial<Record<Timeframe, Candle[]>>;
  /** ATR(14) per timeframe (last value). */
  atr: Partial<Record<Timeframe, number>>;
  lastPrice: number;
  now: Date;
  params: P;
}

export interface TaTool<P = unknown> {
  code: string;
  name: string;
  version: number;
  description: string;
  paramsSchema: z.ZodType<P, z.ZodTypeDef, unknown>;
  defaultParams: P;
  /** Minimum candles needed per timeframe for a meaningful result. */
  minCandles: number;
  compute(ctx: ToolContext<P>): ToolOutput;
}
