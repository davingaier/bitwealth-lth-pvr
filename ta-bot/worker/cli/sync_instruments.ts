// One-off: pull Bybit linear perpetual instruments into ta_bot.instruments, optionally mark some tracked.
// Usage: deno task instruments [--track BTCUSDT,ETHUSDT]
import { loadConfig } from "../config.ts";
import { closeDb } from "../db/client.ts";
import { setTracked, upsertInstruments } from "../db/marketData.ts";
import { createExchange } from "../exchange/registry.ts";
import { fromTvSymbol } from "../exchange/bybit/mapping.ts";

const cfg = loadConfig();
const ex = createExchange("bybit", { testnet: cfg.BYBIT_PUBLIC_ENV === "testnet" });

const trackArg = Deno.args.indexOf("--track");
const toTrack = trackArg >= 0 ? (Deno.args[trackArg + 1] ?? "").split(",").map(fromTvSymbol).filter(Boolean) : [];

const list = await ex.getInstruments();
const n = await upsertInstruments(list);
console.log(`upserted ${n} instruments`);

for (const s of toTrack) {
  const ok = await setTracked(ex.name, s, true);
  console.log(`${ok ? "tracked" : "NOT FOUND"}: ${s}`);
}
await closeDb();
