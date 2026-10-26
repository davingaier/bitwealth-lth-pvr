// tools/sth_cb_lab/factsheet_data.ts
// Generate the data file behind the STH_CB fact sheets.
//
//   deno run -A tools/sth_cb_lab/factsheet_data.ts                 → docs/sth_cb_factsheet_data.js     (Hybrid v1 sheet)
//   deno run -A tools/sth_cb_lab/factsheet_data.ts --variant v2    → docs/sth_cb_factsheet_data_v2.js  (Hybrid v2 sheet, incl. v1 comparison)

import { simulateSthCb } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { annualFolds, evaluate, labArgsFrom, loadSeries, parseArgs, REPO_ROOT, simParams } from "./lab_core.ts";

export const HYBRID_V1 = {
  capBuyRatio: 0.75, capExitRatio: 0.95, trendEnterRatio: 1.12, trendExitRatio: 0.97,
  momoLength: 2, momoThreshold: -0.02, distributeAtSigma: 2.5, cbSlopeDays: 21, trailingStopPct: 0.35,
  reentryRocThreshold: 0.1, minHoldDays: 15, blockEntryAboveSigma: 2.5, distReentryClearRatio: 0.9,
  capBuyAtLthSigma: -0.5, trendReentryRatio: 1.02, capBuyRocThreshold: 0, sellTiers: [{ ratio: 2, alloc: 0 }],
};

// v2 = v1 minus the single +2.5σ distribution, plus a momentum-gated scale-out ladder, dip re-buy and cooldown.
export const HYBRID_V2 = {
  capBuyRatio: 0.75, capExitRatio: 0.95, trendEnterRatio: 1.12, trendExitRatio: 0.97,
  momoLength: 2, momoThreshold: -0.02, cbSlopeDays: 21, trailingStopPct: 0.35,
  reentryRocThreshold: 0.1, minHoldDays: 15, blockEntryAboveSigma: 2.5, distReentryClearRatio: 0.85,
  capBuyAtLthSigma: -0.5, trendReentryRatio: 1.02, capBuyRocThreshold: 0,
  lthSellTiers: [{ sigma: 1, alloc: 0.75 }, { sigma: 1.5, alloc: 0.5 }, { sigma: 2, alloc: 0.25 }, { sigma: 2.5, alloc: 0 }],
  lthSellMomoGate: true, dipRebuyPct: 0.1, dipRebuyAtCbRatio: 1.1, dipRebuyMax: 3, scaleCooldownDays: 5,
};

const args = parseArgs(Deno.args);
const variant = (args.variant as string | undefined) === "v2" ? "v2" : "v1";
const CONFIG = variant === "v2" ? HYBRID_V2 : HYBRID_V1;
const series = await loadSeries();
const lab = labArgsFrom({ start: "2017-01-01", end: "2026-10-23", upfront: "1000", monthly: "0", ...args, extras: JSON.stringify(CONFIG) }, series.to);
const rows = series.rows.filter((r) => r.close_date <= lab.end);
const byDate = new Map(rows.map((r) => [r.close_date, r]));

const sim = simulateSthCb(rows, simParams(lab), { ledger: false, daily: true });
const m = sim.summary.sth_cb;
const hodlByDate = new Map(sim.hodlBalances.map((h) => [h.trade_date, h.nav_usd]));
const stdByDate = new Map(sim.stdBalances.map((h) => [h.trade_date, h.nav_usd]));

const bandVal = (b: Record<string, unknown> | undefined, k: string) => b && b[k] != null && Number.isFinite(Number(b[k])) ? +Number(b[k]).toFixed(2) : null;

// Daily chart series
// [date, price, cb, nav, hodl_nav, std_nav, position(0/1/2), lth m050, lth p250, target_alloc, lth p100, lth p150, lth p200]
const daily = sim.results.map((d) => {
  const r = byDate.get(d.trade_date)!;
  const b = (r.bands ?? {}) as Record<string, unknown>;
  return [
    d.trade_date,
    +d.price_usd.toFixed(2),
    +d.sth_cost_basis_usd.toFixed(2),
    +d.nav_usd.toFixed(2),
    +(hodlByDate.get(d.trade_date) ?? NaN).toFixed(2),
    +(stdByDate.get(d.trade_date) ?? NaN).toFixed(2),
    d.position_state === "trend_hold" ? 2 : d.position_state === "cap_hold" ? 1 : 0,
    bandVal(b, "m050"),
    bandVal(b, "p250"),
    +(d.target_alloc ?? (d.position_state === "cash" ? 0 : 1)).toFixed(2),
    bandVal(b, "p100"),
    bandVal(b, "p150"),
    bandVal(b, "p200"),
  ];
});

