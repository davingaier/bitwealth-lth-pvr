import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";
const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab0 = labArgsFrom(args, series.to);
const base = JSON.parse(await Deno.readTextFile(String(args.base)));
const rowsAll = series.rows.filter((r) => r.close_date <= lab0.end);
const run = (cfg: Record<string, unknown>, start: string) => simulateSthCb(rowsAll, simParams({ ...lab0, start, config: { ...lab0.config, ...cfg } as typeof lab0.config }), { ledger: false, daily: false }).summary.sth_cb.nav_vs_hodl;
const thr = [-0.04, -0.035, -0.03, -0.025, -0.02];
const lens = [2, 3, 4, 5, 6];
for (const start of ["2017-01-01", "2020-01-01", "2022-01-01"]) {
  console.log(`\n×HODL from ${start}: rows momoThreshold, cols capBuyRocLength`);
  console.log("thr\\len " + lens.map((l) => String(l).padStart(7)).join(""));
  for (const t of thr) console.log(String(t).padEnd(8) + lens.map((l) => run({ ...base, momoThreshold: t, capBuyRocLength: l }, start).toFixed(1).padStart(7)).join(""));
}
