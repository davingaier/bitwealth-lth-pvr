// Shared helper for the CI -> RB bands migration (started 2026-05-19).
//
// Every edge function that reads LTH PVR band data accepts an optional
// `band_source` parameter ('ci' | 'rb') and routes its DB queries through
// `bandsTableForSource()`. During the migration window, individual functions
// flip their default from 'ci' to 'rb' phase-by-phase; the helper keeps that
// switch a one-line change instead of a find-and-replace across the codebase.

export type BandSource = "ci" | "rb";

/**
 * Resolve the table name in `lth_pvr` that holds bands for the given source.
 * Falls back to 'ci' for any unrecognised / undefined input so that callers
 * which haven't been updated yet keep working unchanged.
 */
export function bandsTableForSource(source: string | null | undefined): "ci_bands_daily" | "rb_bands_daily" {
  return normaliseBandSource(source) === "rb" ? "rb_bands_daily" : "ci_bands_daily";
}

/**
 * Normalise arbitrary input to a strict BandSource value, defaulting to 'ci'.
 * Use this when persisting `band_source` onto output rows so the value matches
 * the CHECK constraint on the target tables.
 */
export function normaliseBandSource(source: string | null | undefined): BandSource {
  return String(source ?? "").toLowerCase() === "rb" ? "rb" : "ci";
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
