import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { annualFolds, evaluate, labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";
const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab0 = labArgsFrom(args, series.to);
const base = JSON.parse(await Deno.readTextFile(String(args.base)));
const run = (cfg: Record<string, unknown>, start: string, end: string) => {
  const rows = series.rows.filter((r) => r.close_date <= end);
  const lab = { ...lab0, start, end, config: { ...lab0.config, ...cfg } as typeof lab0.config };
  const sim = simulateSthCb(rows, simParams(lab), { ledger: false, daily: false });
  const ev = evaluate(rows, lab, lab.config, annualFolds(start, end));
  const m = sim.summary.sth_cb; return { x: m.nav_vs_hodl, dd: m.max_drawdown, wf: `${ev.folds_beating_hodl}/${annualFolds(start, end).length}`, cagr: m.final_cagr_percent };
};
const thr = [-0.045, -0.04, -0.035, -0.03, -0.025, -0.02, -0.015];
console.log("momoThreshold   TRAIN 2015-01-04→2019-12-31        TEST 2020-01-01→2026-11-05        REVERSE-TRAIN 2020→   REVERSE-TEST 2015→2019");
for (const t of thr) {
  const a = run({ ...base, momoThreshold: t }, "2015-01-04", "2019-12-31");
  const b = run({ ...base, momoThreshold: t }, "2020-01-01", "2026-11-05");
  console.log(`${String(t).padEnd(14)} ${a.x.toFixed(2).padStart(6)}× DD ${(a.dd*100).toFixed(0)}% WF ${a.wf}      ${b.x.toFixed(2).padStart(6)}× DD ${(b.dd*100).toFixed(0)}% WF ${b.wf} CAGR ${b.cagr.toFixed(0)}%`);
}
