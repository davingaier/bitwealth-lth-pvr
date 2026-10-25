// Shared helper for LTH PVR band sources (started with the CI -> RB migration, 2026-05-19).
//
// Every edge function that reads LTH PVR band data accepts an optional
// `band_source` parameter and routes its DB queries through `bandsTableForSource()`.
//
//   'rb'     — Research Bitcoin LTH PVR bands (live default since 2026-05-19)
//   'ci'     — CryptoQuant/ChartInspect LTH PVR bands (frozen 2026-05-19, historical reference)
//   'sth_cb' — mean = STH cost basis, ±σ bands (added 2026-10-25; back-tester only, no live pipeline)

export type BandSource = "ci" | "rb" | "sth_cb";

export type BandsTable = "ci_bands_daily" | "rb_bands_daily" | "sth_cb_bands_daily";

/**
 * Resolve the table name in `lth_pvr` that holds bands for the given source.
 * Falls back to 'ci' for any unrecognised / undefined input so that callers
 * which haven't been updated yet keep working unchanged.
 */
export function bandsTableForSource(source: string | null | undefined): BandsTable {
  const s = normaliseBandSource(source);
  return s === "rb" ? "rb_bands_daily" : s === "sth_cb" ? "sth_cb_bands_daily" : "ci_bands_daily";
}

/** Back-tester view in `lth_pvr_bt` for the given source. */
export function backtestPricesViewForSource(source: string | null | undefined): "v_backtest_prices" | "v_backtest_prices_rb" | "v_backtest_prices_sth_cb" {
  const s = normaliseBandSource(source);
  return s === "rb" ? "v_backtest_prices_rb" : s === "sth_cb" ? "v_backtest_prices_sth_cb" : "v_backtest_prices";
}

/**
 * Normalise arbitrary input to a strict BandSource value, defaulting to 'ci'.
 * Use this when persisting `band_source` onto output rows so the value matches
 * the CHECK constraint on the target tables.
 */
export function normaliseBandSource(source: string | null | undefined): BandSource {
  const s = String(source ?? "").toLowerCase();
  return s === "rb" ? "rb" : s === "sth_cb" ? "sth_cb" : "ci";
}

/**
 * Extract a band_source value from an edge-function request payload, honouring
 * the per-function default. Accepts `band_source`, `source`, or `p_source`
 * (latter matches the existing RPC parameter name).
 */
export function readBandSourceFromBody(
  body: Record<string, unknown> | null | undefined,
  fallback: BandSource = "ci",
): BandSource {
  if (!body) return fallback;
  const raw = body.band_source ?? body.source ?? body.p_source;
  if (raw === undefined || raw === null || raw === "") return fallback;
  return normaliseBandSource(String(raw));
}
