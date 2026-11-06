// tools/sth_cb_lab/one_pager_data.ts
// Generates the data behind the two client/commercial documents for the STH Cost Basis Strategy (Hybrid v2.2):
//
//   docs/sth_cb_one_pager_data.js      → window.STHCB_OP   (docs/STH_CB_One_Pager.html)
//   docs/chart-data-daily-sth-cb.js    → _scb* constants   (docs/fee-model-sth-cb.html — same contract as
//                                        gen-chart-js-daily.ps1 / chart-data-daily.js, prefix _lth → _scb)
//
//   deno run -A tools/sth_cb_lab/one_pager_data.ts [--end YYYY-MM-DD]      (default: latest close in data/series.json)
//
// Basis (both files): $2,400 upfront + $200/month, periods of 1/3/5/7/10 years ending on --end with
// start = end − N years (the website's trailing-window convention, so the 5-year row ties to sth-cb.html),
// next-day fills, VALR 8 bps trade / 18 bps conversion, USDPC 10 % APY on (0.1 % per sweep).
//   management plan : 1 % p.a. on NAV (monthly) + 10 % performance (HWM)  ← live product
//   platform plan   : 0.75 % on contributions + 10 % performance (HWM)    ← fee-model alternative
//   gross           : all BitWealth + exchange fees zero (fee-model return-extraction base)
// Benchmarks (Std DCA, HODL) carry exchange fees only; HODL deposits the whole schedule on day 1.

import { simulateSthCb, SthCbSimParams } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { HYBRID_V2_2 } from "./factsheet_data_configs.ts";
import { annualFolds, evaluate, labArgsFrom, loadSeries, parseArgs, REPO_ROOT, simParams } from "./lab_core.ts";

const args = parseArgs(Deno.args);
const series = await loadSeries();
const END = String(args.end ?? series.to) <= series.to ? String(args.end ?? series.to) : series.to;
const UPFRONT = 2400, MONTHLY = 200;
const CONFIG = HYBRID_V2_2;

const shiftYears = (iso: string, y: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() - y);
  return d.toISOString().slice(0, 10);
};
const rows = series.rows.filter((r) => r.close_date <= END);

type Plan = "management" | "platform" | "gross";
function params(start: string, plan: Plan): SthCbSimParams {
  const l = labArgsFrom({ start, end: END, upfront: String(UPFRONT), monthly: String(MONTHLY), extras: JSON.stringify(CONFIG) }, series.to);
  const p = simParams(l);
  if (plan === "platform") return { ...p, feePlan: "platform", platformFeeRate: 0.0075, managementFeeRate: 0 };
  if (plan === "gross") return { ...p, tradeFeeRate: 0, contribFeeRate: 0, platformFeeRate: 0, managementFeeRate: 0, performanceFeeRate: 0 };
  return p; // management (lab default = live product)
}
const run = (start: string, plan: Plan) => simulateSthCb(rows, params(start, plan), { ledger: false, daily: true });

type Bal = { trade_date: string; nav_usd: number; contrib_net_usdt_cum: number; contrib_gross_usdt_cum: number; total_roi_percent: number; cagr_percent: number };
const rawDd = (navs: number[]) => { let peak = 0, dd = 0; for (const v of navs) { if (v > peak) peak = v; if (peak > 0) dd = Math.min(dd, v / peak - 1); } return +(-dd * 100).toFixed(1); };
// Deposit-neutral Sharpe (unit returns), annualised √365 — the simulator's own convention for the strategy row.
const unitSharpe = (bal: Bal[]) => {
  let sum = 0, sq = 0, n = 0;
  for (let i = 1; i < bal.length; i++) {
    const prev = bal[i - 1], cur = bal[i];
    const base = prev.nav_usd + (cur.contrib_net_usdt_cum - prev.contrib_net_usdt_cum);
    if (prev.nav_usd <= 0 || base <= 0) continue;
    const r = cur.nav_usd / base - 1; sum += r; sq += r * r; n++;
  }
  const mean = n ? sum / n : 0, va = n > 1 ? Math.max(0, sq / n - mean * mean) : 0;
  return +(va > 0 ? (mean / Math.sqrt(va)) * Math.sqrt(365) : 0).toFixed(2);
};
const weekly = <T>(arr: T[]) => { const out: T[] = []; for (let i = 0; i < arr.length; i += 7) out.push(arr[i]); if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]); return out; };
const r2 = (v: number) => +v.toFixed(2);

