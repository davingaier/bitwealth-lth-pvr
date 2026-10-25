// tools/sth_cb_lab/lth_optimize.ts
// Optimise the LTH PVR engine (B1–B11, momentum, bear-pause/retrace) on
// "sth_cb" bands (mean = STH cost basis, ±σ bands) using all CPU cores.
//
//   deno run -A tools/sth_cb_lab/lth_optimize.ts --start 2017-01-01 --end 2026-10-23 --upfront 1000 --monthly 0
//
// Search:
//   Phase 1  random sampling of the whole gene space           (--samples, default 6000)
//   Phase 2  coordinate-descent hill-climb from the top K       (--climb, default 8; --passes 4)
//   Phase 3  walk-forward scoring of the top M distinct configs (--wf-top, default 80)
// Selection: "robust" = most calendar years beating HODL, then ROI; "max" = highest ROI.
//
// Other flags: --objective roi|nav_vs_hodl|cagr|sharpe|calmar  --seed N  --workers N
//              --fees full|exchange_only --trade-bps --contrib-bps --same-day(not applicable: LTH engine fills at signal close)
//              --seedgenes '{...}' (extra starting point for the climb)  --lock '{"bandSpec":"sth_pvr:1"}' (fix genes)
//              --target 200000 (ROI % to flag)

import { fmtPct, fmtUsd, fmtX, labArgsFrom, loadSeries, parseArgs, RESULTS_DIR, timestamp, toCsv } from "./lab_core.ts";
import { candidateFromGenes, describe, Gene, GENE_NAMES, GENES, LthMetrics, PROD_GENES, rng, structuredSeeds } from "./lth_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab = labArgsFrom(args, series.to);
const samples = Number(args.samples ?? 6000);
const climbK = Number(args.climb ?? 8);
const passes = Number(args.passes ?? 4);
const wfTop = Number(args["wf-top"] ?? 80);
const seed = Number(args.seed ?? 7);
const target = Number(args.target ?? 200_000);
const objective = String(args.objective ?? "roi");
const workersN = Math.max(1, Number(args.workers ?? navigator.hardwareConcurrency ?? 4));
const lock: Record<string, unknown> = typeof args.lock === "string" ? JSON.parse(args.lock) : {};
const seedGenes: Record<string, unknown> | null = typeof args.seedgenes === "string" ? JSON.parse(args.seedgenes) : null;

type Row = { genes: Record<string, unknown>; metrics: LthMetrics; folds?: unknown[]; folds_beating_hodl?: number; error?: string };
const score = (m: LthMetrics) => {
  switch (objective) {
    case "nav_vs_hodl": return m.nav_vs_hodl;
    case "cagr": return m.final_cagr_percent;
    case "sharpe": return m.sharpe_ratio;
    case "calmar": return m.max_drawdown_percent > 0 ? m.final_cagr_percent / m.max_drawdown_percent : 0;
    default: return m.final_roi_percent;
  }
};
const key = (g: Record<string, unknown>) => JSON.stringify(GENE_NAMES.map((k) => g[k]));
const freeGenes = GENE_NAMES.filter((g) => !(g in lock));

console.log(`LTH PVR × sth_cb bands optimiser · ${lab.start} → ${lab.end} · $${lab.upfront} + $${lab.monthly}/mo · fees=${lab.fees} · objective=${objective} · ${workersN} workers`);
if (Object.keys(lock).length) console.log(`Locked genes: ${JSON.stringify(lock)}`);

// ── Workers ─────────────────────────────────────────────────────────────────
const workers: Worker[] = [];
await Promise.all(Array.from({ length: workersN }, () => new Promise<void>((res) => {
  const w = new Worker(new URL("./lth_worker.ts", import.meta.url).href, { type: "module" });
  workers.push(w);
  const h = (ev: MessageEvent) => { if (ev.data?.type === "ready") { w.removeEventListener("message", h); res(); } };
  w.addEventListener("message", h);
  w.postMessage({ type: "init", lab });
})));

let msgId = 0;
const pending = new Map<number, (r: Row[]) => void>();
for (const w of workers) {
  w.addEventListener("message", (ev: MessageEvent) => {
    if (ev.data?.type !== "result") return;
    const cb = pending.get(ev.data.id);
    pending.delete(ev.data.id);
    cb?.(ev.data.results as Row[]);
  });
}
let rr = 0;
const evalBatch = (genes: Record<string, unknown>[], walkForward = false): Promise<Row[]> =>
  new Promise((res) => {
    const id = msgId++;
    pending.set(id, res);
    workers[rr++ % workers.length].postMessage({ type: "eval", id, genes, walkForward });
  });