// Trades (non-contribution). `alloc` = BTC allocation targeted after the trade; `partial` = a scale-out slice or a dip re-buy.
const trades = sim.results
  .filter((d) => d.action !== "HOLD" && !/contribution|Rebalance/i.test(d.rule))
  .map((d) => {
    const alloc = +(d.target_alloc ?? (d.position_state === "cash" ? 0 : 1)).toFixed(2);
    const partial = /scale-out tier \d+ → |Dip re-buy/i.test(d.rule);
    return { date: d.trade_date, action: d.action, rule: d.rule.replace(/ \(trend_hold from warm-up\)/, " (from warm-up)"), price: +d.price_usd.toFixed(0), cb: +d.sth_cost_basis_usd.toFixed(0), ratio: +(d.price_to_cb_ratio ?? 0).toFixed(3), nav: +d.nav_usd.toFixed(0), position: d.position_state, alloc, partial };
  });

// Annual table: strategy, HODL, BTC price change per calendar year (chained, from the single run)
const years = [...new Set(sim.results.map((d) => d.trade_date.slice(0, 4)))];
const annual = years.map((y) => {
  const ys = sim.results.filter((d) => d.trade_date.startsWith(y));
  const first = ys[0], last = ys[ys.length - 1];
  const idx = sim.results.indexOf(first);
  const prev = idx > 0 ? sim.results[idx - 1] : null;
  const navStart = prev ? prev.nav_usd : lab.upfront;
  const pxStart = prev ? prev.price_usd : first.price_usd;
  const stratRet = last.nav_usd / navStart - 1;
  const btcRet = last.price_usd / pxStart - 1;
  return { year: y, nav_end: +last.nav_usd.toFixed(0), strat_ret: +(stratRet * 100).toFixed(1), btc_ret: +(btcRet * 100).toFixed(1), beat: stratRet > btcRet, price_end: +last.price_usd.toFixed(0), in_market_pct: +(ys.filter((d) => d.position_state !== "cash").length / ys.length * 100).toFixed(0) };
});

// Walk-forward (independent per-year runs seeded by warm-up)
const wf = evaluate(rows, lab, lab.config, annualFolds(lab.start, lab.end));

// Robustness
const run = (over: Partial<typeof lab> = {}, mutate?: (r: typeof rows[number]) => typeof rows[number], config: Record<string, unknown> = lab.config as Record<string, unknown>) => {
  const l = { ...lab, ...over };
  const data = (mutate ? rows.map(mutate) : rows).filter((r) => r.close_date <= l.end);
  const s = simulateSthCb(data, simParams(l, config as typeof lab.config), { ledger: false, daily: false }).summary.sth_cb;
  return { nav: +s.final_nav_usd.toFixed(0), x: +s.nav_vs_hodl.toFixed(2), roi: +s.final_roi_percent.toFixed(0), dd: +(s.max_drawdown * 100).toFixed(0), trades: s.trades };
};
const battery = (config: Record<string, unknown>) => ({
  base: run({}, undefined, config),
  same_day: run({ sameDay: true }, undefined, config),
  gross: run({ fees: "exchange_only" }, undefined, config),
  cb_shift: Object.fromEntries([0.94, 0.97, 1.03, 1.06].map((k) => [k, run({}, (r) => ({ ...r, cb: r.cb * k }), config)])),
  lth_shift: Object.fromEntries([0.95, 1.05].map((k) => [k, run({}, (r) => ({ ...r, bands: r.bands ? Object.fromEntries(Object.entries(r.bands).map(([a, v]) => [a, v == null ? v : Number(v) * k])) : r.bands }), config)])),
  starts: Object.fromEntries(["2015-01-04", "2016-01-01", "2017-01-01", "2018-01-01", "2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01", "2023-01-01"].map((s) => [s, run({ start: s }, undefined, config)])),
  dca: { "10000+500": run({ upfront: 10_000, monthly: 500 }, undefined, config), "1000+100": run({ upfront: 1_000, monthly: 100 }, undefined, config), "0+100": run({ upfront: 0, monthly: 100 }, undefined, config) },
});
const robustness = battery(lab.config as Record<string, unknown>);

