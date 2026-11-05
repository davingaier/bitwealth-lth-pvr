// tools/sth_cb_lab/fetch_mstr.ts
// Download MicroStrategy (MSTR) daily closes from Yahoo Finance's public chart endpoint (no key) into
// data/mstr_daily.json. Uses split-adjusted closes (10:1 split on 2024-08-08) so the series is continuous.
//
//   deno run -A tools/sth_cb_lab/fetch_mstr.ts [--symbol MSTR] [--from 2014-01-01]
//
// The same script works for any Yahoo ticker (e.g. --symbol MSTU for the 2× ETF) — the file name follows the symbol.

import { LAB_DIR, parseArgs } from "./lab_core.ts";

export interface EquityBar { date: string; close: number; adj_close: number; volume: number }
export interface EquityFile { symbol: string; fetched_at: string; from: string; to: string; splits: string[]; rows: EquityBar[] }

export function equityFile(symbol: string): string {
  return `${LAB_DIR}data/${symbol.toLowerCase()}_daily.json`;
}

export async function loadEquity(symbol: string): Promise<EquityFile> {
  try {
    return JSON.parse(await Deno.readTextFile(equityFile(symbol))) as EquityFile;
  } catch {
    throw new Error(`No cached ${symbol} series. Run: deno run -A tools/sth_cb_lab/fetch_mstr.ts --symbol ${symbol}`);
  }
}

async function main() {
  const a = parseArgs(Deno.args);
  const symbol = String(a.symbol ?? "MSTR").toUpperCase();
  const from = String(a.from ?? "2014-01-01");
  const p1 = Math.floor(Date.parse(from) / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86_400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1d&events=split`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp?.length) throw new Error(`Yahoo returned no bars for ${symbol}: ${JSON.stringify(j?.chart?.error ?? j).slice(0, 300)}`);
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose ?? q.close;
  const rows: EquityBar[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const close = q.close[i], ac = adj[i];
    if (!Number.isFinite(close) || !Number.isFinite(ac)) continue;
    // Yahoo stamps bars at the exchange open (US/Eastern); the UTC date of the timestamp is the trading date.
    const date = new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10);
    rows.push({ date, close: Number(close), adj_close: Number(ac), volume: Number(q.volume?.[i] ?? 0) });
  }
  const splits = Object.values(r.events?.splits ?? {}).map((s: unknown) => {
    const x = s as { date: number; splitRatio: string };
    return `${new Date(x.date * 1000).toISOString().slice(0, 10)} ${x.splitRatio}`;
  });
  const out: EquityFile = { symbol, fetched_at: new Date().toISOString(), from: rows[0].date, to: rows[rows.length - 1].date, splits, rows };
  await Deno.mkdir(`${LAB_DIR}data`, { recursive: true });
  await Deno.writeTextFile(equityFile(symbol), JSON.stringify(out));
  console.log(`${symbol}: ${rows.length} bars ${out.from} → ${out.to}; splits: ${splits.join(", ") || "none"}; last adj close ${rows[rows.length - 1].adj_close.toFixed(2)}`);
}

if (import.meta.main) await main();
