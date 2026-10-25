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
  w.postMessage({ type: "init", lab, folds: annualFolds(lab.start, lab.end) });
}
await Promise.all(ready);

// ── Generic parallel evaluator ─────────────────────────────────────────────
let msgId = 0;
const pendingCb = new Map<number, (r: EvalResult[]) => void>();
for (const w of workers) {
  w.addEventListener("message", (ev: MessageEvent) => {
    if (ev.data?.type !== "result") return;
    const cb = pendingCb.get(ev.data.id); pendingCb.delete(ev.data.id); cb?.(ev.data.results);
  });
}
let rr = 0;
const evalBatch = (cfgs: SthCbConfig[], wf: boolean): Promise<EvalResult[]> => new Promise((res) => {
  const id = msgId++; pendingCb.set(id, res);
  workers[rr++ % workers.length].postMessage({ type: "eval", id, configs: cfgs, walkForward: wf });
});
async function evalAll(list: SthCbConfig[], wf: boolean, label: string): Promise<EvalResult[]> {
  const batch = Math.max(1, Math.min(wf ? 5 : 50, Math.ceil(list.length / (workersN * 8))));
  const chunks: SthCbConfig[][] = [];
  for (let i = 0; i < list.length; i += batch) chunks.push(list.slice(i, i + batch));
  const out: EvalResult[] = [];
  let done = 0, next = 0;
  const t0 = performance.now();
  const runOne = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      const r = await evalBatch(c, wf);
      for (const x of r as (EvalResult & { error?: string })[]) { if (x.error) console.warn("eval error:", x.error); else out.push(x); }
      done += c.length;
      Deno.stdout.writeSync(new TextEncoder().encode(`\r  ${label}: ${done}/${list.length} · ${(done / ((performance.now() - t0) / 1000)).toFixed(0)} evals/s   `));
    }
  };
  await Promise.all(Array.from({ length: workersN * 2 }, runOne));
  console.log("");
  return out;
}

const cfgKey = (c: SthCbConfig) => JSON.stringify(c, Object.keys(c).sort());
const all = new Map<string, EvalResult>();
const score = (r: EvalResult) => {
  const v = objectiveValue(r.metrics, objective);
  return Number.isFinite(v) ? v : -Infinity;
};
const ranked = () => [...all.values()].sort((a, b) => score(b) - score(a));

// ── Phase 1: grid / random ─────────────────────────────────────────────────
const t0 = performance.now();
console.log(`\nPhase 1 — ${useRandom ? "random sample" : "full grid"} (${configs.length} configs)`);
for (const r of await evalAll(configs, false, "sample")) all.set(cfgKey(r.config), r);

// ── Phase 2: coordinate descent from the top K (over the grid's own value lists) ──
const climbK = Number(args.climb ?? 0);
const passes = Number(args.passes ?? 3);
if (climbK > 0) {
  console.log(`\nPhase 2 — coordinate descent from top ${climbK} (${passes} passes max)`);
  const keys = Object.keys(grid);
  const starts = ranked().slice(0, climbK).map((r) => r.config);
  for (let si = 0; si < starts.length; si++) {
    let cur = starts[si];
    let curScore = score(all.get(cfgKey(cur))!);
    for (let pass = 0; pass < passes; pass++) {
      let improved = false;
      for (const k of keys) {
        const cands = (grid[k] as unknown[]).map((v) => {
          const c = { ...cur } as Record<string, unknown>;
          if (v === null || typeof v === "undefined") delete c[k]; else c[k] = v;
          return c as unknown as SthCbConfig;
        }).filter((c) => cfgKey(c) !== cfgKey(cur));
        const fresh = cands.filter((c) => !all.has(cfgKey(c)));
        if (fresh.length) for (const r of await evalAll(fresh, false, `climb ${si + 1}/${starts.length} p${pass + 1} ${k}`)) all.set(cfgKey(r.config), r);
        for (const c of cands) { const r = all.get(cfgKey(c)); if (r && score(r) > curScore) { cur = c; curScore = score(r); improved = true; } }
      }
      console.log(`  start ${si + 1} pass ${pass + 1}: ${objective}=${curScore.toFixed(3)} NAV ${fmtUsd(all.get(cfgKey(cur))!.metrics.final_nav_usd)}`);
      if (!improved) break;
    }
  }
}

// ── Phase 3: walk-forward on the top M ─────────────────────────────────────
const wfTop = walkForward ? Number(args["wf-top"] ?? 100) : 0;
if (wfTop > 0) {
  console.log(`\nPhase 3 — walk-forward on top ${wfTop}`);
  const list = ranked().slice(0, wfTop).map((r) => r.config);
  for (const r of await evalAll(list, true, "walk-forward")) all.set(cfgKey(r.config), r);
}
for (const w of workers) w.terminate();
console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${all.size} configs evaluated`);

// ── Rank + output ───────────────────────────────────────────────────────────
const results = [...all.values()];
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
    `  ${String(i + 1).padStart(2)}  ${String(score(r).toFixed(3)).padEnd(12)} ${fmtX(m.nav_vs_hodl, 2).padStart(8)}  ${fmtPct(m.final_cagr_percent, 1).padStart(7)}  ${fmtPct(m.max_drawdown * 100, 0).padStart(6)}  ${m.calmar.toFixed(2).padStart(6)} ${String(m.trades).padStart(6)} ${String(m.pct_time_in_market.toFixed(0) + "%").padStart(5)}${walkForward ? `  ${r.folds_beating_hodl ?? "-"}/${folds!.length}` : ""}  ${configDiff(r.config, baseCfg)}`,
  );
});
if (baseline) {
  const m = baseline.metrics;
  console.log(`\nBaseline (defaults): ${objective}=${score(baseline).toFixed(3)} · NAV ${fmtUsd(m.final_nav_usd)} · NAV÷HODL ${fmtX(m.nav_vs_hodl, 2)} · CAGR ${fmtPct(m.final_cagr_percent, 1)} · MaxDD ${fmtPct(m.max_drawdown * 100, 0)} · ${m.trades} trades${walkForward ? ` · WF ${baseline.folds_beating_hodl ?? "-"}/${folds!.length}` : ""}`);
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
