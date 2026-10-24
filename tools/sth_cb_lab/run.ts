// tools/sth_cb_lab/run.ts
// Run ONE configuration locally and print the summary + fill trail.
//
//   deno run -A tools/sth_cb_lab/run.ts
//   deno run -A tools/sth_cb_lab/run.ts --start 2020-01-01 --end 2026-10-23 --upfront 1000 --monthly 100
//   deno run -A tools/sth_cb_lab/run.ts --extras '{"trendExitConfirmDays":3}'
//   deno run -A tools/sth_cb_lab/run.ts --config '{"trendExitRatio":0.92}' --same-day --fees exchange_only
//   deno run -A tools/sth_cb_lab/run.ts --walk-forward          # per-year OOS table
//   deno run -A tools/sth_cb_lab/run.ts --json                  # machine-readable summary

import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { annualFolds, configDiff, evaluate, fmtPct, fmtUsd, fmtX, labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab = labArgsFrom(args, series.to);
const rows = series.rows.filter((r) => r.close_date <= lab.end);

const t0 = performance.now();
const sim = simulateSthCb(rows, simParams(lab), { ledger: false, daily: true });
const ms = performance.now() - t0;
const m = sim.summary.sth_cb;

if (args.json) {
  console.log(JSON.stringify({ lab, summary: sim.summary }, null, 2));
  Deno.exit(0);
}

console.log(`\nSTH_CB lab run  ${lab.start} → ${lab.end}  (${m.days} days, ${ms.toFixed(0)} ms)`);
console.log(`Contributions   $${lab.upfront} upfront + $${lab.monthly}/month · fees=${lab.fees} · fill=${lab.sameDay ? "same-day" : "next-day"}`);
console.log(`Config          ${configDiff(lab.config)}`);
console.log(`Warm-up         ${sim.summary.warmup.rows} rows → start state ${JSON.stringify(sim.summary.warmup.state_at_start)}\n`);

const line = (k: string, v: string) => console.log(`  ${k.padEnd(22)} ${v}`);
line("Final NAV", `${fmtUsd(m.final_nav_usd)}   (HODL ${fmtUsd(sim.summary.hodl?.final_nav_usd ?? NaN)}, Std DCA ${fmtUsd(sim.summary.std_dca?.final_nav_usd ?? NaN)})`);
line("NAV ÷ HODL", fmtX(m.nav_vs_hodl));
line("NAV ÷ Std DCA", fmtX(m.nav_vs_std_dca));
line("ROI / CAGR", `${fmtPct(m.final_roi_percent, 0)} / ${fmtPct(m.final_cagr_percent)}`);
line("Max drawdown", fmtPct(m.max_drawdown * 100, 1));
line("Calmar / Sharpe", `${m.calmar.toFixed(2)} / ${m.sharpe.toFixed(2)}`);
line("Trades", `${m.trades} round-trips · ${m.pct_time_in_market}% time in market`);
line("Fees", `mgmt/platform ${fmtUsd(m.fees.platform_or_mgmt_usdt)} · perf ${fmtUsd(m.fees.performance_usdt)} · USDPC conv ${fmtUsd(m.fees.usdpc_conversion_usdt)} · exch ${m.fees.exchange_btc.toFixed(4)} BTC`);

console.log("\nFill trail (non-contribution trades):");
console.log("  date        act  rule                               price      CB         ratio  ROC      alloc  NAV");
for (const r of sim.results) {
  if (r.action === "HOLD" || /contribution|Rebalance/i.test(r.rule)) continue;
  console.log(`  ${r.trade_date}  ${r.action.padEnd(4)} ${r.rule.padEnd(34).slice(0, 34)} ${r.price_usd.toFixed(0).padStart(9)}  ${r.sth_cost_basis_usd.toFixed(0).padStart(9)}  ${(r.price_to_cb_ratio ?? 0).toFixed(3)}  ${(r.roc * 100).toFixed(1).padStart(6)}%  ${(r.target_alloc * 100).toFixed(0).padStart(4)}%  ${fmtUsd(r.nav_usd)}`);
}

if (args["walk-forward"]) {
  const folds = annualFolds(lab.start, lab.end);
  const ev = evaluate(rows, lab, lab.config, folds);
  console.log(`\nWalk-forward (annual out-of-sample windows, each seeded by warm-up to that date): ${ev.folds_beating_hodl}/${folds.length} beat HODL`);
  console.log("  window                   NAV÷HODL   CAGR");
  for (const f of ev.folds ?? []) console.log(`  ${f.fold.oosStart} → ${f.fold.oosEnd}  ${fmtX(f.nav_vs_hodl).padStart(8)}  ${fmtPct(f.cagr, 1).padStart(8)} ${f.beat_hodl ? "✓" : ""}`);
}
console.log("");
