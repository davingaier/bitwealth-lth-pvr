import { db, jsonb } from "./client.ts";
import type { Candle, Instrument, Timeframe } from "../exchange/types.ts";

const CHUNK = 500;

export async function upsertCandles(candles: Candle[]): Promise<number> {
  if (candles.length === 0) return 0;
  const sql = db();
  let n = 0;
  for (let i = 0; i < candles.length; i += CHUNK) {
    const rows = candles.slice(i, i + CHUNK).map((c) => ({
      exchange: c.exchange,
      symbol: c.symbol,
      timeframe: c.timeframe,
      open_time: c.openTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      turnover: c.turnover ?? null,
      confirmed: c.confirmed,
    }));
    await sql`
      INSERT INTO ta_bot.candles ${sql(rows)}
      ON CONFLICT (exchange, symbol, timeframe, open_time) DO UPDATE SET
        open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
        volume = EXCLUDED.volume, turnover = EXCLUDED.turnover,
        confirmed = ta_bot.candles.confirmed OR EXCLUDED.confirmed,
        updated_at = now()`;
    n += rows.length;
  }
  return n;
}

export async function latestConfirmedOpenTime(
  exchange: string,
  symbol: string,
  tf: Timeframe,
): Promise<Date | undefined> {
  const [row] = await db()<{ t: Date | null }[]>`
    SELECT max(open_time) AS t FROM ta_bot.candles
    WHERE exchange = ${exchange} AND symbol = ${symbol} AND timeframe = ${tf} AND confirmed`;
  return row?.t ?? undefined;
}

/** Most recent `limit` confirmed candles, ascending. */
export async function loadCandles(
  exchange: string,
  symbol: string,
  tf: Timeframe,
  limit: number,
  before?: Date,
): Promise<Candle[]> {
  const rows = await db()<CandleRow[]>`
    SELECT * FROM (
      SELECT exchange, symbol, timeframe, open_time, open, high, low, close, volume, turnover, confirmed
      FROM ta_bot.candles
      WHERE exchange = ${exchange} AND symbol = ${symbol} AND timeframe = ${tf} AND confirmed
        ${before ? db()`AND open_time < ${before}` : db()``}
      ORDER BY open_time DESC LIMIT ${limit}
    ) x ORDER BY open_time ASC`;
  return rows.map(fromRow);
}

export async function loadCandleRange(
  exchange: string,
  symbol: string,
  tf: Timeframe,
  from: Date,
  to: Date,
): Promise<Candle[]> {
  const rows = await db()<CandleRow[]>`
    SELECT exchange, symbol, timeframe, open_time, open, high, low, close, volume, turnover, confirmed
    FROM ta_bot.candles
    WHERE exchange = ${exchange} AND symbol = ${symbol} AND timeframe = ${tf} AND confirmed
      AND open_time >= ${from} AND open_time <= ${to}
    ORDER BY open_time ASC`;
  return rows.map(fromRow);
}

export async function candleCoverage(exchange: string): Promise<CoverageRow[]> {
  return await db()<CoverageRow[]>`
    SELECT symbol, timeframe, count(*)::int AS n, min(open_time) AS first_ts, max(open_time) AS last_ts
    FROM ta_bot.candles WHERE exchange = ${exchange} AND confirmed
    GROUP BY symbol, timeframe ORDER BY symbol, timeframe`;
}

// ---------------------------------------------------------------- instruments
export async function upsertInstruments(list: Instrument[]): Promise<number> {
  if (list.length === 0) return 0;
  const sql = db();
  let n = 0;
  for (let i = 0; i < list.length; i += CHUNK) {
    const rows = list.slice(i, i + CHUNK).map((x) => ({
      exchange: x.exchange,
      symbol: x.symbol,
      tv_symbol: x.tvSymbol,
      category: x.category,
      base_asset: x.baseAsset,
      quote_asset: x.quoteAsset,
      tick_size: x.tickSize,
      qty_step: x.qtyStep,
      min_qty: x.minQty,
      max_qty: x.maxQty ?? null,
      min_notional: x.minNotional ?? null,
      max_leverage: x.maxLeverage ?? null,
      status: x.status,
      raw: jsonb(x.raw),
    }));
    await sql`
      INSERT INTO ta_bot.instruments ${sql(rows)}
      ON CONFLICT (exchange, symbol) DO UPDATE SET
        tv_symbol = EXCLUDED.tv_symbol, category = EXCLUDED.category,
        base_asset = EXCLUDED.base_asset, quote_asset = EXCLUDED.quote_asset,
        tick_size = EXCLUDED.tick_size, qty_step = EXCLUDED.qty_step, min_qty = EXCLUDED.min_qty,
        max_qty = EXCLUDED.max_qty, min_notional = EXCLUDED.min_notional, max_leverage = EXCLUDED.max_leverage,
        status = EXCLUDED.status, raw = EXCLUDED.raw, updated_at = now()`;
    n += rows.length;
  }
  return n;
}

export async function trackedSymbols(exchange: string): Promise<string[]> {
  const rows = await db()<{ symbol: string }[]>`
    SELECT symbol FROM ta_bot.instruments WHERE exchange = ${exchange} AND tracked ORDER BY symbol`;
  return rows.map((r) => r.symbol);
}

export async function setTracked(exchange: string, symbol: string, tracked: boolean): Promise<boolean> {
  const res = await db()`
    UPDATE ta_bot.instruments SET tracked = ${tracked}, updated_at = now()
    WHERE exchange = ${exchange} AND symbol = ${symbol}`;
  return res.count > 0;
}

// ---------------------------------------------------------------- row shapes
interface CandleRow {
  exchange: string;
  symbol: string;
  timeframe: Timeframe;
  open_time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number | null;
  confirmed: boolean;
}

export interface CoverageRow {
  symbol: string;
  timeframe: Timeframe;
  n: number;
  first_ts: Date;
  last_ts: Date;
}

function fromRow(r: CandleRow): Candle {
  return {
    exchange: r.exchange,
    symbol: r.symbol,
    timeframe: r.timeframe,
    openTime: r.open_time,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    turnover: r.turnover ?? undefined,
    confirmed: r.confirmed,
  };
}
