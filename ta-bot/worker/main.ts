// TA_BOT worker entrypoint — Phase 0: market data ingestion + ops plumbing.
import { loadConfig, WORKER_VERSION } from "./config.ts";
import { logger, setLogLevel, errMsg } from "./log.ts";
import { closeDb, db } from "./db/client.ts";
import { heartbeat, startAgentRun } from "./db/ops.ts";
import { logAlert } from "./db/alerts.ts";
import { trackedSymbols, upsertInstruments } from "./db/marketData.ts";
import { createExchange } from "./exchange/registry.ts";
import { backfillAll } from "./market-data/backfill.ts";
import { LiveCandleStream } from "./market-data/live.ts";
import { Scheduler } from "./scheduler.ts";
import { startHealthServer } from "./health.ts";
import { AnalysisScheduler } from "./analysis/scheduler.ts";
import { registerImplementedTools } from "./tools/registry.ts";

const log = logger("main");
const cfg = loadConfig();
setLogLevel(cfg.LOG_LEVEL);

const publicEx = createExchange("bybit", { testnet: cfg.BYBIT_PUBLIC_ENV === "testnet" });
const live = new LiveCandleStream(publicEx);
const scheduler = new Scheduler();
const analysis = new AnalysisScheduler(publicEx.name, cfg.TA_BOT_ORG_ID);
live.onCandle((c) => analysis.onCandle(c));
let currentSymbols: string[] = [];
let dbReady = false;
const startedAt = Date.now();

// -------------------------------------------------------------------- jobs
async function syncInstruments(): Promise<void> {
  const run = await startAgentRun("market_data", { meta: { job: "sync_instruments" } });
  try {
    const list = await publicEx.getInstruments();
    const n = await upsertInstruments(list);
    await run.ok({ meta: { upserted: n } });
    log.info("instruments synced", { n });
  } catch (e) {
    await run.fail(e);
    await logAlert("ta_bot_worker", "error", `instrument sync failed: ${errMsg(e)}`, {}, cfg.TA_BOT_ORG_ID);
    throw e;
  }
}

async function refreshTrackedAndStream(): Promise<void> {
  const symbols = await trackedSymbols(publicEx.name);
  const changed = symbols.join(",") !== currentSymbols.join(",");
  if (!changed) return;
  currentSymbols = symbols;
  log.info("tracked set changed", { symbols });
  await live.start(symbols, cfg.TA_BOT_TIMEFRAMES);
  // Don't block boot/refresh on a long history walk; analyse once history is in place.
  void scheduler.runNow("gap_heal").then(() => analysis.enqueueAll(currentSymbols));
}

async function gapHeal(): Promise<void> {
  if (currentSymbols.length === 0) return;
  const run = await startAgentRun("market_data", { meta: { job: "gap_heal", symbols: currentSymbols } });
  try {
    const results = await backfillAll(publicEx, currentSymbols, cfg.TA_BOT_TIMEFRAMES, cfg.TA_BOT_BACKFILL_DAYS);
    const inserted = results.reduce((a, r) => a + r.inserted, 0);
    await run.ok({ meta: { inserted } });
  } catch (e) {
    await run.fail(e);
    throw e;
  }
}

async function beat(): Promise<void> {
  const staleMs = live.stats.lastFrameAt ? Date.now() - live.stats.lastFrameAt : null;
  await heartbeat(cfg.TA_BOT_WORKER_ID, {
    version: WORKER_VERSION,
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    symbols: currentSymbols,
    live: live.stats,
    live_stale_ms: staleMs,
    analysis: analysis.stats,
    jobs: scheduler.snapshot(),
  });
  // A stream that has gone quiet for 3 minutes while symbols are tracked is a real outage.
  if (currentSymbols.length > 0 && staleMs !== null && staleMs > 180_000) {
    await logAlert("ta_bot_worker", "warn", "live kline stream stale", { stale_ms: staleMs }, cfg.TA_BOT_ORG_ID);
  }
}

scheduler.add({ name: "heartbeat", everyMs: 30_000, run: beat, runOnStart: true });
scheduler.add({ name: "sync_instruments", everyMs: 6 * 3_600_000, run: syncInstruments, runOnStart: true });
scheduler.add({ name: "refresh_tracked", everyMs: 60_000, run: refreshTrackedAndStream, runOnStart: false });
scheduler.add({ name: "gap_heal", everyMs: 5 * 60_000, run: gapHeal, runOnStart: false });
// Safety net: WS hiccups can miss a close; re-analyse everything hourly regardless.
scheduler.add({ name: "analysis_sweep", everyMs: 60 * 60_000, run: () => Promise.resolve(analysis.enqueueAll(currentSymbols)) });

// -------------------------------------------------------------------- boot
async function main(): Promise<void> {
  log.info("starting", {
    version: WORKER_VERSION,
    worker: cfg.TA_BOT_WORKER_ID,
    publicEnv: cfg.BYBIT_PUBLIC_ENV,
    dbHost: new URL(cfg.DATABASE_URL).host,
  });

  startHealthServer(cfg.HEALTH_PORT, () => {
    const staleMs = live.stats.lastFrameAt ? Date.now() - live.stats.lastFrameAt : null;
    return {
      healthy: dbReady && (currentSymbols.length === 0 || staleMs === null || staleMs < 300_000),
      dbReady,
      version: WORKER_VERSION,
      worker: cfg.TA_BOT_WORKER_ID,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      symbols: currentSymbols,
      live: live.stats,
      analysis: analysis.stats,
      jobs: scheduler.snapshot(),
    };
  });

  // Keep the process (and SSH/health) alive while the DB is unreachable; Fly would otherwise crash-loop us.
  for (let attempt = 1; !dbReady; attempt++) {
    try {
      await db()`SELECT 1`;
      dbReady = true;
    } catch (e) {
      log.error("db unreachable", { attempt, err: errMsg(e) });
      if (attempt >= 20) throw e;
      await new Promise((r) => setTimeout(r, Math.min(60_000, 5_000 * attempt)));
    }
  }

  scheduler.start();
  await registerImplementedTools();
  await refreshTrackedAndStream();
  log.info("ready", { port: cfg.HEALTH_PORT });
}

async function shutdown(signal: string): Promise<void> {
  log.info("shutting down", { signal });
  scheduler.stop();
  await live.stop();
  await closeDb();
  Deno.exit(0);
}

Deno.addSignalListener("SIGINT", () => void shutdown("SIGINT"));
if (Deno.build.os !== "windows") Deno.addSignalListener("SIGTERM", () => void shutdown("SIGTERM"));

main().catch(async (e) => {
  log.error("fatal", { err: errMsg(e) });
  await logAlert("ta_bot_worker", "critical", `worker crashed on boot: ${errMsg(e)}`, {}, cfg.TA_BOT_ORG_ID).catch(() => {});
  Deno.exit(1);
});
