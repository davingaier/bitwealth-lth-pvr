import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";
const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab0 = labArgsFrom(args, series.to);
const rows = series.rows.filter((r) => r.close_date <= lab0.end);
const base = JSON.parse(await Deno.readTextFile(String(args.extrasFile)));
const bands = (String(args.bands ?? "0,0.01,0.02,0.03,0.05")).split(",").map(Number);
const penalties: Array<[number, number, string]> = [[1, 0, "ideal (instant)"], [0.25, 1, "25% now, rest +1d"], [0.25, 2, "25% now, rest +2d"], [0, 3, "0% now, all +3d"]];
const floors = (String(args.floors ?? "0")).split(",").map(Number);
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
console.log(`${lab0.start} → ${lab0.end}  $${lab0.upfront} + $${lab0.monthly}/mo  fees=${lab0.fees}`);
console.log("penalty model            band   floor        NAV   ×HODL     DD  staged-d  episodes  conv-buys  delayed  convFees");
for (const [frac, delay, label] of penalties) {
  for (const floor of floors) for (const band of bands) {
    const lab = { ...lab0, config: { ...lab0.config, ...base }, stageBand: band, usdtFloor: floor, unstagedFrac: frac, unstagedDelay: delay };
    const sim = simulateSthCb(rows, simParams(lab), { ledger: false, daily: false, benchmarks: true });
    const m = sim.summary.sth_cb; const s = sim.summary.sth_cb.staging!;
    console.log(`${label.padEnd(22)} ${(band * 100).toFixed(0).padStart(4)}%  ${(floor * 100).toFixed(0).padStart(4)}% ${fmt(m.final_nav_usd).padStart(12)} ${m.nav_vs_hodl.toFixed(1).padStart(7)} ${(m.max_drawdown * 100).toFixed(0).padStart(5)}% ${String(s.staged_days).padStart(9)} ${String(s.staging_episodes).padStart(9)} ${String(s.buys_needing_conversion).padStart(10)} ${String(s.buys_delayed).padStart(8)} ${fmt(sim.summary.sth_cb.fees.usdpc_conversion_usdt).padStart(9)}`);
  }
  console.log("");
}
