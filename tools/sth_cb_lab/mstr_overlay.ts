// tools/sth_cb_lab/mstr_overlay.ts
// Hypothesis test: MSTR (VALR: MSTRX) behaves like leveraged BTC, so the STH_CB daily allocation path decided on
// BTC should also work — amplified — when executed on MSTR.
//
// Method (pure overlay, no refit):
//   1. Run the STH_CB simulator on the BTC series with the chosen config (default hybrid v2.2) to obtain the daily
//      `signal_target_alloc` (decided at the BTC close, executed next day).
//   2. Replay that allocation path on the equity: on each trading day T the target is the latest BTC signal with
//      close_date < T (weekend signals execute on Monday); rebalance to target × NAV at T's close when the target
//      changes (or new cash arrives — Policy A), all-in / all-out exactly as the BTC engine does. Idle cash earns 0.
//   3. Compare: BTC HODL, BTC strategy, equity HODL, equity strategy — over several start dates — plus the daily-return
//      correlation/beta of the equity vs BTC and a per-segment hit table (what the equity did while the strategy was
//      in / out of the market).
//
//   deno run -A tools/sth_cb_lab/mstr_overlay.ts [--symbol MSTR] [--start 2020-08-11] [--end YYYY-MM-DD]
//        [--upfront 10000] [--monthly 0] [--eq-bps 10] [--trade-bps 8] [--periods 2017-01-01,2020-08-11,...]
//        [--config '{...}' | --config-file x.json] [--csv]
//
// Fees: BTC leg = exchange-only (no platform/mgmt/perf, no USDPC) so both legs are compared on the same basis.

import { simulateSthCb, SthCbDailyRow } from "../../supabase/functions/_shared/sth_cb_simulator.ts";
import { DEFAULT_STH_CB_CONFIG, SthCbConfig } from "../../supabase/functions/_shared/sth_cb_strategy_logic.ts";
import { HYBRID_V2_2 } from "./factsheet_data_configs.ts";
import { EquityBar, loadEquity } from "./fetch_mstr.ts";
import { fmtPct, fmtUsd, fmtX, LabArgs, loadSeries, parseArgs, RESULTS_DIR, simParams, timestamp, toCsv } from "./lab_core.ts";

// ---------------------------------------------------------------------------
// Equity replay engine
// ---------------------------------------------------------------------------
export interface ReplayRow { date: string; px: number; target: number; shares: number; cash: number; nav: number; action: "BUY" | "SELL" | "HOLD"; hodl_nav: number }
export interface ReplayMetrics {
  final_nav: number; hodl_nav: number; nav_vs_hodl: number; roi_pct: number; cagr_pct: number; hodl_cagr_pct: number;
  max_dd: number; hodl_max_dd: number; trades: number; pct_in_market: number; days: number; contrib: number;
}

const DUST = 0.01;