// ───────────────────────────────── One-pager ─────────────────────────────────
const YEARS = [1, 3, 5, 7, 10];
const PERIOD_LABEL: Record<number, string> = { 1: "1 Year", 3: "3 Years", 5: "5 Years", 7: "7 Years", 10: "10 Years" };
const mgmtRuns = new Map<number, ReturnType<typeof run>>();
const periods = YEARS.map((y) => {
  const start = shiftYears(END, y);
  const s = run(start, "management");
  mgmtRuns.set(y, s);
  const m = s.summary.sth_cb, std = s.stdBalances as Bal[], hodl = s.hodlBalances as Bal[];
  const lastStd = std[std.length - 1], lastHodl = hodl[hodl.length - 1];
  const nav = s.results.map((d) => d.nav_usd);
  const tradeRows = s.results.filter((d) => d.action !== "HOLD" && !/contribution|Rebalance/i.test(d.rule));
  return {
    years: y, label: PERIOD_LABEL[y], start, end: END,
    strategy: { final_nav: +m.final_nav_usd.toFixed(0), invested: +m.total_contrib_gross_usdt.toFixed(0), cagr_pct: +m.final_cagr_percent.toFixed(1), roi_pct: +m.final_roi_percent.toFixed(1), max_dd_pct: rawDd(nav), sharpe: +m.sharpe.toFixed(2), trades: tradeRows.length, pct_in_market: +m.pct_time_in_market.toFixed(0), fees: { mgmt: +m.fees.platform_or_mgmt_usdt.toFixed(0), perf: +m.fees.performance_usdt.toFixed(0) } },
    std_dca: { final_nav: +lastStd.nav_usd.toFixed(0), invested: +lastStd.contrib_gross_usdt_cum.toFixed(0), cagr_pct: +lastStd.cagr_percent.toFixed(1), roi_pct: +lastStd.total_roi_percent.toFixed(1), max_dd_pct: rawDd(std.map((b) => b.nav_usd)), sharpe: unitSharpe(std) },
    hodl: { final_nav: +lastHodl.nav_usd.toFixed(0), invested: +lastHodl.contrib_gross_usdt_cum.toFixed(0), cagr_pct: +lastHodl.cagr_percent.toFixed(1), roi_pct: +lastHodl.total_roi_percent.toFixed(1), max_dd_pct: rawDd(hodl.map((b) => b.nav_usd)), sharpe: unitSharpe(hodl) },
    series: y === 5 || y === 10
      ? weekly(s.results.map((d, i) => [d.trade_date, +d.nav_usd.toFixed(0), +(std[i]?.nav_usd ?? NaN).toFixed(0), +(hodl[i]?.nav_usd ?? NaN).toFixed(0)]))
      : undefined,
  };
});

// Headline (standard research basis): $1,000 lump from 2017-01-01 to the data end, walk-forward per calendar year.
const stdLab = labArgsFrom({ start: "2017-01-01", end: END, upfront: "1000", monthly: "0", extras: JSON.stringify(CONFIG) }, series.to);
const stdSim = simulateSthCb(rows, simParams(stdLab), { ledger: false, daily: true });
const sm = stdSim.summary.sth_cb;
const wf = evaluate(rows, stdLab, stdLab.config, annualFolds(stdLab.start, stdLab.end));
const yearsBeat = wf.folds!.filter((f) => f.beat_hodl).map((f) => f.fold.oosStart.slice(0, 4));
const yearsLost = wf.folds!.filter((f) => !f.beat_hodl).map((f) => f.fold.oosStart.slice(0, 4));

