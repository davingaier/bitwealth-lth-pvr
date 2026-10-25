// tools/sth_cb_lab/optimize.ts
// Parallel parameter search for the STH_CB strategy using all CPU cores.
//
//   deno run -A tools/sth_cb_lab/optimize.ts --idea 1
//   deno run -A tools/sth_cb_lab/optimize.ts --idea base --objective calmar --walk-forward
//   deno run -A tools/sth_cb_lab/optimize.ts --idea all --mode random --samples 5000
//   deno run -A tools/sth_cb_lab/optimize.ts --grid '{"trendExitRatio":[0.9,0.93,0.95],"momoLength":[3,5,8]}'
//
// Common flags: --start --end --upfront --monthly --fees full|exchange_only --same-day
//               --objective nav_vs_hodl|calmar|cagr|sharpe|final_nav|nav_vs_std_dca
//               --walk-forward (also score per calendar year; adds folds_beating_hodl)
//               --workers N (default: CPU cores) --top N (default 20) --samples N --mode grid|random|auto
//               --base '{...}' (override the base config every combo is merged onto)
//
// Output: results/<timestamp>_<idea>.csv (every evaluated combo) + top-N table on stdout.

import { DEFAULT_STH_CB_CONFIG, SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { cleanCombo, enumerateGrid, gridSize, IDEAS, sampleGrid } from "./ideas.ts";
import {
  annualFolds, configDiff, EvalResult, fmtPct, fmtUsd, fmtX, labArgsFrom, loadSeries,
  Objective, OBJECTIVES, objectiveValue, parseArgs, RESULTS_DIR, timestamp, toCsv,
} from "./lab_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab = labArgsFrom(args, series.to);
const objective = (OBJECTIVES.includes(args.objective as Objective) ? args.objective : "nav_vs_hodl") as Objective;
const topN = Number(args.top ?? 20);
const samples = Number(args.samples ?? 2000);
const mode = String(args.mode ?? "auto");
const walkForward = args["walk-forward"] === true;
const workersN = Math.max(1, Number(args.workers ?? navigator.hardwareConcurrency ?? 4));

// ── Build the candidate list ─────────────────────────────────────────────────
let ideaKey = String(args.idea ?? "base");
let grid: Record<string, unknown[]>;
if (typeof args.grid === "string") { grid = JSON.parse(args.grid); ideaKey = "custom"; }
else {
  const spec = IDEAS[ideaKey];
  if (!spec) { console.error(`Unknown idea '${ideaKey}'. Options: ${Object.keys(IDEAS).join(", ")}`); Deno.exit(1); }
  grid = spec.grid;
  console.log(`Idea ${ideaKey}: ${spec.title} — ${spec.description}`);
}
const baseCfg: SthCbConfig = { ...lab.config, ...(typeof args.base === "string" ? JSON.parse(args.base) : {}) };
const size = gridSize(grid);
const useRandom = mode === "random" || (mode === "auto" && size > samples);
const combos = useRandom ? sampleGrid(grid, samples) : [...enumerateGrid(grid)];
const configs: SthCbConfig[] = combos.map((c) => ({ ...baseCfg, ...cleanCombo(c) } as SthCbConfig));
console.log(`Grid size ${size.toLocaleString()} → evaluating ${configs.length.toLocaleString()} configs (${useRandom ? "random sample" : "full grid"}) on ${workersN} workers`);
console.log(`Window ${lab.start} → ${lab.end} · $${lab.upfront} + $${lab.monthly}/mo · fees=${lab.fees} · ${lab.sameDay ? "same-day" : "next-day"} fills · objective=${objective}${walkForward ? " · walk-forward" : ""}`);

const folds = walkForward ? annualFolds(lab.start, lab.end) : undefined;

// ── Workers ─────────────────────────────────────────────────────────────────
const workers: Worker[] = [];
const ready: Promise<void>[] = [];
for (let i = 0; i < workersN; i++) {
  const w = new Worker(new URL("./worker.ts", import.meta.url).href, { type: "module" });
  workers.push(w);
  ready.push(new Promise<void>((res) => {
    const h = (ev: MessageEvent) => { if (ev.data?.type === "ready") { w.removeEventListener("message", h); res(); } };
    w.addEventListener("message", h);
  }));
  w.postMessage({ type: "init", lab, folds });
}
await Promise.all(ready);

const batchSize = Math.max(1, Math.min(50, Math.ceil(configs.length / (workersN * 8))));
const batches: SthCbConfig[][] = [];
for (let i = 0; i < configs.length; i += batchSize) batches.push(configs.slice(i, i + batchSize));

const results: EvalResult[] = [];
let done = 0;
const t0 = performance.now();
let nextBatch = 0;

await new Promise<void>((resolve) => {
  const dispatch = (w: Worker) => {
    if (nextBatch >= batches.length) return false;
    const id = nextBatch++;
    w.postMessage({ type: "eval", id, configs: batches[id] });
    return true;
  };
  for (const w of workers) {
    w.addEventListener("message", (ev: MessageEvent) => {
      if (ev.data?.type !== "result") return;
      for (const r of ev.data.results) {
        if (r.error) console.warn("eval error:", r.error, configDiff(r.config, baseCfg));
        else results.push(r as EvalResult);
      }
      done += ev.data.results.length;
      const pct = (done / configs.length * 100).toFixed(0);
      const rate = done / ((performance.now() - t0) / 1000);
      Deno.stdout.writeSync(new TextEncoder().encode(`\r  ${done}/${configs.length} (${pct}%) · ${rate.toFixed(0)} evals/s   `));
      if (!dispatch(w) && done >= configs.length) resolve();
    });
    dispatch(w);
  }
});
for (const w of workers) w.terminate();
console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// ── Rank + output ───────────────────────────────────────────────────────────
const score = (r: EvalResult) => {
  const v = objectiveValue(r.metrics, objective);
  return Number.isFinite(v) ? v : -Infinity;
};
results.sort((a, b) => {
  // With walk-forward on, prefer configs that beat HODL in more years, then by objective
  if (walkForward && (a.folds_beating_hodl ?? 0) !== (b.folds_beating_hodl ?? 0)) return (b.folds_beating_hodl ?? 0) - (a.folds_beating_hodl ?? 0);
  return score(b) - score(a);
});

const baseline = results.find((r) => configDiff(r.config, baseCfg) === "(defaults)");
const csvRows = results.map((r) => ({
  score: score(r),
  objective,
  folds_beating_hodl: r.folds_beating_hodl ?? "",
  folds_total: folds?.length ?? "",
  final_nav: r.metrics.final_nav_usd,
  nav_vs_hodl: r.metrics.nav_vs_hodl,
  nav_vs_std_dca: r.metrics.nav_vs_std_dca,
  cagr_pct: r.metrics.final_cagr_percent,
  max_dd_pct: r.metrics.max_drawdown * 100,
  calmar: r.metrics.calmar,
  sharpe: r.metrics.sharpe,
  trades: r.metrics.trades,
  pct_in_market: r.metrics.pct_time_in_market,
  diff: configDiff(r.config, baseCfg),
  config: r.config,
}));
await Deno.mkdir(RESULTS_DIR, { recursive: true });
const outFile = `${RESULTS_DIR}${timestamp()}_${ideaKey}_${objective}${walkForward ? "_wf" : ""}.csv`;
await Deno.writeTextFile(outFile, toCsv(csvRows));

console.log(`\nTop ${Math.min(topN, results.length)} by ${objective}${walkForward ? " (ranked first by years beating HODL)" : ""}:`);
const hdr = `  #   ${objective.padEnd(12)} NAV÷HODL  CAGR     MaxDD    Calmar Trades InMkt${walkForward ? "  WF" : ""}  config`;
console.log(hdr);
results.slice(0, topN).forEach((r, i) => {
  const m = r.metrics;
  console.log(
    `  ${String(i + 1).padStart(2)}  ${String(score(r).toFixed(3)).padEnd(12)} ${fmtX(m.nav_vs_hodl, 2).padStart(8)}  ${fmtPct(m.final_cagr_percent, 1).padStart(7)}  ${fmtPct(m.max_drawdown * 100, 0).padStart(6)}  ${m.calmar.toFixed(2).padStart(6)} ${String(m.trades).padStart(6)} ${String(m.pct_time_in_market.toFixed(0) + "%").padStart(5)}${walkForward ? `  ${r.folds_beating_hodl}/${folds!.length}` : ""}  ${configDiff(r.config, baseCfg)}`,
  );
});
if (baseline) {
  const m = baseline.metrics;
  console.log(`\nBaseline (defaults): ${objective}=${score(baseline).toFixed(3)} · NAV ${fmtUsd(m.final_nav_usd)} · NAV÷HODL ${fmtX(m.nav_vs_hodl, 2)} · CAGR ${fmtPct(m.final_cagr_percent, 1)} · MaxDD ${fmtPct(m.max_drawdown * 100, 0)} · ${m.trades} trades${walkForward ? ` · WF ${baseline.folds_beating_hodl}/${folds!.length}` : ""}`);
}
console.log(`\nAll ${results.length} results → ${outFile}`);
if (results[0]) {
  const d: Record<string, unknown> = {};
  for (const k of Object.keys(results[0].config) as (keyof SthCbConfig)[]) {
    if (JSON.stringify(results[0].config[k]) !== JSON.stringify(DEFAULT_STH_CB_CONFIG[k])) d[k] = results[0].config[k];
  }
  console.log(`\nTo reproduce #1 in the Admin UI, paste this into "Advanced (extras JSON)":`);
  console.log(`  ${JSON.stringify(d)}`);
  console.log(`and set the SAME window and contributions: Start ${lab.start}, End ${lab.end}, Upfront $${lab.upfront}, Monthly $${lab.monthly}, ${lab.sameDay ? "same-day" : "next-day"} fill.`);
  console.log(`(Different dates or amounts give a different NAV — compare NAV÷HODL and CAGR across windows, never raw NAV.)`);
}