export function replayOnEquity(
  btcDaily: SthCbDailyRow[], bars: EquityBar[], start: string, end: string, upfront: number, monthly: number, feeRate: number,
): { rows: ReplayRow[]; metrics: ReplayMetrics } {
  // signal_target_alloc decided at BTC close D → executable from D+1
  const signals = btcDaily.filter((r) => r.close_date >= "1900").map((r) => ({ d: r.close_date, t: r.signal_target_alloc }));
  let si = 0;
  const latestSignalBefore = (date: string): number | null => {
    while (si + 1 < signals.length && signals[si + 1].d < date) si++;
    return signals.length && signals[si].d < date ? signals[si].t : null;
  };

  const days = bars.filter((b) => b.date >= start && b.date <= end);
  if (!days.length) throw new Error(`no equity bars between ${start} and ${end}`);

  let shares = 0, cash = 0, lastTarget = -1, trades = 0, inMarketDays = 0, contrib = 0;
  let hShares = 0;
  let lastMonth = "";
  const rows: ReplayRow[] = [];
  // time-weighted unit value for a contribution-neutral drawdown
  let units = 0, hUnits = 0, peak = -Infinity, hPeak = -Infinity, maxDd = 0, hMaxDd = 0;

  for (let i = 0; i < days.length; i++) {
    const { date, adj_close: px } = days[i];
    // cash in: upfront on day 0, monthly on the first trading day of each later month
    let cashIn = 0;
    const month = date.slice(0, 7);
    if (i === 0) cashIn += upfront;
    else if (month !== lastMonth && monthly > 0) cashIn += monthly;
    lastMonth = month;
    if (cashIn > 0) {
      const navBefore = shares * px + cash;
      const unitPx = units > 0 ? navBefore / units : 1;
      units += cashIn / unitPx;
      const hNavBefore = hShares * px;
      const hUnitPx = hUnits > 0 ? hNavBefore / hUnits : 1;
      hUnits += cashIn / hUnitPx;
      cash += cashIn;
      contrib += cashIn;
      hShares += (cashIn * (1 - feeRate)) / px; // HODL deploys every deposit immediately
    }

    const sig = latestSignalBefore(date);
    const target = sig === null ? 0 : Math.max(0, Math.min(1, sig));
    const targetChanged = Math.abs(target - lastTarget) > 1e-9;
    let action: ReplayRow["action"] = "HOLD";
    const nav = shares * px + cash;
    if (target >= 1 - 1e-9) {
      if (cash > DUST) { shares += (cash * (1 - feeRate)) / px; cash = 0; action = "BUY"; if (targetChanged) trades++; }
    } else if (target <= 1e-9) {
      if (shares * px > DUST) { cash += shares * px * (1 - feeRate); shares = 0; action = "SELL"; trades++; }
    } else if (targetChanged || cashIn > 0) {
      const delta = target * nav - shares * px;
      if (delta > DUST && cash > DUST) {
        const spend = Math.min(delta, cash);
        shares += (spend * (1 - feeRate)) / px; cash -= spend; action = "BUY"; if (targetChanged) trades++;
      } else if (delta < -DUST) {
        const sellUsd = Math.min(-delta, shares * px);
        shares -= sellUsd / px; cash += sellUsd * (1 - feeRate); action = "SELL"; if (targetChanged) trades++;
      }
    }
    lastTarget = target;
    if (shares * px > DUST) inMarketDays++;

    const navNow = shares * px + cash;
    const hNav = hShares * px;
    const unitVal = units > 0 ? navNow / units : 1;
    const hUnitVal = hUnits > 0 ? hNav / hUnits : 1;
    peak = Math.max(peak, unitVal); hPeak = Math.max(hPeak, hUnitVal);
    maxDd = Math.min(maxDd, unitVal / peak - 1); hMaxDd = Math.min(hMaxDd, hUnitVal / hPeak - 1);
    rows.push({ date, px, target, shares, cash, nav: navNow, action, hodl_nav: hNav });
  }

  const last = rows[rows.length - 1];
  const years = (Date.parse(last.date) - Date.parse(rows[0].date)) / 86_400_000 / 365.25;
  const cagr = (nav: number) => years > 0 && contrib > 0 ? (Math.pow(nav / contrib, 1 / years) - 1) * 100 : NaN;
  return {
    rows,
    metrics: {
      final_nav: last.nav, hodl_nav: last.hodl_nav, nav_vs_hodl: last.nav / last.hodl_nav,
      roi_pct: (last.nav / contrib - 1) * 100, cagr_pct: cagr(last.nav), hodl_cagr_pct: cagr(last.hodl_nav),
      max_dd: maxDd, hodl_max_dd: hMaxDd, trades, pct_in_market: (inMarketDays / rows.length) * 100, days: rows.length, contrib,
    },
  };
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------
function returnsOnCommonDays(bars: EquityBar[], btcPx: Map<string, number>, start: string, end: string) {
  const eq: number[] = [], btc: number[] = [];
  let prev: EquityBar | null = null;
  for (const b of bars) {
    if (b.date < start || b.date > end) continue;
    if (prev && btcPx.has(b.date) && btcPx.has(prev.date)) {
      eq.push(Math.log(b.adj_close / prev.adj_close));
      btc.push(Math.log(btcPx.get(b.date)! / btcPx.get(prev.date)!));
    }
    prev = b;
  }
  return { eq, btc };
}

function corrBeta(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return { n, corr: NaN, beta: NaN, upCapture: NaN, downCapture: NaN };
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, syy = 0, sxy = 0, upX = 0, upY = 0, dnX = 0, dnY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    if (x[i] > 0) { upX += x[i]; upY += y[i]; } else if (x[i] < 0) { dnX += x[i]; dnY += y[i]; }
  }
  return { n, corr: sxy / Math.sqrt(sxx * syy), beta: sxy / sxx, upCapture: upY / upX, downCapture: dnY / dnX };
}

