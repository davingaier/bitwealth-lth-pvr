// Runs analyses on candle close: one queue, sequential, deduped per (symbol, style).
import type { Candle } from "../exchange/types.ts";
import { STYLE_TIMEFRAMES, STYLES, type Style } from "../tools/types.ts";
import { runAnalysis } from "./runner.ts";
import { startAgentRun } from "../db/ops.ts";
import { logAlert } from "../db/alerts.ts";
import { logger, errMsg } from "../log.ts";

const log = logger("analysis.scheduler");

export class AnalysisScheduler {
  private queue: { symbol: string; style: Style }[] = [];
  private running = false;
  stats = { queued: 0, completed: 0, failed: 0, lastCompletedAt: 0, lastError: undefined as string | undefined };

  constructor(private readonly exchange: string, private readonly orgId: string) {}

  /** Wire to the live stream: a confirmed candle on a style's execution TF schedules that style. */
  onCandle(c: Candle): void {
    if (!c.confirmed) return;
    for (const style of STYLES) {
      if (STYLE_TIMEFRAMES[style][0] === c.timeframe) this.enqueue(c.symbol, style);
    }
  }

  enqueueAll(symbols: string[]): void {
    for (const s of symbols) for (const st of STYLES) this.enqueue(s, st);
  }

  enqueue(symbol: string, style: Style): void {
    if (this.queue.some((q) => q.symbol === symbol && q.style === style)) return;
    this.queue.push({ symbol, style });
    this.stats.queued++;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        const run = await startAgentRun("analyst", { orgId: this.orgId, symbol: job.symbol, meta: { style: job.style, mode: "deterministic" } });
        try {
          const r = await runAnalysis(this.exchange, job.symbol, job.style);
          await run.ok({ meta: { analysis_run_id: r.runId, zones: r.zones.length, levels: r.levelCount } });
          this.stats.completed++;
          this.stats.lastCompletedAt = Date.now();
        } catch (e) {
          this.stats.failed++;
          this.stats.lastError = errMsg(e);
          await run.fail(e);
          log.error("analysis failed", { ...job, err: errMsg(e) });
          if (!/Insufficient .* candles/.test(errMsg(e))) {
            await logAlert("ta_bot_analysis", "error", `analysis failed ${job.symbol}/${job.style}: ${errMsg(e)}`, job, this.orgId);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
