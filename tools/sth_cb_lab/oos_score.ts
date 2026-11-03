// tools/sth_cb_lab/oos_score.ts
// True out-of-sample scoring for the STH_CB strategy.
//
//   deno run -A tools/sth_cb_lab/oos_score.ts --csv results/<optimize output>.csv [--test-start 2020-01-01] [--test-end 2026-11-02] [--upfront 105000] [--top 20]
//
// Reads the optimiser's CSV (fitted on a TRAINING window only), takes the top-N configs under several honest selection
// rules, and scores each on the TEST window it never saw. Reference rows: HODL, ChartInspect's original rules (never
// optimised by us) and the production Hybrid v2.2 (which WAS fitted on data that includes the test window).

import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { DEFAULT_STH_CB_CONFIG, SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { HYBRID_V2_2 } from "./factsheet_data_configs.ts";
import { annualFolds, evaluate, fmtUsd, labArgsFrom, loadSeries, parseArgs, simParams } from "./lab_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const testStart = String(args["test-start"] ?? "2020-01-01");
const testEnd = String(args["test-end"] ?? series.to);
const upfront = String(args.upfront ?? "105000");
const topN = Number(args.top ?? 20);
const csvPath = String(args.csv ?? "");
if (!csvPath) { console.error("--csv <optimizer output> required"); Deno.exit(1); }

// ── Parse the optimiser CSV (quoted JSON in the last column) ─────────────────
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
const rows = parseCsv(await Deno.readTextFile(csvPath));
const num = (v: string) => Number(v);
console.log(`Loaded ${rows.length} training results from ${csvPath}`);

// ── Scoring on the test window ───────────────────────────────────────────────
const lab = labArgsFrom({ start: testStart, end: testEnd, upfront, monthly: "0" }, series.to);
const data = series.rows.filter((r) => r.close_date <= testEnd);
const folds = annualFolds(testStart, testEnd);
function score(config: SthCbConfig) {
  const s = simulateSthCb(data, simParams(lab, config), { ledger: false, daily: false }).summary.sth_cb;
  const wf = evaluate(data, lab, config, folds);
  return { nav: s.final_nav_usd, x: s.nav_vs_hodl, cagr: s.final_cagr_percent, dd: s.max_drawdown * 100, trades: s.trades, wf: `${wf.folds_beating_hodl}/${folds.length}` };
}
// Partial configs must be merged over the engine defaults (momoEnabled etc.), exactly as run.ts / labArgsFrom do.
const full = (c: Record<string, unknown>) => ({ ...DEFAULT_STH_CB_CONFIG, ...c }) as SthCbConfig;
const V22 = full(HYBRID_V2_2);
const hodlNav = simulateSthCb(data, simParams(lab, V22), { ledger: false, daily: false }).summary.hodl!.final_nav_usd;
const line = (label: string, train: string, r: ReturnType<typeof score>) =>
  console.log(`  ${label.padEnd(44)} ${train.padStart(10)}   ${fmtUsd(r.nav).padStart(13)} ${(r.x.toFixed(2) + "×").padStart(8)} ${(r.cagr.toFixed(1) + "%").padStart(8)} ${(r.dd.toFixed(0) + "%").padStart(6)} ${String(r.trades).padStart(6)}  ${r.wf}`);

console.log(`\nTEST window ${testStart} → ${testEnd} · $${upfront} lump · next-day fills · full fees · HODL ${fmtUsd(hodlNav)}`);
console.log(`  ${"config".padEnd(44)} ${"train×HODL".padStart(10)}   ${"test NAV".padStart(13)} ${"×HODL".padStart(8)} ${"CAGR".padStart(8)} ${"DD".padStart(6)} ${"trades".padStart(6)}  WF`);

// References
line("ChartInspect original (never optimised)", "—", score(full({ capBuyRatio: 0.70, capExitRatio: 1.00, trendEnterRatio: 1.05, trendExitRatio: 0.95, momoEnabled: false })));
line("Hybrid v2.2 (fitted INCLUDING the test window)", "—", score(V22));

// Selection rules on the training results
const byScore = [...rows].sort((a, b) => num(b.score) - num(a.score));
const wfRows = rows.filter((r) => r.folds_beating_hodl !== "");
const byWf = [...wfRows].sort((a, b) => (num(b.folds_beating_hodl) - num(a.folds_beating_hodl)) || (num(b.score) - num(a.score)));
const byCalmar = [...rows].sort((a, b) => num(b.calmar) - num(a.calmar));

console.log(`\nA) Top ${topN} by in-sample NAV÷HODL on the training window:`);
const results: { rule: string; rank: number; train: number; test: ReturnType<typeof score> }[] = [];
for (let i = 0; i < Math.min(topN, byScore.length); i++) {
  const r = byScore[i]; const t = score(full(JSON.parse(r.config)));
  results.push({ rule: "A", rank: i + 1, train: num(r.nav_vs_hodl), test: t });
  line(`A#${i + 1} ${r.diff.slice(0, 40)}`, num(r.nav_vs_hodl).toFixed(2) + "×", t);
}
console.log(`\nB) Top ${Math.min(10, byWf.length)} by training walk-forward (years beating HODL), then NAV÷HODL:`);
for (let i = 0; i < Math.min(10, byWf.length); i++) {
  const r = byWf[i]; const t = score(full(JSON.parse(r.config)));
  results.push({ rule: "B", rank: i + 1, train: num(r.nav_vs_hodl), test: t });
  line(`B#${i + 1} WF ${r.folds_beating_hodl}/${r.folds_total} ${r.diff.slice(0, 32)}`, num(r.nav_vs_hodl).toFixed(2) + "×", t);
}
console.log(`\nC) Top 10 by training Calmar (return ÷ drawdown):`);
for (let i = 0; i < Math.min(10, byCalmar.length); i++) {
  const r = byCalmar[i]; const t = score(full(JSON.parse(r.config)));
  results.push({ rule: "C", rank: i + 1, train: num(r.nav_vs_hodl), test: t });
  line(`C#${i + 1} ${r.diff.slice(0, 40)}`, num(r.nav_vs_hodl).toFixed(2) + "×", t);
}

const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const summarise = (rule: string) => { const xs = results.filter((r) => r.rule === rule).map((r) => r.test.x); return `median ${med(xs).toFixed(2)}× · min ${Math.min(...xs).toFixed(2)}× · max ${Math.max(...xs).toFixed(2)}× · ${xs.filter((x) => x > 1).length}/${xs.length} beat HODL`; };
console.log(`\nOut-of-sample summary (test ×HODL):`);
console.log(`  A (in-sample best):      ${summarise("A")}`);
console.log(`  B (walk-forward best):   ${summarise("B")}`);
console.log(`  C (Calmar best):         ${summarise("C")}`);
console.log(`  #1 by rule A → ${JSON.stringify(JSON.parse(byScore[0].config))}`);
