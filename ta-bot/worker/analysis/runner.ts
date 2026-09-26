// Analysis runner: candles → tools → confluence zones → ta_bot.analysis_runs / levels / confluence_zones.
import type { Candle, Timeframe } from "../exchange/types.ts";
import { loadCandles } from "../db/marketData.ts";
import { db, jsonb } from "../db/client.ts";
import { lastAtr } from "../tools/indicators.ts";
import { loadEnabledTools, type LoadedTool } from "../tools/registry.ts";
import { STYLE_TIMEFRAMES, type Style, type ToolBias, type ToolContext, type ToolTimeWindow } from "../tools/types.ts";
import { buildConfluenceZones, type ConfluenceZone, type WeightedLevel } from "../confluence/engine.ts";
import { logger, errMsg } from "../log.ts";

const log = logger("analysis");

const CANDLES_PER_TF: Record<Timeframe, number> = { "1m": 1500, "5m": 1500, "15m": 1500, "1h": 1500, "4h": 1500, "1d": 1500 };
const ZONE_TTL_MS: Record<Style, number> = { scalp: 2 * 3600e3, day: 24 * 3600e3, swing: 5 * 86400e3 };
const MAX_DISTANCE_PCT: Record<Style, number> = { scalp: 0.03, day: 0.08, swing: 0.2 };

export interface AnalysisResult {
  runId: string;
  exchange: string;
  symbol: string;
  style: Style;
  lastPrice: number;
  atr: number;
  zones: ConfluenceZone[];
  biases: Record<string, ToolBias | undefined>;
  timeWindows: ToolTimeWindow[];
  levelCount: number;
}

export async function runAnalysis(exchange: string, symbol: string, style: Style, opts: { persist?: boolean; tools?: LoadedTool[] } = {}): Promise<AnalysisResult> {
  const persist = opts.persist ?? true;
  const tfs = STYLE_TIMEFRAMES[style];
  const tools = opts.tools ?? await loadEnabledTools();
  if (tools.length === 0) throw new Error("No enabled tools in ta_bot.tools");

  const candles: Partial<Record<Timeframe, Candle[]>> = {};
  const atr: Partial<Record<Timeframe, number>> = {};
  for (const tf of tfs) {
    const c = await loadCandles(exchange, symbol, tf, CANDLES_PER_TF[tf]);
    if (c.length > 0) {
      candles[tf] = c;
      atr[tf] = lastAtr(c);
    }
  }
  const exec = candles[tfs[0]!];
  if (!exec || exec.length < 50) throw new Error(`Insufficient ${tfs[0]} candles for ${symbol}`);
  const lastPrice = exec[exec.length - 1]!.close;
  const candlesThrough = exec[exec.length - 1]!.openTime;
  const now = new Date();

  const sql = db();
  let runId = "";
  if (persist) {
    const [row] = await sql<{ run_id: string }[]>`
      INSERT INTO ta_bot.analysis_runs (exchange, symbol, style, timeframes, candles_through, tool_codes)
      VALUES (${exchange}, ${symbol}, ${style}, ${tfs}, ${candlesThrough}, ${tools.map((t) => t.tool.code)})
      RETURNING run_id`;
    runId = row!.run_id;
  }

  try {
    const weighted: WeightedLevel[] = [];
    const windows: ToolTimeWindow[] = [];
    const biases: Record<string, ToolBias | undefined> = {};
    const toolMeta: Record<string, unknown> = {};

    for (const lt of tools) {
      const ctx: ToolContext = { exchange, symbol, style, candles, atr, lastPrice, now, params: lt.params };
      try {
        const out = lt.tool.compute(ctx);
        for (const l of out.levels) weighted.push({ ...l, toolCode: lt.tool.code, toolWeight: lt.weight });
        windows.push(...(out.timeWindows ?? []));
        biases[lt.tool.code] = out.bias;
        toolMeta[lt.tool.code] = out.meta;
      } catch (e) {
        log.error("tool failed", { tool: lt.tool.code, symbol, err: errMsg(e) });
        toolMeta[lt.tool.code] = { error: errMsg(e) };
      }
    }

    const zones = buildConfluenceZones(weighted, {
      atr: atr[tfs[0]!]!,
      lastPrice,
      now,
      timeWindows: windows,
      maxDistancePct: MAX_DISTANCE_PCT[style],
    });

    if (persist) {
      await persistLevels(runId, exchange, symbol, weighted);
      await persistZones(runId, exchange, symbol, style, zones, now);
      await sql`
        UPDATE ta_bot.analysis_runs SET status = 'ok', finished_at = now(),
          meta = ${jsonb({ lastPrice, atr, biases, timeWindows: windows, tools: toolMeta, zoneCount: zones.length })}
        WHERE run_id = ${runId}`;
    }
    log.info("analysis complete", { symbol, style, levels: weighted.length, zones: zones.length });
    return { runId, exchange, symbol, style, lastPrice, atr: atr[tfs[0]!]!, zones, biases, timeWindows: windows, levelCount: weighted.length };
  } catch (e) {
    if (persist) await sql`UPDATE ta_bot.analysis_runs SET status = 'error', error = ${errMsg(e)}, finished_at = now() WHERE run_id = ${runId}`;
    throw e;
  }
}

async function persistLevels(runId: string, exchange: string, symbol: string, levels: WeightedLevel[]): Promise<void> {
  if (levels.length === 0) return;
  const sql = db();
  const rows = levels.map((l) => ({
    run_id: runId,
    exchange,
    symbol,
    timeframe: l.timeframe,
    tool_code: l.toolCode,
    level_type: l.levelType,
    price_low: l.priceLow,
    price_high: l.priceHigh,
    strength: l.strength,
    touches: l.touches ?? null,
    first_seen: l.firstSeen ?? null,
    last_seen: l.lastSeen ?? null,
    meta: jsonb({ label: l.label, ...(l.meta ?? {}) }),
  }));
  const inserted = await sql<{ level_id: string; price_low: number; price_high: number; tool_code: string; timeframe: string }[]>`
    INSERT INTO ta_bot.levels ${sql(rows)} RETURNING level_id, price_low, price_high, tool_code, timeframe`;
  // Map ids back by position (RETURNING preserves input order for a single VALUES insert).
  inserted.forEach((r, i) => {
    if (levels[i]) levels[i]!.levelId = r.level_id;
  });
}

async function persistZones(runId: string, exchange: string, symbol: string, style: Style, zones: ConfluenceZone[], now: Date): Promise<void> {
  if (zones.length === 0) return;
  const sql = db();
  const rows = zones.map((z) => ({
    run_id: runId,
    exchange,
    symbol,
    style,
    price_low: z.priceLow,
    price_high: z.priceHigh,
    bias: z.bias,
    score: z.score,
    prob_baseline: z.probPrior,
    prob_final: null,
    tool_codes: z.toolCodes,
    level_ids: z.levels.map((l) => l.levelId).filter((x): x is string => !!x),
    rationale: z.rationale,
    valid_from: now,
    expires_at: new Date(now.getTime() + ZONE_TTL_MS[style]),
  }));
  await sql`INSERT INTO ta_bot.confluence_zones ${sql(rows)}`;
}