// v2 sheet: the same battery for v1 so every row can be shown side by side, plus v1's walk-forward and daily NAV.
let compare: Record<string, unknown> | undefined;
if (variant === "v2") {
  const v1lab = labArgsFrom({ start: lab.start, end: lab.end, upfront: String(lab.upfront), monthly: String(lab.monthly), extras: JSON.stringify(HYBRID_V1) }, series.to);
  const v1sim = simulateSthCb(rows, simParams(v1lab), { ledger: false, daily: true });
  const v1wf = evaluate(rows, v1lab, v1lab.config, annualFolds(lab.start, lab.end));
  const v1nav = new Map(v1sim.results.map((d) => [d.trade_date, +d.nav_usd.toFixed(2)]));
  compare = {
    label: "Hybrid v1",
    config: HYBRID_V1,
    summary: { final_nav: +v1sim.summary.sth_cb.final_nav_usd.toFixed(0), roi_pct: +v1sim.summary.sth_cb.final_roi_percent.toFixed(0), cagr_pct: +v1sim.summary.sth_cb.final_cagr_percent.toFixed(1), max_dd_pct: +(v1sim.summary.sth_cb.max_drawdown * 100).toFixed(1), trades: v1sim.summary.sth_cb.trades, nav_vs_hodl: +v1sim.summary.sth_cb.nav_vs_hodl.toFixed(2), pct_in_market: v1sim.summary.sth_cb.pct_time_in_market, sharpe: +v1sim.summary.sth_cb.sharpe.toFixed(2), calmar: +v1sim.summary.sth_cb.calmar.toFixed(2), wf_beat: v1wf.folds_beating_hodl, wf_total: v1wf.folds!.length },
    wf: v1wf.folds!.map((f) => ({ year: f.fold.oosStart.slice(0, 4), x: +f.nav_vs_hodl.toFixed(2), beat: f.beat_hodl })),
    robustness: battery(v1lab.config as Record<string, unknown>),
    nav: daily.map((d) => v1nav.get(d[0] as string) ?? null),
  };
}
// Sanity: the "as tested" battery row must equal the headline run.
if (Math.abs(robustness.base.nav - m.final_nav_usd) > 1) throw new Error(`robustness base ${robustness.base.nav} ≠ headline ${m.final_nav_usd}`);

const out = {
  generated_at: new Date().toISOString().slice(0, 10),
  variant,
  window: { start: lab.start, end: lab.end, upfront: lab.upfront, monthly: lab.monthly, fills: lab.sameDay ? "same-day" : "next-day", fees: lab.fees },
  config: CONFIG,
  summary: {
    final_nav: +m.final_nav_usd.toFixed(0), roi_pct: +m.final_roi_percent.toFixed(0), cagr_pct: +m.final_cagr_percent.toFixed(1),
    max_dd_pct: +(m.max_drawdown * 100).toFixed(1), sharpe: +m.sharpe.toFixed(2), calmar: +m.calmar.toFixed(2),
    trades: m.trades, pct_in_market: m.pct_time_in_market, nav_vs_hodl: +m.nav_vs_hodl.toFixed(2), nav_vs_std: +m.nav_vs_std_dca.toFixed(2),
    hodl_nav: +(sim.summary.hodl?.final_nav_usd ?? 0).toFixed(0), hodl_roi_pct: +(sim.summary.hodl?.final_roi_percent ?? 0).toFixed(0), hodl_cagr_pct: +(sim.summary.hodl?.final_cagr_percent ?? 0).toFixed(1),
    fees: { mgmt: +m.fees.platform_or_mgmt_usdt.toFixed(0), perf: +m.fees.performance_usdt.toFixed(0), usdpc: +m.fees.usdpc_conversion_usdt.toFixed(0), exch_btc: +m.fees.exchange_btc.toFixed(4) },
    wf_beat: wf.folds_beating_hodl, wf_total: wf.folds!.length,
  },
  wf: wf.folds!.map((f) => ({ year: f.fold.oosStart.slice(0, 4), x: +f.nav_vs_hodl.toFixed(2), beat: f.beat_hodl })),
  annual, trades, robustness, daily, compare,
};
const file = `${REPO_ROOT}docs/${variant === "v2" ? "sth_cb_factsheet_data_v2.js" : "sth_cb_factsheet_data.js"}`;
await Deno.writeTextFile(file, `// Generated by tools/sth_cb_lab/factsheet_data.ts${variant === "v2" ? " --variant v2" : ""} on ${out.generated_at} — do not edit\nwindow.STHCB = ${JSON.stringify(out)};\n`);
console.log(`wrote ${file}: ${daily.length} daily rows, ${trades.length} trades, NAV ${m.final_nav_usd.toFixed(0)}${compare ? ` (v1 NAV ${(compare.summary as { final_nav: number }).final_nav})` : ""}`);
