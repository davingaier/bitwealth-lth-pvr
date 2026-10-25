// tools/sth_cb_lab/lth_run.ts
// Run ONE LTH-PVR-on-STH-CB-bands configuration and print the report.
//
//   deno run -A tools/sth_cb_lab/lth_run.ts                                   # production LTH params on sth_pvr:auto bands
//   deno run -A tools/sth_cb_lab/lth_run.ts --bands ratio_sigma:365:1 --start 2017-01-01 --upfront 1000 --monthly 0
//   deno run -A tools/sth_cb_lab/lth_run.ts --genes '{"bandSpec":"sth_pvr:1.5","B1":0.5,...}'   # paste from lth_optimize output
//   deno run -A tools/sth_cb_lab/lth_run.ts --walk-forward --json

import { annualFolds, fmtPct, fmtUsd, fmtX, labArgsFrom, loadSeries, parseArgs } from "./lab_core.ts";
import { candidateFromGenes, describe, evaluateLth, metricsOf, muteConsole, PROD_GENES, runLth } from "./lth_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab = labArgsFrom(args, series.to);
const genes = { ...PROD_GENES, ...(typeof args.genes === "string" ? JSON.parse(args.genes) : {}) };
if (typeof args.bands === "string") genes.bandSpec = args.bands;
const cand = candidateFromGenes(genes);

const origLog = console.log;
muteConsole();
const t0 = performance.now();
const r = runLth(series.rows, lab, cand);
const ms = performance.now() - t0;
const m = metricsOf(r);
console.log = origLog;

if (args.json) {
  console.log(JSON.stringify({ lab, genes, metrics: m }, null, 2));
  Deno.exit(0);
}

console.log(`\nLTH PVR engine on sth_cb bands  ${lab.start} → ${lab.end}  (${r.days} days, ${ms.toFixed(0)} ms)`);
console.log(`Contributions   $${lab.upfront} upfront + $${lab.monthly}/month · fees=${lab.fees} (${lab.tradeBps}/${lab.contribBps} bps)`);
console.log(`Candidate       ${describe(cand)}\n`);
const line = (k: string, v: string) => console.log(`  ${k.padEnd(22)} ${v}`);
line("Final NAV", `${fmtUsd(m.final_nav_usd)}   (HODL ${fmtUsd(m.hodl_final_nav_usd)}, Std DCA ${fmtUsd(m.std_dca_final_nav_usd)})`);
line("ROI / CAGR", `${fmtPct(m.final_roi_percent, 0)} / ${fmtPct(m.final_cagr_percent)}`);
line("NAV ÷ HODL", fmtX(m.nav_vs_hodl));
line("Max drawdown", fmtPct(m.max_drawdown_percent, 1));
line("Sharpe", m.sharpe_ratio.toFixed(2));
line("Trades", `${m.buys} buys / ${m.sells} sells · ${m.pct_time_invested}% of days holding BTC`);
line("BitWealth fees", fmtUsd(m.fees_total_usdt));

console.log("\nTrades (first 60):");
console.log("  date        act  pct     rule                         price      bucket");
let n = 0;
for (const d of r.daily) {
  if (d.action === "HOLD") continue;
  if (n++ >= 60) { console.log("  …"); break; }
  console.log(`  ${d.trade_date}  ${d.action.padEnd(4)} ${(d.amount_pct * 100).toFixed(1).padStart(5)}%  ${d.rule.padEnd(28).slice(0, 28)} ${d.price_usd.toFixed(0).padStart(9)}  ${d.band_bucket}`);
}

if (args["walk-forward"]) {
  muteConsole();
  const ev = evaluateLth(series.rows, lab, cand, annualFolds(lab.start, lab.end));
  console.log = origLog;
  console.log(`\nWalk-forward: ${ev.folds_beating_hodl}/${ev.folds!.length} calendar years beat HODL`);
  for (const f of ev.folds!) console.log(`  ${f.fold.oosStart} → ${f.fold.oosEnd}  ${fmtX(f.nav_vs_hodl).padStart(8)}  ROI ${fmtPct(f.roi, 0).padStart(8)} ${f.beat_hodl ? "✓" : ""}`);
}
console.log("");
