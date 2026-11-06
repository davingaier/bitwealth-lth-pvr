// tools/sth_cb_lab/oos_data.ts
// Publishes the out-of-sample (OOS) evidence for the STH Cost Basis Strategy to docs/sth_cb_oos_data.js (window.STHCB_OOS),
// read by website/sth-cb.html, website/index.html, docs/STH_CB_One_Pager.html and the v2.2 fact sheet so that every
// public figure can be shown side by side with its honest out-of-sample counterpart.
//
//   deno run -A tools/sth_cb_lab/oos_data.ts --forward results/<fit 2015-2019>.csv --reverse results/<fit 2020-2026>.csv
//
// Inputs are the two optimize.ts result files produced with `--idea oos` on the two halves of history (see README
// "True out-of-sample test"). For each split the training winners (rule A = best in-sample NAV÷HODL) are scored on the
// window they never saw. The forward split's #1 config is also run on the website's deposit plan ($2,400 + $200/month,
// 1/3/5-year windows ending at the latest close — all inside the 2020–2026 test window) for a like-for-like comparison.

import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { DEFAULT_STH_CB_CONFIG, SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { HYBRID_V2_2 } from "./factsheet_data_configs.ts";
import { annualFolds, evaluate, labArgsFrom, loadSeries, parseArgs, REPO_ROOT, simParams } from "./lab_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const END = series.to;
const TOP = Number(args.top ?? 20);
if (!args.forward || !args.reverse) { console.error("--forward <csv> and --reverse <csv> required"); Deno.exit(1); }

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let cur: string[] = []; let field = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { cur.push(field); field = ""; }
    else if (ch === "\n") { cur.push(field.replace(/\r$/, "")); rows.push(cur); cur = []; field = ""; }
    else field += ch;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  const [hdr, ...body] = rows;
  return body.filter((r) => r.length === hdr.length).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i]])));
}
const full = (c: Record<string, unknown>) => ({ ...DEFAULT_STH_CB_CONFIG, ...c }) as SthCbConfig;
const V22 = full(HYBRID_V2_2);
const CHARTINSPECT = full({ capBuyRatio: 0.70, capExitRatio: 1.00, trendEnterRatio: 1.05, trendExitRatio: 0.95, momoEnabled: false });
const r1 = (v: number) => +v.toFixed(1), r2 = (v: number) => +v.toFixed(2), r0 = (v: number) => +v.toFixed(0);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function scoreWindow(start: string, end: string, upfront: number, monthly: number, config: SthCbConfig) {
  const lab = labArgsFrom({ start, end, upfront: String(upfront), monthly: String(monthly) }, series.to);
  const data = series.rows.filter((r) => r.close_date <= end);
  const sim = simulateSthCb(data, simParams(lab, config), { ledger: false, daily: true });
  const s = sim.summary.sth_cb, h = sim.summary.hodl!, std = sim.stdBalances[sim.stdBalances.length - 1];
  const folds = annualFolds(start, end);
  const wf = evaluate(data, lab, config, folds);
  const rawDd = (navs: number[]) => { let pk = 0, dd = 0; for (const v of navs) { if (v > pk) pk = v; if (pk > 0) dd = Math.min(dd, v / pk - 1); } return r1(-dd * 100); };
  return {
    final_nav: r0(s.final_nav_usd), x_hodl: r2(s.nav_vs_hodl), cagr_pct: r1(s.final_cagr_percent), max_dd_pct: r1(s.max_drawdown * 100),
    raw_dd_pct: rawDd(sim.results.map((d) => d.nav_usd)), trades: s.trades, pct_in_market: r0(s.pct_time_in_market),
    wf_beat: wf.folds_beating_hodl!, wf_total: folds.length,
    hodl: { final_nav: r0(h.final_nav_usd), cagr_pct: r1(h.final_cagr_percent), raw_dd_pct: rawDd(sim.hodlBalances.map((b) => b.nav_usd)) },
    std_dca: { final_nav: r0(std.nav_usd), cagr_pct: r1(std.cagr_percent), raw_dd_pct: rawDd(sim.stdBalances.map((b) => b.nav_usd)) },
    invested: r0(s.total_contrib_gross_usdt),
  };
}