const op = {
  generated_at: new Date().toISOString().slice(0, 10),
  basis: { upfront: UPFRONT, monthly: MONTHLY, end: END, fills: "next-day", fee_plan: "management 1% p.a. + 10% performance (HWM)", usdpc: "10% APY, 0.1% per sweep", exchange: "VALR 8 bps trade / 18 bps conversion" },
  headline: {
    start: stdLab.start, end: END, upfront: 1000,
    final_nav: +sm.final_nav_usd.toFixed(0), roi_pct: +sm.final_roi_percent.toFixed(0), cagr_pct: +sm.final_cagr_percent.toFixed(1),
    max_dd_pct: +(sm.max_drawdown * 100).toFixed(1), nav_vs_hodl: +sm.nav_vs_hodl.toFixed(1), hodl_nav: +(stdSim.summary.hodl?.final_nav_usd ?? 0).toFixed(0),
    hodl_cagr_pct: +(stdSim.summary.hodl?.final_cagr_percent ?? 0).toFixed(1), pct_in_market: +sm.pct_time_in_market.toFixed(0), trades: sm.trades,
    wf_beat: wf.folds_beating_hodl, wf_total: wf.folds!.length, years_beat: yearsBeat, years_lost: yearsLost,
  },
  periods,
};
const OUT_DIR = Deno.env.get("STHCB_OUT_DIR") ?? `${REPO_ROOT}docs/`;
const opFile = `${OUT_DIR}sth_cb_one_pager_data.js`;
await Deno.writeTextFile(opFile, `// Generated by tools/sth_cb_lab/one_pager_data.ts on ${op.generated_at} — do not edit\nwindow.STHCB_OP = ${JSON.stringify(op)};\n`);
console.log(`wrote ${opFile}`);
for (const p of periods) console.log(`  ${p.label.padEnd(9)} ${p.start}→${p.end}  strategy $${p.strategy.final_nav.toLocaleString()}  std $${p.std_dca.final_nav.toLocaleString()}  hodl $${p.hodl.final_nav.toLocaleString()}  DD ${p.strategy.max_dd_pct}%`);
console.log(`  headline ${op.headline.start}→${END} $1k: $${op.headline.final_nav.toLocaleString()} · ${op.headline.nav_vs_hodl}× HODL · WF ${op.headline.wf_beat}/${op.headline.wf_total} (lost: ${yearsLost.join(", ")})`);

// ───────────────────────────────── Fee model ─────────────────────────────────
const lit = (pairs: (string | number)[][]) => pairs.map((p) => `['${p[0]}',${p.slice(1).join(",")}]`).join(",");
const dailyNav = (s: ReturnType<typeof run>) => s.results.map((d) => [d.trade_date, r2(d.nav_usd)]);
// Per-day BitWealth rebate = 50 % of all three VALR legs (BTC fee valued at that day's price, USDT conversion fee, USDPC sweep fee).
const rebate = (s: ReturnType<typeof run>) => {
  const pairs: (string | number)[][] = []; let total = 0;
  for (const d of s.results) {
    const reb = (d.exchange_fees_paid_btc * d.price_usd + d.exchange_fees_paid_usdt + (d.usdpc_conversion_fee_usdt ?? 0)) * 0.5;
    total += reb;
    if (reb > 0) pairs.push([d.trade_date, +reb.toFixed(4)]);
  }
  return { pairs, total: r2(total) };
};
const netMonthly = (s: ReturnType<typeof run>) => { const out: (string | number)[][] = []; let seen = ""; for (const d of s.results) { const ym = d.trade_date.slice(0, 7); if (ym !== seen) { out.push([d.trade_date, r2(d.nav_usd)]); seen = ym; } } return out; };
const sumBy = (s: ReturnType<typeof run>, k: "platform_fees_paid_usdt" | "performance_fees_paid_usdt") => r2(s.results.reduce((a, d) => a + (d[k] ?? 0), 0));

const g5 = run(shiftYears(END, 5), "gross"), g10 = run(shiftYears(END, 10), "gross");
const plt: Record<string, ReturnType<typeof run>> = {}, mg: Record<string, ReturnType<typeof run>> = {};
for (const y of YEARS) { plt[PERIOD_LABEL[y]] = run(shiftYears(END, y), "platform"); mg[PERIOD_LABEL[y]] = mgmtRuns.get(y)!; }
const anchor = (s: ReturnType<typeof run>, feeKey: "platformFee" | "managementFee") => {
  const m = s.summary.sth_cb;
  return `{ invested: ${r2(m.total_contrib_gross_usdt)}, netNav: ${r2(m.final_nav_usd)}, ${feeKey}: ${sumBy(s, "platform_fees_paid_usdt")}, perfFee: ${sumBy(s, "performance_fees_paid_usdt")}, exchRebate: ${rebate(s).total}, days: ${s.results.length} }`;
};
const obj = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `  "${k}": ${v}`).join(",\n");
const rawWeekly = (s: ReturnType<typeof run>) => lit(weekly(s.results.map((d, i) => [d.trade_date, r2(d.nav_usd), r2(s.stdBalances[i]?.nav_usd ?? NaN), r2(s.hodlBalances[i]?.nav_usd ?? NaN)])));

