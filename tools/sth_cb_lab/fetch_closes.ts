// tools/sth_cb_lab/fetch_closes.ts
// Build a TRUE UTC daily-close BTC series and write data/series_close.json (same shape as data/series.json, so every
// lab script can run on it via --series close). Nothing in production is touched.
//
//   Binance BTCUSDT 1d close    2017-08-17 → today   (operator's choice, 2026-11-06)
//   RB price/price @ h1, 23:00Z bar   2011 → 2017-08-16   (Binance does not exist yet; RB hourly is the only
//                                                          source we have that far back; validated against Binance
//                                                          over the overlap — see --validate)
//
// Why: RB's d1 `price/price` is a daily AVERAGE (matches Binance daily VWAP to ±0.3 %), not a close. The STH CB
// cost basis and bands are left untouched; only `px` changes.
//
//   deno run -A tools/sth_cb_lab/fetch_closes.ts            # writes data/series_close.json
//   deno run -A tools/sth_cb_lab/fetch_closes.ts --validate # also prints RB-23:00 vs Binance-close stats on the overlap

import { DATA_FILE, LAB_DIR, loadEnv, parseArgs } from "./lab_core.ts";
import { SthCbSeriesRow } from "../../supabase/functions/_shared/sth_cb_simulator.ts";

const BINANCE_START = "2017-08-17";
const OUT = `${LAB_DIR}data/series_close.json`;

async function binanceCloses(from: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let start = Date.parse(from);
  for (;;) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${start}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`binance ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as unknown[][];
    if (!rows.length) break;
    for (const r of rows) {
      const d = new Date(Number(r[0])).toISOString().slice(0, 10);
      const closeTime = Number(r[6]);
      if (closeTime > Date.now()) continue; // today's candle is still open — skip
      out.set(d, Number(r[4]));
    }
    const last = Number(rows[rows.length - 1][0]);
    if (rows.length < 1000) break;
    start = last + 86_400_000;
  }
  return out;
}

async function rbHourlyCloses(token: string, from: string, to: string): Promise<Map<string, number>> {
  // RB caps ranges; walk in ~180-day chunks. Keep the 23:00Z bar of each day.
  const out = new Map<string, number>();
  let cur = new Date(from);
  const end = new Date(to);
  while (cur < end) {
    const next = new Date(Math.min(cur.getTime() + 180 * 86_400_000, end.getTime()));
    const params = new URLSearchParams({ resolution: "h1", from_time: cur.toISOString().slice(0, 10), to_time: next.toISOString().slice(0, 10) });
    const res = await fetch(`https://api.researchbitcoin.net/v2/price/price?${params}`, { headers: { "X-API-Token": token, Accept: "text/csv" } });
    if (!res.ok) throw new Error(`RB h1 ${res.status}: ${await res.text()}`);
    const lines = (await res.text()).trim().split("\n").slice(1);
    for (const l of lines) {
      const [ts, v] = l.split(",");
      if (ts.slice(11, 13) === "23") out.set(ts.slice(0, 10), parseFloat(v));
    }
    cur = next;
  }
  return out;
}

async function main() {
  const a = parseArgs(Deno.args);
  const base = JSON.parse(await Deno.readTextFile(DATA_FILE)); // RB averaged series (px) + cb + bands — keep everything but px
  const env = await loadEnv();
  const { data: tokRows } = await fetch(`${env.url}/rest/v1/rb_api_token?select=token&order=expires_at.desc&limit=1`, {
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Accept-Profile": "lth_pvr" },
  }).then(async (r) => ({ data: (await r.json()) as { token: string }[] }));
  const rbToken = tokRows?.[0]?.token;
  if (!rbToken) throw new Error("no RB token in lth_pvr.rb_api_token");

  console.log("fetching Binance 1d closes…");
  const bin = await binanceCloses(BINANCE_START);
  console.log(`  ${bin.size} Binance days (${[...bin.keys()][0]} → ${[...bin.keys()].at(-1)})`);
  console.log("fetching RB hourly 23:00 bars for the pre-Binance era (and overlap for validation)…");
  const rbh = await rbHourlyCloses(rbToken, base.from, a.validate ? base.to : BINANCE_START);
  console.log(`  ${rbh.size} RB 23:00 bars`);

  if (a.validate) {
    const diffs: number[] = [];
    for (const [d, c] of bin) { const h = rbh.get(d); if (h) diffs.push(h / c - 1); }
    diffs.sort((x, y) => x - y);
    const abs = diffs.map(Math.abs);
    const mean = abs.reduce((s, v) => s + v, 0) / abs.length;
    const p = (q: number) => abs.sort((x, y) => x - y)[Math.floor(q * (abs.length - 1))];
    console.log(`validation (RB 23:00 bar vs Binance UTC close, ${diffs.length} overlapping days):`);
    console.log(`  mean |diff| ${(mean * 100).toFixed(3)} %   p50 ${(p(0.5) * 100).toFixed(3)} %   p95 ${(p(0.95) * 100).toFixed(3)} %   max ${(p(1) * 100).toFixed(3)} %`);
  }

  let fromBinance = 0, fromRb = 0, missing = 0, lastPx = 0;
  const rows: SthCbSeriesRow[] = base.rows.map((r) => {
    let px: number | undefined;
    if (r.close_date >= BINANCE_START && bin.has(r.close_date)) { px = bin.get(r.close_date); fromBinance++; }
    else if (rbh.has(r.close_date)) { px = rbh.get(r.close_date); fromRb++; }
    if (px === undefined || !Number.isFinite(px) || px <= 0) { missing++; px = lastPx || r.px; }
    lastPx = px;
    return { ...r, px };
  }).filter((r) => r.close_date <= [...bin.keys()].at(-1)!);

  const out = { ...base, fetched_at: new Date().toISOString(), to: rows.at(-1)!.close_date, price_source: "binance_utc_close+rb_h1_2300_pre_2017-08-17", rows };
  await Deno.writeTextFile(OUT, JSON.stringify(out));
  console.log(`wrote ${OUT}: ${rows.length} rows, ${fromBinance} Binance closes, ${fromRb} RB 23:00 bars, ${missing} forward-filled`);
}

if (import.meta.main) await main();
