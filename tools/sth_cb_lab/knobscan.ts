import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { annualFolds, evaluate, labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";
const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab0 = labArgsFrom(args, series.to);
const base = JSON.parse(await Deno.readTextFile(String(args.base)));
const starts = ["2017-01-01","2018-01-01","2019-01-01","2020-01-01","2021-01-01","2022-01-01","2023-01-01","2024-01-01"];
const rowsAll = series.rows.filter((r) => r.close_date <= lab0.end);
const run = (cfg: Record<string, unknown>, start: string) => {
  const lab = { ...lab0, start, config: { ...lab0.config, ...cfg } as typeof lab0.config };
  return simulateSthCb(rowsAll, simParams(lab), { ledger: false, daily: false }).summary.sth_cb;
};
const wf = (cfg: Record<string, unknown>) => { const lab = { ...lab0, config: { ...lab0.config, ...cfg } as typeof lab0.config }; return evaluate(rowsAll, lab, lab.config, annualFolds(lab0.start, lab0.end)).folds_beating_hodl; };
const variants: Array<[string, Record<string, unknown>]> = [
  ["C1 base", {}],
  ["exitRocLength 3", { exitRocLength: 3 }], ["exitRocLength 4", { exitRocLength: 4 }], ["exitRocLength 5", { exitRocLength: 5 }],
  ["trendExitConfirmDays 2", { trendExitConfirmDays: 2 }], ["trendExitConfirmDays 3", { trendExitConfirmDays: 3 }],
  ["capBuyAtLthSigma -0.75", { capBuyAtLthSigma: -0.75 }], ["capBuyAtLthSigma -0.25", { capBuyAtLthSigma: -0.25 }],
  ["cbSlopeDays 30", { cbSlopeDays: 30 }], ["cbSlopeDays 14", { cbSlopeDays: 14 }],
  ["capBuyRocLength 3", { capBuyRocLength: 3 }], ["capBuyRocLength 5", { capBuyRocLength: 5 }],
  ["momoLength 3", { momoLength: 3 }],
  ["trailingStopPct 0.4", { trailingStopPct: 0.4 }], ["trailingStopPct 0.3", { trailingStopPct: 0.3 }],
  ["minHoldDays 10", { minHoldDays: 10 }], ["minHoldDays 20", { minHoldDays: 20 }],
  ["blockEntryAboveSigma 2", { blockEntryAboveSigma: 2 }],
  ["dipRebuyPct 0.15", { dipRebuyPct: 0.15 }], ["dipRebuyAtCbRatio 1.0", { dipRebuyAtCbRatio: 1.0 }],
  ["trendEnterRatio 1.10", { trendEnterRatio: 1.10 }], ["trendExitRatio 0.96", { trendExitRatio: 0.96 }],
];
const baseRow = starts.map((s) => run(base, s).nav_vs_hodl);
console.log("variant".padEnd(26) + starts.map((s) => s.slice(0,4).padStart(7)).join("") + "   wins  WF   DD");
for (const [label, patch] of variants) {
  const cfg = { ...base, ...patch };
  const xs = starts.map((s) => run(cfg, s).nav_vs_hodl);
  const wins = xs.filter((x, i) => x > baseRow[i] * 1.0001).length;
  console.log(label.padEnd(26) + xs.map((x) => x.toFixed(1).padStart(7)).join("") + `   ${String(wins).padStart(2)}/8  ${wf(cfg)}/10  ${(run(cfg, starts[0]).max_drawdown*100).toFixed(0)}%`);
}
