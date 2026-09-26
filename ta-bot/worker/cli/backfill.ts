// One-off backfill. Usage: deno task backfill --symbol BTCUSDT [--tf 1h,4h] [--days 365]
import { loadConfig } from "../config.ts";
import { closeDb } from "../db/client.ts";
import { candleCoverage } from "../db/marketData.ts";
import { createExchange } from "../exchange/registry.ts";
import { backfillSymbol } from "../market-data/backfill.ts";
import { TIMEFRAMES, type Timeframe } from "../exchange/types.ts";
import { fromTvSymbol } from "../exchange/bybit/mapping.ts";

const cfg = loadConfig();
const arg = (name: string) => {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : undefined;
};

const symbol = arg("symbol");
if (!symbol) {
  console.error("--symbol required");
  Deno.exit(2);
}
const tfs = (arg("tf")?.split(",") as Timeframe[] | undefined) ?? cfg.TA_BOT_TIMEFRAMES;
const daysOverride = arg("days") ? Number(arg("days")) : undefined;
for (const tf of tfs) {
  if (!TIMEFRAMES.includes(tf)) {
    console.error(`bad timeframe ${tf}`);
    Deno.exit(2);
  }
}

const ex = createExchange("bybit", { testnet: cfg.BYBIT_PUBLIC_ENV === "testnet" });
const sym = fromTvSymbol(symbol);
for (const tf of tfs) {
  const r = await backfillSymbol(ex, sym, tf, daysOverride ?? cfg.TA_BOT_BACKFILL_DAYS[tf] ?? 30);
  console.log(`${sym} ${tf}: +${r.inserted} (${r.from.toISOString()} → ${r.to?.toISOString() ?? "-"})`);
}
console.table((await candleCoverage(ex.name)).filter((c) => c.symbol === sym));
await closeDb();
