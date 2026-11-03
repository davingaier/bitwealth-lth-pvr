// tools/sth_cb_lab/ladder_optimize.ts
// Optimise the v2 scale-out ladder: WHICH LTH PVR bands to sell at and HOW MUCH to sell at each.
//
//   deno run -A tools/sth_cb_lab/ladder_optimize.ts --base '{hybrid v2 json}' --walk-forward
//
// Phase 0  "small sells low down": take the base ladder as-is and add a 10 / 20 / 30 % sell at the LTH PVR
//          mean and/or +0.5σ band — answers "does trimming early make a material difference?".
// Phase 1  full enumeration of every ladder with allocations in 0.1 steps (1 dp), non-increasing from the mean
//          up to +2.5σ (alloc 1.0 at a band = no rung there), with the momentum gate on and off.
// Phase 2  (--climb K) coordinate descent over the re-buy / cooldown knobs for the top K ladders.
// Phase 3  (--walk-forward) per-year scoring of the top --wf-top ladders; ranking prefers years-beating-HODL.
//
// Flags: --levels 0,0.5,1,1.5,2,2.5   --step 0.1   --gate both|on|off   --objective final_nav|nav_vs_hodl|…
//        --climb K --passes N --wf-top M --top N --workers N  + the usual --start/--end/--upfront/--monthly

import { SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { createPool } from "./pool.ts";
import {
  annualFolds, configDiff, configKey, EvalResult, fmtPct, fmtUsd, fmtX, labArgsFrom, loadSeries,
  Objective, OBJECTIVES, objectiveValue, parseArgs, RESULTS_DIR, timestamp, toCsv,
} from "./lab_core.ts";

type Tier = { sigma?: number; cbRatio?: number; alloc: number };

const args = parseArgs(Deno.args);
const series = await loadSeries();
const lab = labArgsFrom(args, series.to);
const objective = (OBJECTIVES.includes(args.objective as Objective) ? args.objective : "final_nav") as Objective;
const topN = Number(args.top ?? 15);
const walkForward = args["walk-forward"] === true;
const workersN = Math.max(1, Number(args.workers ?? navigator.hardwareConcurrency ?? 4));
// --kind lth (default): rungs at LTH PVR σ bands.  --kind cb: rungs at multiples of the STH cost basis (e.g. 1.05 … 2.0).
const kind = String(args.kind ?? "lth") === "cb" ? "cb" : "lth";
const levels = String(args.levels ?? (kind === "cb" ? "1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.6,1.7,1.8,2" : "0,0.5,1,1.5,2,2.5")).split(",").map(Number);
const step = Number(args.step ?? 0.1);
const gateMode = String(args.gate ?? "both");
const maxRungs = Number(args["max-rungs"] ?? (kind === "cb" ? 4 : levels.length));
const samples = Number(args.samples ?? 6000);
const dp = Math.max(0, Math.round(-Math.log10(step)));
const r1 = (v: number) => Number(v.toFixed(dp));
const lvl = (t: Tier) => t.sigma ?? t.cbRatio ?? 0;
const mkTier = (level: number, alloc: number): Tier => kind === "cb" ? { cbRatio: level, alloc } : { sigma: level, alloc };

const baseCfg: SthCbConfig = { ...lab.config, ...(typeof args.base === "string" ? JSON.parse(args.base) : {}) };
if (!baseCfg.lthSellTiers?.length) { console.error("--base must contain lthSellTiers (use the Hybrid v2 JSON)"); Deno.exit(1); }
const baseLadder: Tier[] = [...baseCfg.lthSellTiers].sort((a, b) => lvl(a) - lvl(b));

const ladderTxt = (t: Tier[]) => t.map((x) => (typeof x.cbRatio === "number" ? `${Math.round(x.cbRatio * 100)}%CB` : `${(x.sigma ?? 0) >= 0 ? "+" : ""}${x.sigma}σ`) + `→${Math.round(x.alloc * 100)}%`).join(" ");
const withLadder = (tiers: Tier[], gate: boolean): SthCbConfig => {
  const c = { ...baseCfg, lthSellTiers: tiers, lthSellMomoGate: gate } as Record<string, unknown>;
  if (!tiers.length) delete c.lthSellTiers;
  return c as unknown as SthCbConfig;
};
const cfgKey = (c: SthCbConfig) => configKey(c);
const score = (r: EvalResult) => { const v = objectiveValue(r.metrics, objective); return Number.isFinite(v) ? v : -Infinity; };

console.log(`Ladder optimiser · window ${lab.start} → ${lab.end} · $${lab.upfront} + $${lab.monthly}/mo · fees=${lab.fees} · objective=${objective}`);
console.log(`Base ladder: ${ladderTxt(baseLadder)} · gate=${baseCfg.lthSellMomoGate ? "on" : "off"} · kind=${kind} · levels ${levels.join("/")} · step ${step} · max rungs ${maxRungs}`);

const pool = await createPool(lab, workersN);
const all = new Map<string, EvalResult>();
const remember = (rs: EvalResult[]) => { for (const r of rs) all.set(cfgKey(r.config), r); };

// ── Phase 0: small sells at the mean / +0.5σ on top of the base ladder (LTH kind only) ─────
const baseRes = (await pool.evalAll([baseCfg], false, "base"))[0];
remember([baseRes]);
if (kind === "lth") {
console.log("\nPhase 0 — add a small early sell to the base ladder");
const early: Array<{ label: string; tiers: Tier[] }> = [{ label: "base ladder (no early sell)", tiers: baseLadder }];
const lowBands = levels.filter((l) => l < Math.min(...baseLadder.map(lvl)));
for (const a of [0.9, 0.8, 0.7]) {
  for (const l of lowBands) early.push({ label: `+ ${l === 0 ? "mean" : "+" + l + "σ"} → ${Math.round(a * 100)} %`, tiers: [mkTier(l, a), ...baseLadder] });
  if (lowBands.length >= 2) {
    const [l1, l2] = lowBands;
    early.push({ label: `+ ${l1 === 0 ? "mean" : "+" + l1 + "σ"} → ${Math.round(a * 100)} % and +${l2}σ → ${Math.round((a - 0.1) * 100)} %`, tiers: [mkTier(l1, a), mkTier(l2, r1(a - 0.1)), ...baseLadder] });
  }
}
const earlyCfgs = early.slice(1).map((e) => withLadder(e.tiers, !!baseCfg.lthSellMomoGate));
remember(await pool.evalAll(earlyCfgs, false, "early sells"));
console.log(`  ${"variant".padEnd(42)} ${"NAV".padStart(12)} ${"Δ vs base".padStart(10)} ${"×HODL".padStart(7)} ${"MaxDD".padStart(6)} Trades`);
for (const e of early) {
  const r = all.get(cfgKey(withLadder(e.tiers, !!baseCfg.lthSellMomoGate)))!;
  const d = r.metrics.final_nav_usd / baseRes.metrics.final_nav_usd - 1;
  console.log(`  ${e.label.padEnd(42)} ${fmtUsd(r.metrics.final_nav_usd).padStart(12)} ${((d >= 0 ? "+" : "") + (d * 100).toFixed(1) + "%").padStart(10)} ${fmtX(r.metrics.nav_vs_hodl, 1).padStart(7)} ${fmtPct(r.metrics.max_drawdown * 100, 0).padStart(6)} ${String(r.metrics.trades).padStart(6)}`);
}
}

// ── Phase 1: every non-increasing 1-dp ladder over the chosen bands ────────
const allocs: number[] = []; for (let v = 1; v > -1e-9; v -= step) allocs.push(r1(v));
const ladders: Tier[][] = [];
// Count first; enumerate fully when feasible, otherwise draw random ladders (≤ maxRungs rungs, last rung may be 0 = all-out).
const countLadders = (): number => { let n = 0; (function rec(i: number, maxAlloc: number, len: number) { if (i === levels.length) { if (len) n++; return; } for (const a of allocs) { if (a >= 1 - 1e-9) { rec(i + 1, maxAlloc, len); continue; } if (a > maxAlloc + 1e-9 || len >= maxRungs) continue; if (len && Math.abs(a - maxAlloc) < 1e-9) continue; rec(i + 1, a, len + 1); } })(0, 1, 0); return n; };
const total = countLadders();
if (total <= samples) {
  (function rec(i: number, maxAlloc: number, acc: Tier[]) {
    if (i === levels.length) { if (acc.length) ladders.push(acc); return; }
    for (const a of allocs) {
      // alloc 1.0 = no rung at this band (always allowed); otherwise a rung must sell something relative to the previous one
      if (a >= 1 - 1e-9) { rec(i + 1, maxAlloc, acc); continue; }
      if (a > maxAlloc + 1e-9 || acc.length >= maxRungs) continue;
      if (acc.length && Math.abs(a - acc[acc.length - 1].alloc) < 1e-9) continue;
      rec(i + 1, a, [...acc, mkTier(levels[i], a)]);
    }
  })(0, 1, []);
} else {
  console.log(`\n${total.toLocaleString()} possible ladders > --samples ${samples}: drawing random ladders`);
  let seed = Number(args.seed ?? 7); const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const seen = new Set<string>();
  let guard = 0;
  while (ladders.length < samples && guard++ < samples * 50) {
    const n = 1 + Math.floor(rnd() * maxRungs);
    const idx = [...new Set(Array.from({ length: n }, () => Math.floor(rnd() * levels.length)))].sort((a, b) => a - b);
    const al: number[] = []; let max = 1;
    for (let k = 0; k < idx.length; k++) {
      const choices = allocs.filter((a) => a < max - 1e-9 && (k < idx.length - 1 ? a > 0 : true));
      if (!choices.length) break;
      const a = choices[Math.floor(rnd() * choices.length)]; al.push(a); max = a;
    }
    if (al.length !== idx.length) continue;
    const t = idx.map((i, k) => mkTier(levels[i], al[k]));
    const key = JSON.stringify(t); if (seen.has(key)) continue; seen.add(key); ladders.push(t);
  }
  if (!ladders.some((t) => JSON.stringify(t) === JSON.stringify(baseLadder))) ladders.push(baseLadder);
}
const gates = gateMode === "on" ? [true] : gateMode === "off" ? [false] : [true, false];
const phase1 = gates.flatMap((g) => ladders.map((t) => withLadder(t, g))).filter((c) => !all.has(cfgKey(c)));
console.log(`\nPhase 1 — ${ladders.length.toLocaleString()} ladders × gate ${gates.map((g) => g ? "on" : "off").join("/")} = ${phase1.length.toLocaleString()} configs`);
const t0 = performance.now();
remember(await pool.evalAll(phase1, false, "ladders"));
const ranked = () => [...all.values()].sort((a, b) => score(b) - score(a));

// ── Phase 2: climb the re-buy / cooldown knobs for the best ladders ────────
const climbK = Number(args.climb ?? 0);
const passes = Number(args.passes ?? 2);
const knobs: Record<string, unknown[]> = {
  dipRebuyPct: [null, 0.05, 0.08, 0.1, 0.12, 0.15, 0.2],
  dipRebuyAtCbRatio: [null, 1.0, 1.05, 1.1, 1.15, 1.2],
  dipRebuyMax: [1, 2, 3, 4, null],
  scaleCooldownDays: [null, 3, 5, 7],
  lthSellMomoGate: [true, false],
};
if (climbK > 0) {
  console.log(`\nPhase 2 — coordinate descent over ${Object.keys(knobs).join(", ")} from top ${climbK}`);
  const starts = ranked().slice(0, climbK).map((r) => r.config);
  for (let si = 0; si < starts.length; si++) {
    let cur = starts[si]; let curScore = score(all.get(cfgKey(cur))!);
    for (let pass = 0; pass < passes; pass++) {
      let improved = false;
      for (const k of Object.keys(knobs)) {
        const cands = knobs[k].map((v) => { const c = { ...cur } as Record<string, unknown>; if (v == null) delete c[k]; else c[k] = v; return c as unknown as SthCbConfig; }).filter((c) => cfgKey(c) !== cfgKey(cur));
        const fresh = cands.filter((c) => !all.has(cfgKey(c)));
        if (fresh.length) remember(await pool.evalAll(fresh, false, `climb ${si + 1}/${starts.length} p${pass + 1} ${k}`));
        for (const c of cands) { const r = all.get(cfgKey(c)); if (r && score(r) > curScore) { cur = c; curScore = score(r); improved = true; } }
      }
      console.log(`  start ${si + 1} pass ${pass + 1}: ${objective}=${curScore.toFixed(3)} NAV ${fmtUsd(all.get(cfgKey(cur))!.metrics.final_nav_usd)}`);
      if (!improved) break;
    }
  }
}

// ── Phase 3: walk-forward ──────────────────────────────────────────────────
const folds = walkForward ? annualFolds(lab.start, lab.end) : undefined;
if (walkForward) {
  const wfTop = Number(args["wf-top"] ?? 150);
  console.log(`\nPhase 3 — walk-forward on top ${wfTop} (+ base)`);
  const list = [baseCfg, ...ranked().slice(0, wfTop).map((r) => r.config)];
  remember(await pool.evalAll(list, true, "walk-forward"));
}
pool.terminate();
console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${all.size} configs evaluated`);

// ── Output ─────────────────────────────────────────────────────────────────
const results = [...all.values()].sort((a, b) => {
  if (walkForward && (a.folds_beating_hodl ?? 0) !== (b.folds_beating_hodl ?? 0)) return (b.folds_beating_hodl ?? 0) - (a.folds_beating_hodl ?? 0);
  return score(b) - score(a);
});
await Deno.mkdir(RESULTS_DIR, { recursive: true });
const outFile = `${RESULTS_DIR}${timestamp()}_ladder_${objective}${walkForward ? "_wf" : ""}.csv`;
await Deno.writeTextFile(outFile, toCsv(results.map((r) => ({
  score: score(r), objective, folds_beating_hodl: r.folds_beating_hodl ?? "", folds_total: folds?.length ?? "",
  final_nav: r.metrics.final_nav_usd, nav_vs_hodl: r.metrics.nav_vs_hodl, cagr_pct: r.metrics.final_cagr_percent, max_dd_pct: r.metrics.max_drawdown * 100,
  calmar: r.metrics.calmar, sharpe: r.metrics.sharpe, trades: r.metrics.trades, pct_in_market: r.metrics.pct_time_in_market,
  ladder: ladderTxt(r.config.lthSellTiers ?? []), gate: r.config.lthSellMomoGate ? "on" : "off", diff: configDiff(r.config, baseCfg), config: r.config,
}))));

const base = all.get(cfgKey(baseCfg))!;
console.log(`\nBase (Hybrid v2): NAV ${fmtUsd(base.metrics.final_nav_usd)} · ${fmtX(base.metrics.nav_vs_hodl, 2)} · DD ${fmtPct(base.metrics.max_drawdown * 100, 0)} · ${base.metrics.trades} trades${walkForward ? ` · WF ${base.folds_beating_hodl}/${folds!.length}` : ""}`);
console.log(`\nTop ${Math.min(topN, results.length)} by ${objective}${walkForward ? " (ranked first by years beating HODL)" : ""}:`);
console.log(`  #   ${"NAV".padStart(12)} ${"Δ base".padStart(8)} ${"×HODL".padStart(7)} ${"MaxDD".padStart(6)} Trades${walkForward ? "  WF  " : ""} gate  ladder / other changes`);
results.slice(0, topN).forEach((r, i) => {
  const m = r.metrics; const d = m.final_nav_usd / base.metrics.final_nav_usd - 1;
  const other = configDiff(r.config, baseCfg).split(" ").filter((s) => !/^lthSellTiers=|^lthSellMomoGate=/.test(s) && s !== "(defaults)").join(" ");
  console.log(`  ${String(i + 1).padStart(2)}  ${fmtUsd(m.final_nav_usd).padStart(12)} ${((d >= 0 ? "+" : "") + (d * 100).toFixed(1) + "%").padStart(8)} ${fmtX(m.nav_vs_hodl, 1).padStart(7)} ${fmtPct(m.max_drawdown * 100, 0).padStart(6)} ${String(m.trades).padStart(6)}${walkForward ? `  ${r.folds_beating_hodl ?? "-"}/${folds!.length}` : ""}  ${(r.config.lthSellMomoGate ? "on" : "off").padEnd(4)} ${ladderTxt(r.config.lthSellTiers ?? [])}${other ? "  · " + other : ""}`);
});

// How much does each band matter? Marginal view over phase-1 results: best NAV with vs without a rung at each band.
console.log("\nBest result that uses / does not use a rung at each band (gate on):");
for (const l of levels) {
  const withR = results.filter((r) => r.config.lthSellMomoGate && r.config.lthSellTiers?.some((t) => lvl(t) === l));
  const without = results.filter((r) => r.config.lthSellMomoGate && !r.config.lthSellTiers?.some((t) => lvl(t) === l));
  const best = (xs: EvalResult[]) => xs.length ? fmtUsd(Math.max(...xs.map((x) => x.metrics.final_nav_usd))) : "–";
  console.log(`  ${(kind === "cb" ? Math.round(l * 100) + "%CB" : l === 0 ? "mean" : "+" + l + "σ").padEnd(7)} with rung ${best(withR).padStart(12)}   without ${best(without).padStart(12)}`);
}
console.log(`\nAll ${results.length} results → ${outFile}`);
console.log(`\nTo reproduce #1 in the Admin UI, paste this into "Advanced (extras JSON)":\n  ${JSON.stringify(results[0].config)}`);