async function evalAll(list: Record<string, unknown>[], walkForward: boolean, label: string): Promise<Row[]> {
  const batch = Math.max(1, Math.min(walkForward ? 2 : 10, Math.ceil(list.length / (workersN * 6))));
  const chunks: Record<string, unknown>[][] = [];
  for (let i = 0; i < list.length; i += batch) chunks.push(list.slice(i, i + batch));
  const out: Row[] = [];
  let done = 0;
  const t0 = performance.now();
  // keep every worker busy: up to 2 outstanding batches per worker
  let next = 0;
  const runOne = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      const r = await evalBatch(c, walkForward);
      out.push(...r.filter((x) => !x.error));
      done += c.length;
      const rate = done / ((performance.now() - t0) / 1000);
      Deno.stdout.writeSync(new TextEncoder().encode(`\r  ${label}: ${done}/${list.length} · ${rate.toFixed(1)} evals/s     `));
    }
  };
  await Promise.all(Array.from({ length: workersN * 2 }, runOne));
  console.log("");
  return out;
}

// ── Phase 1: random sampling ───────────────────────────────────────────────
const rnd = rng(seed);
const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const randomGenes = (): Record<string, unknown> => {
  const g: Record<string, unknown> = {};
  for (const k of GENE_NAMES) g[k] = k in lock ? lock[k] : pick(GENES[k] as unknown[]);
  return g;
};
// Monotone-ish priors: buy sizes non-increasing B1≥…≥B5 and sell sizes non-decreasing B6≤…≤B11 are
// what LTH PVR assumes; enforce in 70 % of samples to focus the search, leave 30 % free.
const shape = (g: Record<string, unknown>) => {
  if (rnd() < 0.3) return g;
  const buys = (["B1", "B2", "B3", "B4", "B5"] as Gene[]).filter((k) => !(k in lock)).map((k) => g[k] as number).sort((a, b) => b - a);
  const sells = (["B6", "B7", "B8", "B9", "B10", "B11"] as Gene[]).filter((k) => !(k in lock)).map((k) => g[k] as number).sort((a, b) => a - b);
  let bi = 0, si = 0;
  for (const k of ["B1", "B2", "B3", "B4", "B5"] as Gene[]) if (!(k in lock)) g[k] = buys[bi++];
  for (const k of ["B6", "B7", "B8", "B9", "B10", "B11"] as Gene[]) if (!(k in lock)) g[k] = sells[si++];
  return g;
};
const seen = new Set<string>();
const phase1: Record<string, unknown>[] = [{ ...PROD_GENES, ...lock }];
if (seedGenes) phase1.push({ ...PROD_GENES, ...seedGenes, ...lock });
for (const g of phase1) seen.add(key(g));
// Structured seeds (lump-sum shapes) first, then random fill
if (args["no-structured"] !== true) {
  for (const g0 of structuredSeeds()) {
    const g = { ...g0, ...lock };
    const k = key(g);
    if (seen.has(k)) continue;
    seen.add(k);
    phase1.push(g);
  }
}
while (phase1.length < samples) {
  const g = shape(randomGenes());
  const k = key(g);
  if (seen.has(k)) continue;
  seen.add(k);
  phase1.push(g);
}
console.log(`\nPhase 1 — random sampling (${phase1.length} configs)`);
const all = new Map<string, Row>();
for (const r of await evalAll(phase1, false, "random")) all.set(key(r.genes), r);
const ranked = () => [...all.values()].sort((a, b) => score(b.metrics) - score(a.metrics));
{
  const top = ranked().slice(0, 5);
  console.log(`  best so far: ROI ${fmtPct(top[0].metrics.final_roi_percent, 0)} (${fmtX(top[0].metrics.nav_vs_hodl, 2)} HODL) — ${describe(candidateFromGenes(top[0].genes))}`);
}

// ── Phase 2: coordinate descent from the top K ─────────────────────────────
console.log(`\nPhase 2 — coordinate descent from top ${climbK} (${passes} passes max)`);
const starts = ranked().slice(0, climbK).map((r) => r.genes);
for (let si = 0; si < starts.length; si++) {
  let cur = { ...starts[si] };
  let curScore = score(all.get(key(cur))!.metrics);
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    const order = [...freeGenes].sort(() => rnd() - 0.5);
    for (const gene of order) {
      const cands = (GENES[gene] as unknown[]).filter((v) => v !== cur[gene]).map((v) => ({ ...cur, [gene]: v }));
      const fresh = cands.filter((g) => !all.has(key(g)));
      if (fresh.length) for (const r of await evalAll(fresh, false, `climb ${si + 1}/${starts.length} pass ${pass + 1} ${gene}`)) all.set(key(r.genes), r);
      let best = cur, bestScore = curScore;
      for (const g of cands) { const r = all.get(key(g)); if (r && score(r.metrics) > bestScore) { best = g; bestScore = score(r.metrics); } }
      if (bestScore > curScore) { cur = best; curScore = bestScore; improved = true; }
    }
    console.log(`  start ${si + 1} pass ${pass + 1}: ROI ${fmtPct(all.get(key(cur))!.metrics.final_roi_percent, 0)} (${fmtX(all.get(key(cur))!.metrics.nav_vs_hodl, 2)} HODL)`);
    if (!improved) break;
  }
}

