import { TF_MS, type Candle, type ExchangeAdapter, type Timeframe } from "../exchange/types.ts";
import { latestConfirmedOpenTime, upsertCandles } from "../db/marketData.ts";
import { logger } from "../log.ts";
import { sleep } from "../exchange/util.ts";

const log = logger("backfill");
const PAGE = 1000;

export interface BackfillResult {
  symbol: string;
  timeframe: Timeframe;
  inserted: number;
  from: Date;
  to?: Date;
}

/**
 * Fill ta_bot.candles for one symbol/timeframe from the last confirmed candle (or `days` back)
 * up to the most recent CLOSED candle. Idempotent; safe to call repeatedly (gap-heal).
 */
export async function backfillSymbol(
  ex: ExchangeAdapter,
  symbol: string,
  tf: Timeframe,
  days: number,
): Promise<BackfillResult> {
  const tfMs = TF_MS[tf];
  const now = Date.now();
  const last = await latestConfirmedOpenTime(ex.name, symbol, tf);
  // Re-fetch the last stored candle too, in case it was written from a partial WS frame.
  let cursor = last ? last.getTime() : now - days * 86_400_000;
  const from = new Date(cursor);
  let inserted = 0;
  let lastOpen: Date | undefined;

  while (cursor < now - tfMs) {
    const end = Math.min(cursor + PAGE * tfMs - 1, now);
    const batch = await ex.getKlines(symbol, tf, cursor, end, PAGE);
    const closed = batch.filter((c) => c.confirmed);
    if (closed.length === 0) break;
    inserted += await upsertCandles(closed);
    lastOpen = closed[closed.length - 1]!.openTime;
    const next = lastOpen.getTime() + tfMs;
    if (next <= cursor) break; // defensive: no forward progress
    cursor = next;
    if (batch.length < PAGE) break;
    await sleep(120); // stay well under Bybit public rate limits
  }
  log.info("backfilled", { symbol, tf, inserted, from: from.toISOString(), to: lastOpen?.toISOString() });
  return { symbol, timeframe: tf, inserted, from, to: lastOpen };
}

export async function backfillAll(
  ex: ExchangeAdapter,
  symbols: string[],
  timeframes: Timeframe[],
  daysByTf: Partial<Record<Timeframe, number>>,
): Promise<BackfillResult[]> {
  const out: BackfillResult[] = [];
  for (const symbol of symbols) {
    for (const tf of timeframes) {
      try {
        out.push(await backfillSymbol(ex, symbol, tf, daysByTf[tf] ?? 30));
      } catch (e) {
        log.error("backfill failed", { symbol, tf, err: (e as Error).message });
      }
    }
  }
  return out;
}

export function isClosed(c: Candle, nowMs = Date.now()): boolean {
  return c.openTime.getTime() + TF_MS[c.timeframe] <= nowMs;
}