interface Segment { kind: "in" | "out"; from: string; to: string; alloc: number; btc_ret: number; eq_ret: number | null }

function segments(btcDaily: SthCbDailyRow[], bars: EquityBar[], start: string, end: string): Segment[] {
  const rows = btcDaily.filter((r) => r.close_date >= start && r.close_date <= end);
  const eqOnOrAfter = (d: string): number | null => {
    const b = bars.find((x) => x.date > d); // first trading close after the BTC signal day (= execution day)
    return b ? b.adj_close : null;
  };
  const segs: Segment[] = [];
  let cur: { kind: "in" | "out"; from: string; alloc: number } | null = null;
  const flush = (to: string) => {
    if (!cur) return;
    const a = rows.find((r) => r.close_date === cur!.from)!, b = rows.find((r) => r.close_date === to)!;
    const e0 = eqOnOrAfter(cur.from), e1 = eqOnOrAfter(to);
    segs.push({ kind: cur.kind, from: cur.from, to, alloc: cur.alloc, btc_ret: b.price_usd / a.price_usd - 1, eq_ret: e0 && e1 ? e1 / e0 - 1 : null });
  };
  for (const r of rows) {
    const kind: "in" | "out" = r.signal_target_alloc > 0 ? "in" : "out";
    if (!cur) { cur = { kind, from: r.close_date, alloc: r.signal_target_alloc }; continue; }
    if (kind !== cur.kind) { flush(r.close_date); cur = { kind, from: r.close_date, alloc: r.signal_target_alloc }; }
    else cur.alloc = Math.max(cur.alloc, r.signal_target_alloc);
  }
  if (cur) flush(rows[rows.length - 1].close_date);
  return segs;
}

