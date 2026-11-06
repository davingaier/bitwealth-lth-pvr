import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { annualFolds, evaluate, labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";
const args = parseArgs(Deno.args);
const series = await loadSeries();
const cands = JSON.parse(await Deno.readTextFile(String(args.file))) as Array<{label:string; config:Record<string,unknown>}>;
const lab0 = labArgsFrom(args, series.to);
const rows = series.rows.filter((r) => r.close_date <= lab0.end);
console.log(`${lab0.start} → ${lab0.end}  $${lab0.upfront} + $${lab0.monthly}/mo  fees=${lab0.fees}`);
console.log("label".padEnd(24) + "NAV".padStart(12) + "×HODL".padStart(8) + "DD".padStart(7) + "trades".padStart(7) + "WF".padStart(6) + "  2026 entry");
for (const c of cands) {
  const lab = { ...lab0, config: { ...lab0.config, ...c.config } as typeof lab0.config };
  const sim = simulateSthCb(rows, simParams(lab), { ledger: false, daily: true });
  const m = sim.summary.sth_cb;
  const ev = evaluate(rows, lab, lab.config, annualFolds(lab.start, lab.end));
  const e26 = sim.results.find((r) => r.trade_date >= "2026-01-01" && r.action === "BUY");
  console.log(c.label.padEnd(24) + ("$" + Math.round(m.final_nav_usd).toLocaleString("en-US")).padStart(12) + m.nav_vs_hodl.toFixed(1).padStart(8) + (m.max_drawdown*100).toFixed(0).padStart(6) + "%" + String(m.trades).padStart(7) + `${ev.folds_beating_hodl}/${annualFolds(lab.start, lab.end).length}`.padStart(6) + "  " + (e26 ? `${e26.trade_date} $${e26.price_usd.toFixed(0)} ${e26.rule}` : "-"));
}
