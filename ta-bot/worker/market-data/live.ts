import type { Candle, ExchangeAdapter, Timeframe, Unsubscribe } from "../exchange/types.ts";
import { upsertCandles } from "../db/marketData.ts";
import { logger } from "../log.ts";

const log = logger("live");

export type CandleListener = (c: Candle) => void;

/**
 * Streams klines for tracked symbols; persists CONFIRMED candles and fans every frame
 * (confirmed or forming) out to in-process listeners (analysis triggers in later phases).
 */
export class LiveCandleStream {
  private unsub: Unsubscribe | undefined;
  private listeners = new Set<CandleListener>();
  private pending: Candle[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  stats = { framesReceived: 0, confirmedPersisted: 0, lastFrameAt: 0 };

  constructor(private readonly ex: ExchangeAdapter) {}

  onCandle(fn: CandleListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start(symbols: string[], timeframes: Timeframe[]): Promise<void> {
    await this.stop();
    if (symbols.length === 0) {
      log.warn("no tracked symbols; live stream idle");
      return;
    }
    const subs = symbols.flatMap((symbol) => timeframes.map((timeframe) => ({ symbol, timeframe })));
    this.unsub = await this.ex.subscribeKlines(subs, (c) => this.handle(c));
    this.flushTimer = setInterval(() => void this.flush(), 1000);
    log.info("streaming", { symbols, timeframes, topics: subs.length });
  }

  async stop(): Promise<void> {
    this.unsub?.();
    this.unsub = undefined;
    if (this.flushTimer !== undefined) clearInterval(this.flushTimer);
    this.flushTimer = undefined;
    await this.flush();
  }

  private handle(c: Candle): void {
    this.stats.framesReceived++;
    this.stats.lastFrameAt = Date.now();
    if (c.confirmed) this.pending.push(c);
    for (const fn of this.listeners) {
      try {
        fn(c);
      } catch (e) {
        log.error("listener threw", { err: (e as Error).message });
      }
    }
  }

  private async flush(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    try {
      this.stats.confirmedPersisted += await upsertCandles(batch);
    } catch (e) {
      this.pending.unshift(...batch); // retry on next tick
      log.error("persist failed", { n: batch.length, err: (e as Error).message });
    }
  }
}
