// tools/sth_cb_lab/compare_price_source.ts
// Side-by-side: the SAME config run on (a) RB daily-average prices (data/series.json, what production has always used)
// and (b) true UTC closes (data/series_close.json). Nothing is refitted — this measures what switching the price
// series alone does to every published figure, before deciding to re-publish.
//
//   deno run -A tools/sth_cb_lab/compare_price_source.ts [--config-file x.json]   (default: HYBRID_V2_2)

import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { DEFAULT_STH_CB_CONFIG, SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { HYBRID_V2_2 } from "./factsheet_data_configs.ts";
import { annualFolds, evaluate, fmtPct, fmtUsd, fmtX, LAB_DIR, LabArgs, parseArgs, simParams } from "./lab_core.ts";

const a = parseArgs(Deno.args);
const extras = typeof a["config-file"] === "string" ? JSON.parse(await Deno.readTextFile(String(a["config-file"]))) : HYBRID_V2_2;
const config: SthCbConfig = { ...DEFAULT_STH_CB_CONFIG, ...extras };

const avg = JSON.parse(await Deno.readTextFile(`${LAB_DIR}data/series.json`));
const cls = JSON.parse(await Deno.readTextFile(`${LAB_DIR}data/series_close.json`));
const end = avg.to < cls.to ? avg.to : cls.to;

const lab = (start: string, upfront: number, monthly: number, fees: "full" | "exchange_only"): LabArgs =>
  ({ start, end, upfront, monthly, sameDay: false, fees, tradeBps: 8, contribBps: 18, config });

type Row = { label: string; start: string; upfront: number; monthly: number; fees: "full" | "exchange_only" };
const rows: Row[] = [
  { label: "Fact-sheet basis: $1k lump 2017→, full fees", start: "2017-01-01", upfront: 1000, monthly: 0, fees: "full" },
  { label: "Website table basis: $2.4k + $200/mo 2016-11→ (10y)", start: "2016-11-01", upfront: 2400, monthly: 200, fees: "full" },
  { label: "7y: $2.4k + $200/mo 2019-11→", start: "2019-11-01", upfront: 2400, monthly: 200, fees: "full" },
  { label: "5y: 2021-11→", start: "2021-11-01", upfront: 2400, monthly: 200, fees: "full" },
  { label: "3y: 2023-11→", start: "2023-11-01", upfront: 2400, monthly: 200, fees: "full" },
  { label: "1y: 2025-11→", start: "2025-11-01", upfront: 2400, monthly: 200, fees: "full" },
  { label: "Lump $10k 2020-01→, exchange-only fees", start: "2020-01-01", upfront: 10_000, monthly: 0, fees: "exchange_only" },
];

console.log(`\n# Price-source comparison — ${a["config-file"] ? "custom config" : "hybrid_v2_2"} · same rules, same fees · end ${end}`);
console.log(`avg = RB daily average (production today) · close = Binance UTC close (RB 23:00 bar before 2017-08-17)\n`);
console.log("| basis | NAV avg | NAV close | Δ NAV | ×HODL avg | ×HODL close | DD avg | DD close | trades avg/close | WF avg | WF close |");
console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const r of rows) {
  const l = lab(r.start, r.upfront, r.monthly, r.fees);
  const folds = annualFolds(r.start, end);
  const A = evaluate(avg.rows, l, config, folds), C = evaluate(cls.rows, l, config, folds);
  const d = (C.metrics.final_nav_usd / A.metrics.final_nav_usd - 1) * 100;
  console.log(`| ${r.label} | ${fmtUsd(A.metrics.final_nav_usd)} | ${fmtUsd(C.metrics.final_nav_usd)} | ${d >= 0 ? "+" : ""}${d.toFixed(1)}% | ${fmtX(A.metrics.nav_vs_hodl, 2)} | ${fmtX(C.metrics.nav_vs_hodl, 2)} | ${fmtPct(A.metrics.max_drawdown * 100, 0)} | ${fmtPct(C.metrics.max_drawdown * 100, 0)} | ${A.metrics.trades}/${C.metrics.trades} | ${A.folds_beating_hodl}/${folds.length} | ${C.folds_beating_hodl}/${folds.length} |`);
}

// Signal-level diff on the fact-sheet basis: where do the two series disagree?
const l0 = lab("2017-01-01", 1000, 0, "full");
const sA = simulateSthCb(avg.rows, simParams(l0, config), { ledger: false, daily: true });
const sC = simulateSthCb(cls.rows, simParams(l0, config), { ledger: false, daily: true });
const byDate = new Map(sC.results.map((r) => [r.close_date, r]));
let same = 0, diff = 0; const changes: string[] = [];
for (const r of sA.results) {
  const c = byDate.get(r.close_date); if (!c) continue;
  if (Math.abs(r.signal_target_alloc - c.signal_target_alloc) < 1e-9) same++; else { diff++; if (changes.length < 40) changes.push(`${r.close_date}: avg ${Math.round(r.signal_target_alloc * 100)}% → close ${Math.round(c.signal_target_alloc * 100)}%  (${c.signal_rule})`); }
}
console.log(`\n## Daily target-allocation agreement (2017→): same ${same} days, different ${diff} days (${(100 * diff / (same + diff)).toFixed(1)} %)`);
console.log("First differences:"); for (const c of changes.slice(0, 25)) console.log("  " + c);

// Today's state under each series
const lastA = sA.results.at(-1)!, lastC = sC.results.at(-1)!;
console.log(`\n## State at ${lastA.close_date}`);
console.log(`  avg  : price ${lastA.price_usd.toFixed(0)} = ${(lastA.price_to_cb_ratio! * 100).toFixed(1)} % of CB · ${lastA.position_state} · signal target ${Math.round(lastA.signal_target_alloc * 100)} % · ${lastA.signal_rule}`);
console.log(`  close: price ${lastC.price_usd.toFixed(0)} = ${(lastC.price_to_cb_ratio! * 100).toFixed(1)} % of CB · ${lastC.position_state} · signal target ${Math.round(lastC.signal_target_alloc * 100)} % · ${lastC.signal_rule}`);
