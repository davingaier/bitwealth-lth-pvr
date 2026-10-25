// sth_cb_bands_db.ts
// Recompute the "sth_cb" band source (mean = STH cost basis ± σ bands) from
// lth_pvr.onchain_pvr_daily and upsert into lth_pvr.sth_cb_bands_daily.
//
// The band statistics are expanding (Welford) so, rather than persisting running
// state, we recompute the whole series in memory (≈6 k rows, milliseconds) and
// upsert only the dates requested. Called by ef_fetch_onchain_pvr after each
// daily append (and with fromDate=null for a full backfill).

import { computeSthCbBands, DEFAULT_STH_CB_BAND_PARAMS, SthCbBandParams, BAND_SIGMAS, bandColumn } from "./sth_cb_bands.ts";

// deno-lint-ignore no-explicit-any
type Sb = any;

/** Columns persisted in lth_pvr.sth_cb_bands_daily (subset of BAND_SIGMAS that the table has). */
export const PERSISTED_SIGMAS = [-1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 9];

export async function loadSthCbBandParams(sb: Sb, orgId: string): Promise<SthCbBandParams> {
  const { data } = await sb.schema("lth_pvr").from("sth_cb_band_params").select("mode, window_days, scale").eq("org_id", orgId).maybeSingle();
  if (!data) return { ...DEFAULT_STH_CB_BAND_PARAMS };
  const scale = String(data.scale ?? "auto");
  return {
    mode: data.mode === "ratio_sigma" ? "ratio_sigma" : "sth_pvr",
    window: Number(data.window_days ?? 0),
    scale: scale === "auto" ? "auto" : Number(scale),
  };
}

export async function refreshSthCbBands(sb: Sb, orgId: string, fromDate: string | null): Promise<{ rows_written: number; params: SthCbBandParams; last_date: string | null }> {
  const params = await loadSthCbBandParams(sb, orgId);

  // Load the full STH series (expanding stats need all history)
  const src: Array<{ date: string; btc_price: number; sth_realized_price: number; sth_supply: number }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.schema("lth_pvr").from("onchain_pvr_daily")
      .select("date, btc_price, sth_realized_price, sth_supply")
      .eq("org_id", orgId).order("date", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`onchain_pvr_daily read failed: ${error.message}`);
    if (!data?.length) break;
    src.push(...data);
    if (data.length < 1000) break;
  }
  const inputs = src
    .map((r) => ({ close_date: String(r.date), px: Number(r.btc_price), cb: Number(r.sth_realized_price), sth_supply: Number(r.sth_supply) }))
    .filter((r) => r.px > 0 && r.cb > 0);
  const bands = computeSthCbBands(inputs, params);

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const rows = bands
    .filter((b) => !fromDate || b.close_date >= fromDate)
    .map((b) => {
      const row: Record<string, unknown> = {
        org_id: orgId,
        date: b.close_date,
        btc_price: b.btc_price_usd,
        sth_cost_basis: b.sth_cost_basis_usd,
        sigma_unit_usd: num(b.sigma_unit_usd),
        sth_pvr: num(b.sth_pvr),
        band_mode: params.mode,
        band_window_days: params.window,
        band_scale: String(params.scale),
        computed_at: new Date().toISOString(),
      };
      for (const k of PERSISTED_SIGMAS) {
        if (k !== 0 && !(BAND_SIGMAS as readonly number[]).includes(Math.abs(k))) continue;
        row[bandColumn(k)] = num(b[bandColumn(k)]);
      }
      return row;
    });

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.schema("lth_pvr").from("sth_cb_bands_daily").upsert(rows.slice(i, i + 500), { onConflict: "org_id,date" });
    if (error) throw new Error(`sth_cb_bands_daily upsert failed: ${error.message}`);
  }
  return { rows_written: rows.length, params, last_date: rows.at(-1)?.date as string ?? null };
}
