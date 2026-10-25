// tools/sth_cb_lab/robustness.ts
// Stress a single STH_CB configuration the way a sceptic would.
//
//   deno run -A tools/sth_cb_lab/robustness.ts --extras '{...}' [--start 2017-01-01 --end 2026-10-23 --upfront 1000 --monthly 0]

import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { annualFolds, evaluate, fmtPct, fmtUsd, fmtX, labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab = labArgsFrom(args, series.to);
const rows = series.rows;

type Res = { nav: number; hodl: number; x: number; roi: number; dd: number; trades: number };
const run = (over: Partial<typeof lab> = {}, mutate?: (r: typeof rows[number]) => typeof rows[number]): Res => {
  const l = { ...lab, ...over };
  const data = (mutate ? rows.map(mutate) : rows).filter((r) => r.close_date <= l.end);
  const s = simulateSthCb(data, simParams(l, l.config), { ledger: false, daily: false }).summary;
  const m = s.sth_cb;
  return { nav: m.final_nav_usd, hodl: s.hodl?.final_nav_usd ?? NaN, x: m.nav_vs_hodl, roi: m.final_roi_percent, dd: m.max_drawdown, trades: m.trades };
};
const line = (label: string, r: Res) =>
  console.log(`  ${label.padEnd(44)} ${fmtUsd(r.nav).padStart(12)}  ${fmtX(r.x, 2).padStart(7)} HODL  ROI ${fmtPct(r.roi, 0).padStart(9)}  DD ${fmtPct(r.dd * 100, 0).padStart(5)}  ${String(r.trades).padStart(3)} trades`);

console.log(`\nRobustness · ${lab.start} → ${lab.end} · $${lab.upfront} + $${lab.monthly}/mo · fees=${lab.fees}`);
console.log(`Config: ${JSON.stringify(lab.config)}\n`);

console.log("1) Baseline");
line("as configured (next-day fills, full fees)", run());
line("same-day fills", run({ sameDay: true }));
line("exchange fees only (no BitWealth fees)", run({ fees: "exchange_only" }));

console.log("\n2) Cost-basis data shifted (provider differences)");
for (const k of [0.94, 0.97, 0.985, 1.015, 1.03, 1.06]) line(`STH cost basis × ${k}`, run({}, (r) => ({ ...r, cb: r.cb * k })));
{
  const lagged = rows.map((r, i) => ({ ...r, cb: i > 0 ? rows[i - 1].cb : r.cb }));
  const s = simulateSthCb(lagged.filter((r) => r.close_date <= lab.end), simParams(lab), { ledger: false, daily: false }).summary;
  line("STH cost basis lagged 1 day", { nav: s.sth_cb.final_nav_usd, hodl: s.hodl!.final_nav_usd, x: s.sth_cb.nav_vs_hodl, roi: s.sth_cb.final_roi_percent, dd: s.sth_cb.max_drawdown, trades: s.sth_cb.trades });
}

console.log("\n3) LTH PVR bands shifted (they drive distribution / LTH capitulation triggers)");
for (const k of [0.95, 1.05]) line(`LTH bands × ${k}`, run({}, (r) => ({ ...r, bands: r.bands ? Object.fromEntries(Object.entries(r.bands).map(([a, v]) => [a, v == null ? v : Number(v) * k])) : r.bands })));

console.log("\n4) Different start dates (same end, $1 000 lump sum)");
for (const st of ["2015-01-04", "2016-01-01", "2017-01-01", "2018-01-01", "2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01", "2023-01-01"]) line(`start ${st}`, run({ start: st }));

console.log("\n5) Contribution schedules");
line("$10 000 upfront + $500/month", run({ upfront: 10_000, monthly: 500 }));
line("$0 upfront + $100/month", run({ upfront: 0, monthly: 100 }));
line("$1 000 upfront + $100/month", run({ upfront: 1_000, monthly: 100 }));

console.log("\n6) Walk-forward (calendar years, seeded by warm-up)");
const ev = evaluate(rows, lab, lab.config, annualFolds(lab.start, lab.end));
console.log(`  ${ev.folds_beating_hodl}/${ev.folds!.length} years beat HODL`);
for (const f of ev.folds!) console.log(`  ${f.fold.oosStart} → ${f.fold.oosEnd}  ${fmtX(f.nav_vs_hodl, 2).padStart(7)}  ${f.beat_hodl ? "✓" : ""}`);
console.log("");
