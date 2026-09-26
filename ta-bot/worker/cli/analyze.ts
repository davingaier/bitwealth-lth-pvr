// Run one analysis and print zones. Usage: deno task analyze --symbol BTCUSDT [--style swing] [--no-persist] [--enable]
import { loadConfig } from "../config.ts";
import { closeDb, db } from "../db/client.ts";
import { runAnalysis } from "../analysis/runner.ts";
import { registerImplementedTools } from "../tools/registry.ts";
import { fromTvSymbol } from "../exchange/bybit/mapping.ts";
import type { Style } from "../tools/types.ts";

loadConfig();
const arg = (n: string) => {
  const i = Deno.args.indexOf(`--${n}`);
  return i >= 0 ? Deno.args[i + 1] : undefined;
};
const symbol = fromTvSymbol(arg("symbol") ?? "BTCUSDT");
const style = (arg("style") ?? "swing") as Style;
const persist = !Deno.args.includes("--no-persist");

await registerImplementedTools();
if (Deno.args.includes("--enable")) {
  await db()`UPDATE ta_bot.tools SET enabled = true WHERE tool_code = 'elliott_fib'`;
}

const r = await runAnalysis("bybit", symbol, style, { persist });
console.log(`\n${symbol} ${style}  price=${r.lastPrice}  ATR=${r.atr.toFixed(2)}  levels=${r.levelCount}  run=${r.runId || "(not persisted)"}`);
for (const [tool, b] of Object.entries(r.biases)) {
  if (b) console.log(`bias[${tool}]: ${b.direction} (${b.confidence}) inval=${b.invalidation ?? "-"} — ${b.rationale}`);
}
console.log("\nTop zones:");
for (const z of r.zones.slice(0, 12)) {
  console.log(
    `  ${z.bias.padEnd(10)} ${z.priceLow.toFixed(1)}–${z.priceHigh.toFixed(1)}  score=${z.score.toFixed(2)}  prior=${(z.probPrior * 100).toFixed(0)}%  ` +
      `dist=${z.distancePct > 0 ? "+" : ""}${z.distancePct.toFixed(2)}%  tfs=${z.timeframes.join("/")}  n=${z.levels.length}`,
  );
  console.log(`      ${z.rationale}`);
}
if (r.timeWindows.length) {
  console.log("\nTime windows (next 5):");
  for (const w of r.timeWindows.filter((w) => w.to >= new Date()).sort((a, b) => a.from.getTime() - b.from.getTime()).slice(0, 5)) {
    console.log(`  ${w.timeframe} ${w.from.toISOString()} → ${w.to.toISOString()}  ${w.label}`);
  }
}
await closeDb();