const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const a = parseArgs(Deno.args);
  const symbol = String(a.symbol ?? "MSTR").toUpperCase();
  const [series, equity] = await Promise.all([loadSeries(), loadEquity(symbol)]);
  const btcRows = series.rows;
  const bars = equity.rows;
  const btcPx = new Map(btcRows.map((r) => [r.close_date, r.px]));
  const endAll = String(a.end ?? (series.to < equity.to ? series.to : equity.to));
  const upfront = Number(a.upfront ?? 10_000), monthly = Number(a.monthly ?? 0);
  const eqFee = Number(a["eq-bps"] ?? 10) / 10_000;
  const tradeBps = Number(a["trade-bps"] ?? 8);
  const extras = typeof a["config-file"] === "string" ? JSON.parse(await Deno.readTextFile(String(a["config-file"]))) : typeof a.config === "string" ? JSON.parse(a.config) : HYBRID_V2_2;
  const config: SthCbConfig = { ...DEFAULT_STH_CB_CONFIG, ...extras };
  const periods = String(a.periods ?? "2015-01-04,2017-01-01,2020-08-11,2022-01-01,2023-01-01,2024-01-01,2025-01-01").split(",").map((s) => s.trim()).filter(Boolean);
  if (typeof a.start === "string" && !periods.includes(a.start)) periods.unshift(a.start);

  console.log(`\n# STH_CB allocation path replayed on ${symbol}  (config: ${a.config || a["config-file"] ? "custom" : "hybrid_v2_2"}, upfront ${fmtUsd(upfront)}, monthly ${fmtUsd(monthly)}, BTC fee ${tradeBps} bps, ${symbol} fee ${(eqFee * 1e4).toFixed(0)} bps, end ${endAll})`);
  console.log(`${symbol} bars ${equity.from} → ${equity.to}; BTC series ${series.from} → ${series.to}\n`);

  const summary: Record<string, unknown>[] = [];
  let primary: { start: string; rows: ReplayRow[]; btc: SthCbDailyRow[] } | null = null;
  for (const start of periods) {
    if (start >= endAll || start < equity.from) continue;
    const lab: LabArgs = { start, end: endAll, upfront, monthly, sameDay: false, fees: "exchange_only", tradeBps, contribBps: 0, config };
    const sim = simulateSthCb(btcRows, simParams(lab), { ledger: false, daily: true });
    const m = sim.summary.sth_cb, hodl = sim.summary.hodl!;
    const rep = replayOnEquity(sim.results, bars, start, endAll, upfront, monthly, eqFee);
    const e = rep.metrics;
    const hodlDd = (() => { let pk = -Infinity, dd = 0; for (const r of sim.hodlBalances) { const u = r.nav_usd / Math.max(1e-9, r.contrib_net_usdt_cum); pk = Math.max(pk, u); dd = Math.min(dd, u / pk - 1); } return dd; })();
    summary.push({
      start, btc_hodl_nav: hodl.final_nav_usd, btc_strat_nav: m.final_nav_usd, btc_strat_x_hodl: m.nav_vs_hodl, btc_strat_dd: m.max_drawdown, btc_hodl_dd: hodlDd, btc_trades: m.trades,
      eq_hodl_nav: e.hodl_nav, eq_strat_nav: e.final_nav, eq_strat_x_eq_hodl: e.nav_vs_hodl, eq_strat_x_btc_hodl: e.final_nav / hodl.final_nav_usd, eq_strat_x_btc_strat: e.final_nav / m.final_nav_usd,
      eq_strat_dd: e.max_dd, eq_hodl_dd: e.hodl_max_dd, eq_trades: e.trades, eq_cagr: e.cagr_pct, eq_hodl_cagr: e.hodl_cagr_pct, btc_strat_cagr: m.final_cagr_percent, pct_in_market: e.pct_in_market,
    });
    if (!primary || start === a.start) primary = { start, rows: rep.rows, btc: sim.results };
  }

  console.log("## NAV by start date (all legs lump-sum unless --monthly)");
  console.log("| start | BTC HODL | BTC strat (× HODL) | " + symbol + " HODL | " + symbol + " strat (× " + symbol + " HODL) | " + symbol + " strat ÷ BTC strat | max DD BTC strat / " + symbol + " strat / " + symbol + " HODL | trades BTC / " + symbol + " |");
  console.log("|---|---:|---:|---:|---:|---:|---|---|");
  for (const s of summary) {
    console.log(`| ${s.start} | ${fmtUsd(s.btc_hodl_nav as number)} | ${fmtUsd(s.btc_strat_nav as number)} (${fmtX(s.btc_strat_x_hodl as number, 2)}) | ${fmtUsd(s.eq_hodl_nav as number)} | ${fmtUsd(s.eq_strat_nav as number)} (${fmtX(s.eq_strat_x_eq_hodl as number, 2)}) | ${fmtX(s.eq_strat_x_btc_strat as number, 2)} | ${fmtPct((s.btc_strat_dd as number) * 100, 0)} / ${fmtPct((s.eq_strat_dd as number) * 100, 0)} / ${fmtPct((s.eq_hodl_dd as number) * 100, 0)} | ${s.btc_trades} / ${s.eq_trades} |`);
  }

  // Correlation / beta
  console.log(`\n## Daily log-return relationship ${symbol} vs BTC (common trading days)`);
  console.log("| window | n | corr | beta (" + symbol + " on BTC) | up-capture | down-capture |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const [label, s, e] of [["2017-01 → 2020-08-10 (pre-treasury)", "2017-01-01", "2020-08-10"], ["2020-08-11 → end (BTC treasury era)", "2020-08-11", endAll], ["2024-01 → end", "2024-01-01", endAll], ["2025-01 → end", "2025-01-01", endAll], ["last 250 trading days", bars[Math.max(0, bars.length - 251)].date, endAll]] as const) {
    const { eq, btc } = returnsOnCommonDays(bars, btcPx, s, e);
    const r = corrBeta(btc, eq);
    console.log(`| ${label} | ${r.n} | ${r.corr.toFixed(2)} | ${r.beta.toFixed(2)} | ${r.upCapture.toFixed(2)} | ${r.downCapture.toFixed(2)} |`);
  }

  // Segment hit table (treasury era)
  const segStart = periods.includes("2020-08-11") ? "2020-08-11" : periods[0];
  const segs = segments(primary!.btc.length ? simulateSthCb(btcRows, simParams({ start: segStart, end: endAll, upfront, monthly, sameDay: false, fees: "exchange_only", tradeBps, contribBps: 0, config }), { ledger: false, daily: true }).results : [], bars, segStart, endAll);
  const ins = segs.filter((s) => s.kind === "in" && s.eq_ret !== null), outs = segs.filter((s) => s.kind === "out" && s.eq_ret !== null);
  console.log(`\n## Signal segments ${segStart} → ${endAll} (BTC decides; returns measured on each leg between execution closes)`);
  console.log(`in-market segments: ${ins.length} — median BTC ${fmtPct(median(ins.map((s) => s.btc_ret)) * 100, 1)}, median ${symbol} ${fmtPct(median(ins.map((s) => s.eq_ret!)) * 100, 1)}; ${symbol} beat BTC in ${ins.filter((s) => s.eq_ret! > s.btc_ret).length}/${ins.length}; ${symbol} positive in ${ins.filter((s) => s.eq_ret! > 0).length}/${ins.length}`);
  console.log(`out-of-market gaps: ${outs.length} — median BTC ${fmtPct(median(outs.map((s) => s.btc_ret)) * 100, 1)}, median ${symbol} ${fmtPct(median(outs.map((s) => s.eq_ret!)) * 100, 1)}; ${symbol} fell in ${outs.filter((s) => s.eq_ret! < 0).length}/${outs.length} (BTC fell in ${outs.filter((s) => s.btc_ret < 0).length}/${outs.length})`);
  console.log("\n| kind | from | to | max alloc | BTC | " + symbol + " |");
  console.log("|---|---|---|---:|---:|---:|");
  for (const s of segs.slice(-24)) console.log(`| ${s.kind} | ${s.from} | ${s.to} | ${Math.round(s.alloc * 100)}% | ${fmtPct(s.btc_ret * 100, 1)} | ${s.eq_ret === null ? "–" : fmtPct(s.eq_ret * 100, 1)} |`);

  if (a.csv) {
    await Deno.mkdir(RESULTS_DIR, { recursive: true });
    const ts = timestamp();
    await Deno.writeTextFile(`${RESULTS_DIR}${symbol.toLowerCase()}_overlay_summary_${ts}.csv`, toCsv(summary));
    const btcByDate = new Map(primary!.btc.map((r) => [r.close_date, r]));
    const daily = primary!.rows.map((r) => ({ date: r.date, [`${symbol}_px`]: r.px, target: r.target, action: r.action, [`${symbol}_strat_nav`]: r.nav, [`${symbol}_hodl_nav`]: r.hodl_nav, btc_px: btcByDate.get(r.date)?.price_usd ?? "", btc_strat_nav: btcByDate.get(r.date)?.nav_usd ?? "" }));
    await Deno.writeTextFile(`${RESULTS_DIR}${symbol.toLowerCase()}_overlay_daily_${primary!.start}_${ts}.csv`, toCsv(daily));
    await Deno.writeTextFile(`${RESULTS_DIR}${symbol.toLowerCase()}_overlay_segments_${ts}.csv`, toCsv(segs as unknown as Record<string, unknown>[]));
    console.log(`\nCSV written to ${RESULTS_DIR} (summary, daily from ${primary!.start}, segments)`);
  }
}

if (import.meta.main) await main();