// ── Phase 3: walk-forward on the top M ─────────────────────────────────────
console.log(`\nPhase 3 — walk-forward on top ${wfTop}`);
const wfList = ranked().slice(0, wfTop).map((r) => r.genes);
const wfRows = await evalAll(wfList, true, "walk-forward");
for (const r of wfRows) all.set(key(r.genes), r);
const foldsTotal = (wfRows[0]?.folds as unknown[] | undefined)?.length ?? 0;

// ── Output ─────────────────────────────────────────────────────────────────
const everything = ranked();
const csv = everything.map((r) => ({
  roi_pct: r.metrics.final_roi_percent,
  final_nav: r.metrics.final_nav_usd,
  nav_vs_hodl: r.metrics.nav_vs_hodl,
  cagr_pct: r.metrics.final_cagr_percent,
  max_dd_pct: r.metrics.max_drawdown_percent,
  sharpe: r.metrics.sharpe_ratio,
  trades: r.metrics.trades,
  pct_invested: r.metrics.pct_time_invested,
  wf_years_beat_hodl: r.folds_beating_hodl ?? "",
  wf_years_total: r.folds_beating_hodl !== undefined ? foldsTotal : "",
  describe: describe(candidateFromGenes(r.genes)),
  genes: r.genes,
}));
await Deno.mkdir(RESULTS_DIR, { recursive: true });
const out = `${RESULTS_DIR}${timestamp()}_lth_sthcb_${objective}.csv`;
await Deno.writeTextFile(out, toCsv(csv));

const withWf = everything.filter((r) => r.folds_beating_hodl !== undefined);
const robust = [...withWf].sort((a, b) => (b.folds_beating_hodl! - a.folds_beating_hodl!) || (score(b.metrics) - score(a.metrics)))[0];
const robustHit = [...withWf].filter((r) => r.metrics.final_roi_percent >= target).sort((a, b) => (b.folds_beating_hodl! - a.folds_beating_hodl!) || (score(b.metrics) - score(a.metrics)))[0];
const max = everything[0];
const baseline = all.get(key({ ...PROD_GENES, ...lock }));

const show = (title: string, r: Row | undefined) => {
  if (!r) { console.log(`\n${title}: none`); return; }
  const m = r.metrics;
  console.log(`\n${title}`);
  console.log(`  ROI ${fmtPct(m.final_roi_percent, 0)} · NAV ${fmtUsd(m.final_nav_usd)} · ${fmtX(m.nav_vs_hodl, 2)} HODL · CAGR ${fmtPct(m.final_cagr_percent, 1)} · MaxDD ${fmtPct(m.max_drawdown_percent, 0)} · Sharpe ${m.sharpe_ratio.toFixed(2)} · ${m.trades} trades · ${m.pct_time_invested}% invested${r.folds_beating_hodl !== undefined ? ` · WF ${r.folds_beating_hodl}/${foldsTotal}` : ""}`);
  console.log(`  ${describe(candidateFromGenes(r.genes))}`);
  console.log(`  genes: ${JSON.stringify(r.genes)}`);
};
console.log(`\n${"═".repeat(100)}`);
console.log(`Evaluated ${everything.length} configs · HODL ${fmtUsd(max.metrics.hodl_final_nav_usd)} (${fmtPct(max.metrics.hodl_final_nav_usd / lab.upfront * 100 - 100, 0)}) · target ROI ${target.toLocaleString()}%`);
show("BASELINE (production LTH PVR params on sth_pvr:auto bands)", baseline);
show(`MAX in-sample ${objective}`, max);
show(`MOST ROBUST (most calendar years beating HODL, then ${objective})`, robust);
show(`MOST ROBUST that also clears ${target.toLocaleString()}% ROI`, robustHit);
console.log(`\nTop 15 by walk-forward years, then ${objective}:`);
console.log("   WF    ROI          ×HODL  MaxDD   Trades  config");
for (const r of [...withWf].sort((a, b) => (b.folds_beating_hodl! - a.folds_beating_hodl!) || (score(b.metrics) - score(a.metrics))).slice(0, 15)) {
  console.log(`  ${String(r.folds_beating_hodl).padStart(2)}/${foldsTotal}  ${fmtPct(r.metrics.final_roi_percent, 0).padStart(10)}  ${fmtX(r.metrics.nav_vs_hodl, 2).padStart(6)}  ${fmtPct(r.metrics.max_drawdown_percent, 0).padStart(5)}  ${String(r.metrics.trades).padStart(6)}  ${describe(candidateFromGenes(r.genes))}`);
}
console.log(`\nAll results → ${out}`);
for (const w of workers) w.terminate();