interface Split { key: string; label: string; csv: string; train: [string, string]; test: [string, string] }
const SPLITS: Split[] = [
  { key: "forward", label: "Fitted on 2015–2019, tested on 2020–2026", csv: String(args.forward), train: ["2015-01-04", "2019-12-31"], test: ["2020-01-01", END] },
  { key: "reverse", label: "Fitted on 2020–2026, tested on 2015–2019", csv: String(args.reverse), train: ["2020-01-01", END], test: ["2015-01-04", "2019-12-31"] },
];
const UPFRONT = 1000;
const splits: Record<string, unknown> = {};
let forwardTop1: SthCbConfig | null = null;
for (const sp of SPLITS) {
  const rows = parseCsv(await Deno.readTextFile(sp.csv)).sort((a, b) => Number(b.score) - Number(a.score));
  const top = rows.slice(0, TOP).map((r) => ({ train_x: r2(Number(r.nav_vs_hodl)), config: full(JSON.parse(r.config)) }));
  const scored = top.map((t) => ({ train_x: t.train_x, test: scoreWindow(sp.test[0], sp.test[1], UPFRONT, 0, t.config) }));
  if (sp.key === "forward") forwardTop1 = top[0].config;
  const xs = scored.map((s) => s.test.x_hodl);
  splits[sp.key] = {
    label: sp.label, train: { start: sp.train[0], end: sp.train[1], configs_evaluated: rows.length, best_in_sample_x: top[0].train_x },
    test: { start: sp.test[0], end: sp.test[1] },
    top1: scored[0].test,
    top_n: { n: scored.length, median_x: r2(med(xs)), min_x: r2(Math.min(...xs)), max_x: r2(Math.max(...xs)), beat_hodl: xs.filter((x) => x > 1).length, median_cagr: r1(med(scored.map((s) => s.test.cagr_pct))), median_dd: r1(med(scored.map((s) => s.test.max_dd_pct))) },
    chartinspect: scoreWindow(sp.test[0], sp.test[1], UPFRONT, 0, CHARTINSPECT),
    production_v22_in_sample: scoreWindow(sp.test[0], sp.test[1], UPFRONT, 0, V22),
  };
  console.log(`${sp.key}: in-sample ${top[0].train_x}× → OOS #1 ${scored[0].test.x_hodl}× (median ${r2(med(xs))}×, ${xs.filter((x) => x > 1).length}/${xs.length} > HODL) · ChartInspect ${(splits[sp.key] as { chartinspect: { x_hodl: number } }).chartinspect.x_hodl}× · v2.2 ${(splits[sp.key] as { production_v22_in_sample: { x_hodl: number } }).production_v22_in_sample.x_hodl}×`);
}

// Full-history in-sample headline ($1k 2017 → END) for the side-by-side strip.
const headline = scoreWindow("2017-01-01", END, 1000, 0, V22);

// Website deposit plan, windows inside the forward test period: OOS #1 config vs production v2.2 (in-sample) vs benchmarks.
const shiftYears = (iso: string, y: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };
const plan = [1, 3, 5].map((y) => {
  const start = shiftYears(END, y);
  return { years: y, start, end: END, oos: scoreWindow(start, END, 2400, 200, forwardTop1!), in_sample: scoreWindow(start, END, 2400, 200, V22) };
});
for (const p of plan) console.log(`plan ${p.years}y: OOS $${p.oos.final_nav} vs in-sample $${p.in_sample.final_nav} vs DCA $${p.oos.std_dca.final_nav} vs HODL $${p.oos.hodl.final_nav}`);

const out = {
  generated_at: new Date().toISOString().slice(0, 10),
  data_end: END,
  method: "Parameters are fitted on one half of history (random search over the full strategy design space, 30 000 configurations + hill-climb, objective NAV ÷ HODL) and the winners are then run, untouched, on the other half. 'In-sample' = fitted on 2017–2026 and judged on 2017–2026. All figures after the full BitWealth fee stack, next-day fills, USDPC yield on.",
  headline_in_sample: { start: "2017-01-01", end: END, upfront: 1000, ...headline },
  splits,
  plan_basis: { upfront: 2400, monthly: 200, end: END },
  plan,
  oos_config_note: "The forward out-of-sample configuration independently re-selected the same momentum-gated scale-out ladder as the production strategy (+0.5σ 50 % → +1σ 20 % → +1.5σ 10 % → +2.5σ exit); the entry/exit thresholds differ.",
};
const OUT_DIR = Deno.env.get("STHCB_OUT_DIR");  // set to stage a review copy; unset = publish to docs/ + website/js/
const file = OUT_DIR ? `${OUT_DIR}sth_cb_oos_data.js` : `${REPO_ROOT}docs/sth_cb_oos_data.js`;
const js = `// Generated by tools/sth_cb_lab/oos_data.ts on ${out.generated_at} — do not edit\nwindow.STHCB_OOS = ${JSON.stringify(out)};\n`;
await Deno.writeTextFile(file, js);
if (!OUT_DIR) await Deno.writeTextFile(`${REPO_ROOT}website/js/sth_cb_oos_data.js`, js); // the website is deployed from website/ only
console.log(`wrote ${file} (+ website/js/sth_cb_oos_data.js)`);