const fm = `// Auto-generated DAILY chart data — ${op.generated_at} — STH Cost Basis Strategy (Hybrid v2.2)
// Source: tools/sth_cb_lab/one_pager_data.ts (local lab simulator = _shared/sth_cb_simulator.ts, identical to ef_sth_cb_bt_execute),
//         USDPC 10% APY ON, windows end ${END} (start = end − N years). Same contract as chart-data-daily.js (prefix _scb).
// To regenerate: deno run -A tools/sth_cb_lab/one_pager_data.ts
//
// Weekly [date, strategy, std_dca, hodl] for the management plan — fallback / overview series:
const _scb5_raw  = [${rawWeekly(mg["5 Years"])}];
const _scb10_raw = [${rawWeekly(mg["10 Years"])}];
//
// GROSS series (all fees = 0) — drives the return-extraction reconstruction & drill-down:
const _scb5_daily      = [${lit(dailyNav(g5))}];
const _scb10_daily     = [${lit(dailyNav(g10))}];
//
// PLATFORM-fee NET series (platform 0.75% on contributions + perf 10% HWM):
const _scb5_daily_net  = [${lit(dailyNav(plt["5 Years"]))}];
const _scb10_daily_net = [${lit(dailyNav(plt["10 Years"]))}];
//
// MANAGEMENT-fee NET series (live product: management 1% p.a. on NAV + perf 10% HWM):
const _scb5_daily_net_mgmt  = [${lit(dailyNav(mg["5 Years"]))}];
const _scb10_daily_net_mgmt = [${lit(dailyNav(mg["10 Years"]))}];
//
// Authoritative per-period figures — PLATFORM plan.
const _scbAnchors = {
${obj(Object.fromEntries(Object.entries(plt).map(([k, s]) => [k, anchor(s, "platformFee")])))}
};
//
// Authoritative per-period figures — MANAGEMENT plan.
const _scbMgmtAnchors = {
${obj(Object.fromEntries(Object.entries(mg).map(([k, s]) => [k, anchor(s, "managementFee")])))}
};
//
// Per-day BitWealth exchange rebate (USD) — PLATFORM plan. Sums to _scbAnchors[...].exchRebate.
const _scbRebateDaily = {
${obj(Object.fromEntries(Object.entries(plt).map(([k, s]) => [k, `[${lit(rebate(s).pairs)}]`])))}
};
//
// Per-day BitWealth exchange rebate (USD) — MANAGEMENT plan. Sums to _scbMgmtAnchors[...].exchRebate.
const _scbMgmtRebateDaily = {
${obj(Object.fromEntries(Object.entries(mg).map(([k, s]) => [k, `[${lit(rebate(s).pairs)}]`])))}
};
//
// Per-period monthly NET NAV — PLATFORM plan.
const _scbNetMonthly = {
${obj(Object.fromEntries(Object.entries(plt).map(([k, s]) => [k, `[${lit(netMonthly(s))}]`])))}
};
//
// Per-period monthly NET NAV — MANAGEMENT plan.
const _scbMgmtNetMonthly = {
${obj(Object.fromEntries(Object.entries(mg).map(([k, s]) => [k, `[${lit(netMonthly(s))}]`])))}
};
`;
const fmFile = `${OUT_DIR}chart-data-daily-sth-cb.js`;
await Deno.writeTextFile(fmFile, fm);
console.log(`wrote ${fmFile} (${(fm.length / 1024).toFixed(0)} KB)`);
for (const k of Object.keys(mg)) {
  const a = mg[k].summary.sth_cb, b = plt[k].summary.sth_cb;
  console.log(`  ${k.padEnd(9)} mgmt NAV $${a.final_nav_usd.toFixed(0)} (mgmt $${sumBy(mg[k], "platform_fees_paid_usdt")}, perf $${sumBy(mg[k], "performance_fees_paid_usdt")}, rebate $${rebate(mg[k]).total}) · platform NAV $${b.final_nav_usd.toFixed(0)}`);
}
// Sanity: the one-pager's 5-year management row must equal the fee-model management anchor.
if (Math.abs(periods[2].strategy.final_nav - mg["5 Years"].summary.sth_cb.final_nav_usd) > 1) throw new Error("5-year rows disagree");
