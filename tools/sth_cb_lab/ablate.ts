import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { annualFolds, evaluate, labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";
// Ablation: start from A, revert each changed knob to B's value (one at a time) and vice-versa.
const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab0 = labArgsFrom(args, series.to);
const rows = series.rows.filter((r) => r.close_date <= lab0.end);
const A = JSON.parse(await Deno.readTextFile(String(args.a)));   // baseline
const B = JSON.parse(await Deno.readTextFile(String(args.b)));   // candidate
const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k]) && !/^momo(Enabled|OnCapExit|OnTrendExit)$/.test(k));
const run = (cfg: Record<string, unknown>) => {
  const lab = { ...lab0, config: { ...lab0.config, ...cfg } as typeof lab0.config };
  const sim = simulateSthCb(rows, simParams(lab), { ledger: false, daily: false });
  const ev = evaluate(rows, lab, lab.config, annualFolds(lab.start, lab.end));
  return { x: sim.summary.sth_cb.nav_vs_hodl, dd: sim.summary.sth_cb.max_drawdown, wf: ev.folds_beating_hodl, tr: sim.summary.sth_cb.trades };
};
const fmt = (r: ReturnType<typeof run>) => `${r.x.toFixed(1).padStart(6)}× DD ${(r.dd*100).toFixed(0)}% WF ${r.wf}/10 tr ${r.tr}`;
console.log(`baseline A : ${fmt(run(A))}`);
console.log(`candidate B: ${fmt(run(B))}`);
console.log("\n-- A + one knob from B --");
for (const k of keys) console.log(`${k.padEnd(24)} ${JSON.stringify(A[k])} -> ${JSON.stringify(B[k])}: ${fmt(run({ ...A, [k]: B[k] }))}`);
console.log("\n-- B with one knob reverted to A --");
for (const k of keys) console.log(`${k.padEnd(24)} ${JSON.stringify(B[k])} -> ${JSON.stringify(A[k])}: ${fmt(run({ ...B, [k]: A[k] }))}`);
