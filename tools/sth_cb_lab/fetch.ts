// tools/sth_cb_lab/fetch.ts
// Pull the STH cost basis + price series (and LTH PVR upper bands for idea 4)
// once and cache them locally. Re-run whenever you want fresher data.
//
//   deno run -A tools/sth_cb_lab/fetch.ts [--from 2011-01-01]

import { DATA_FILE, loadEnv, parseArgs, SeriesFile } from "./lab_core.ts";
import { SthCbSeriesRow } from "../../supabase/functions/_shared/sth_cb_simulator.ts";

const args = parseArgs(Deno.args);
const from = String(args.from ?? "2011-01-01");
const { url, key, orgId } = await loadEnv();
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function pageRest(path: string, build: (offset: number) => string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const resp = await fetch(`${url}/rest/v1/${path}${build(offset)}`, { headers, method: path.startsWith("rpc/") ? "POST" : "GET", body: path.startsWith("rpc/") ? JSON.stringify({ p_from: from }) : undefined });
    if (!resp.ok) throw new Error(`${path} → HTTP ${resp.status}: ${await resp.text()}`);
    const page = await resp.json() as Record<string, unknown>[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

console.log(`Fetching STH cost basis series from ${from}…`);
const cb = await pageRest("rpc/get_sth_cost_basis_series", (o) => `?order=close_date.asc&limit=1000&offset=${o}`);
console.log(`  ${cb.length} rows (${cb[0]?.close_date} → ${cb.at(-1)?.close_date})`);

console.log("Fetching LTH PVR RB bands (for distributeAtSigma)…");
const bandHeaders = { ...headers, "Accept-Profile": "lth_pvr_bt" };
const bands: Record<string, unknown>[] = [];
for (let offset = 0; ; offset += 1000) {
  const resp = await fetch(
    `${url}/rest/v1/v_backtest_prices_rb?select=close_date,price_at_p050,price_at_p100,price_at_p150,price_at_p200,price_at_p250&org_id=eq.${orgId}&close_date=gte.${from}&order=close_date.asc&limit=1000&offset=${offset}`,
    { headers: bandHeaders },
  );
  if (!resp.ok) { console.warn(`  bands unavailable (HTTP ${resp.status}) — idea 4 will be inert`); break; }
  const page = await resp.json() as Record<string, unknown>[];
  bands.push(...page);
  if (page.length < 1000) break;
}
console.log(`  ${bands.length} band rows`);
const bandMap = new Map(bands.map((b) => [String(b.close_date), {
  p050: Number(b.price_at_p050), p100: Number(b.price_at_p100), p150: Number(b.price_at_p150),
  p200: Number(b.price_at_p200), p250: Number(b.price_at_p250),
}]));

const rows: SthCbSeriesRow[] = cb
  .map((r) => ({
    close_date: String(r.close_date),
    px: Number(r.btc_price_usd),
    cb: Number(r.sth_cost_basis_usd),
    bands: bandMap.get(String(r.close_date)),
  }))
  .filter((r) => r.px > 0 && r.cb > 0);

const file: SeriesFile = { fetched_at: new Date().toISOString(), from: rows[0].close_date, to: rows.at(-1)!.close_date, rows };
await Deno.mkdir(DATA_FILE.replace(/series\.json$/, ""), { recursive: true });
await Deno.writeTextFile(DATA_FILE, JSON.stringify(file));
console.log(`Saved ${rows.length} rows → ${DATA_FILE}`);
