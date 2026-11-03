// tools/sth_cb_lab/periods.ts
// Print the fact-sheet "Back-tested performance" table (1/3/5/7/10 years, $2 400 + $200/mo, ending --period-end) for one or
// more configs, plus walk-forward on the standard lump-sum basis and on the 10-year table basis.
//
//   deno run -A tools/sth_cb_lab/periods.ts --extras '{...}' [--extras2 '{...}' --label2 name] [--period-end 2026-06-09]

import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { annualFolds, evaluate, fmtUsd, labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const periodEnd = String(args["period-end"] ?? "2026-06-09");
const shiftYears = (iso: string, y: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - y); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const rawDD = (navs: number[]) => { let peak = 0, dd = 0; for (const v of navs) { if (v > peak) peak = v; if (peak > 0) dd = Math.min(dd, v / peak - 1); } return dd; };

const configs: Array<{ label: string; extras: string }> = [];
for (const k of ["extras", "extras2", "extras3", "extras4"]) if (typeof args[k] === "string") configs.push({ label: String(args["label" + k.replace("extras", "")] ?? k), extras: String(args[k]) });
// --file candidates.json : [{ "label": "...", "config": { ...full config... } }, ...]
if (typeof args.file === "string") for (const c of JSON.parse(Deno.readTextFileSync(String(args.file)))) configs.push({ label: c.label, extras: JSON.stringify(c.config) });
if (!configs.length) { console.error("pass --extras '{...}' or --file candidates.json"); Deno.exit(1); }

const rows = series.rows.filter((r) => r.close_date <= periodEnd);
console.log(`Periods ending ${periodEnd} · $2 400 + $200/mo · next-day fills · full fees\n`);
console.log(`${"period".padEnd(8)}${configs.map((c) => c.label.padStart(16)).join("")}${"  Std DCA".padStart(12)}${"HODL".padStart(12)}   | drawdown (raw NAV) per config`);
const totals: Record<string, number> = {};
for (const y of [1, 3, 5, 7, 10]) {
  const start = shiftYears(periodEnd, y);
  const cells: string[] = [], dds: string[] = [];
  let std = 0, hodl = 0;
  for (const c of configs) {
    const l = labArgsFrom({ start, end: periodEnd, upfront: "2400", monthly: "200", extras: c.extras }, series.to);
    const s = simulateSthCb(rows, simParams(l), { ledger: false, daily: true });
    cells.push(fmtUsd(s.summary.sth_cb.final_nav_usd).padStart(16));
    dds.push(`${c.label} ${(rawDD(s.results.map((d) => d.nav_usd)) * 100).toFixed(0)}%`);
    std = s.summary.std_dca!.final_nav_usd; hodl = s.summary.hodl!.final_nav_usd;
    totals[c.label] = (totals[c.label] ?? 0) + Math.log(s.summary.sth_cb.final_nav_usd);
  }
  console.log(`${(y + "y").padEnd(8)}${cells.join("")}${fmtUsd(std).padStart(12)}${fmtUsd(hodl).padStart(12)}   | ${dds.join(" · ")}`);
}
console.log(`\nWalk-forward (years beating HODL):`);
for (const c of configs) {
  const stdLab = labArgsFrom({ start: "2017-01-01", end: "2026-10-23", upfront: "1000", monthly: "0", extras: c.extras }, series.to);
  const stdRows = series.rows.filter((r) => r.close_date <= stdLab.end);
  const wfStd = evaluate(stdRows, stdLab, stdLab.config as SthCbConfig, annualFolds(stdLab.start, stdLab.end));
  const tabLab = labArgsFrom({ start: shiftYears(periodEnd, 10), end: periodEnd, upfront: "2400", monthly: "200", extras: c.extras }, series.to);
  const wfTab = evaluate(rows, tabLab, tabLab.config as SthCbConfig, annualFolds(tabLab.start, tabLab.end));
  console.log(`  ${c.label.padEnd(14)} standard basis ${wfStd.folds_beating_hodl}/${wfStd.folds!.length}  [${wfStd.folds!.map((f) => f.beat_hodl ? "✓" : "·").join("")}]   table basis ${wfTab.folds_beating_hodl}/${wfTab.folds!.length}  [${wfTab.folds!.map((f) => f.beat_hodl ? "✓" : "·").join("")}]   std-basis NAV ${fmtUsd(wfStd.metrics.final_nav_usd)} · ${wfStd.metrics.trades} trades · DD ${(wfStd.metrics.max_drawdown * 100).toFixed(0)}%`);
}
