// sth_cb_bands.ts
// ===========================================================================
// "sth_cb" band source for the LTH PVR engine.
//
// Mean band  = STH cost basis (Research Bitcoin realized_price_sth).
// ±kσ bands  = mean ± k × σ-unit, where the σ-unit is one of two definitions:
//
//   mode "sth_pvr"      (faithful analogue of the LTH PVR bands)
//     unit_t = expanding std-dev of STH market cap (supply × price) ÷ STH supply
//     so price_at_p100 is exactly the price at which the STH PVR = +1 (× scale).
//     Linear bands:  price_at_±k = cb ± k · scale · unit_t
//     scale = number, or "auto" = expanding std-dev of the STH PVR series itself
//     (mirrors ChartInspect's pvr_std used for the LTH bands).
//
//   mode "ratio_sigma"  (regime-adaptive)
//     σ_t = std-dev of ln(price / cb) over the last `window` days (0 = expanding)
//     Log bands:     price_at_±k = cb · exp(±k · scale · σ_t)
//
// Output rows carry the same column names as lth_pvr_bt.v_backtest_prices_rb so
// they drop straight into decideTrade / runSimulation / ef_bt_execute.
// Used by: tools/sth_cb_lab (optimisation), ef_fetch_onchain_pvr (daily append
// into lth_pvr.sth_cb_bands_daily), docs/… backfill.
// ===========================================================================

export type SthCbBandMode = "sth_pvr" | "ratio_sigma";

export interface SthCbBandParams {
  mode: SthCbBandMode;
  /** ratio_sigma only: rolling window in days (0 = expanding). Ignored for sth_pvr. */
  window: number;
  /** σ multiplier; "auto" (sth_pvr only) = expanding std of the STH PVR series. */
  scale: number | "auto";
}

export const DEFAULT_STH_CB_BAND_PARAMS: SthCbBandParams = { mode: "sth_pvr", window: 0, scale: "auto" };

export interface SthCbBandInput {
  close_date: string;   // YYYY-MM-DD
  px: number;           // BTC close
  cb: number;           // STH cost basis (realized price)
  sth_supply?: number;  // BTC held by STH cohort (required for mode sth_pvr)
}

/** Sigma multipliers we materialise. Column suffix: m100 = −1.00σ, p250 = +2.50σ, mean = 0. */
export const BAND_SIGMAS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 9] as const;

export function bandColumn(sigma: number): string {
  if (sigma === 0) return "price_at_mean";
  const k = Math.abs(Math.round(sigma * 100)).toString().padStart(3, "0");
  return sigma < 0 ? `price_at_m${k}` : `price_at_p${k}`;
}

export interface SthCbBandRow {
  close_date: string;
  btc_price_usd: number;
  sth_cost_basis_usd: number;
  sigma_unit_usd: number;      // $ per 1σ at this date (after scale)
  sth_pvr: number | null;      // (px − cb)/raw unit, mode sth_pvr only
  [band: string]: number | string | null;
}

// Welford (sample std, ddof=1)
interface W { n: number; mean: number; m2: number }
const wUpd = (s: W, x: number): W => {
  const n = s.n + 1, d = x - s.mean, mean = s.mean + d / n;
  return { n, mean, m2: s.m2 + d * (x - mean) };
};
const wStd = (s: W) => (s.n < 2 ? 0 : Math.sqrt(s.m2 / (s.n - 1)));

/**
 * Compute band rows for the whole series (ascending by date). Rows before the
 * σ-unit becomes defined (first ~30 observations) get NaN bands and are skipped
 * by decideTrade (fin() guards), i.e. no trades.
 */
export function computeSthCbBands(rows: SthCbBandInput[], p: SthCbBandParams = DEFAULT_STH_CB_BAND_PARAMS): SthCbBandRow[] {
  const out: SthCbBandRow[] = new Array(rows.length);
  const MIN_OBS = 30;

  if (p.mode === "sth_pvr") {
    let wMc: W = { n: 0, mean: 0, m2: 0 };
    let wPvr: W = { n: 0, mean: 0, m2: 0 };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const supply = Number(r.sth_supply);
      const ok = r.px > 0 && r.cb > 0 && supply > 0;
      let rawUnit = NaN, pvr: number | null = null;
      if (ok) {
        wMc = wUpd(wMc, r.px * supply);
        const std = wStd(wMc);
        if (wMc.n >= MIN_OBS && std > 0) {
          rawUnit = std / supply;
          pvr = (r.px - r.cb) / rawUnit;
          wPvr = wUpd(wPvr, pvr);
        }
      }
      const scale = p.scale === "auto" ? (wPvr.n >= MIN_OBS ? wStd(wPvr) : NaN) : Number(p.scale);
      const unit = rawUnit * scale;
      out[i] = makeRow(r, unit, pvr, (k) => (Number.isFinite(unit) ? r.cb + k * unit : NaN));
    }
    return out;
  }

  // ratio_sigma
  const win = Math.max(0, Math.trunc(p.window));
  const scale = p.scale === "auto" ? 1 : Number(p.scale);
  const logs: number[] = [];
  let sum = 0, sumSq = 0;           // rolling accumulators
  let wAll: W = { n: 0, mean: 0, m2: 0 }; // expanding
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ok = r.px > 0 && r.cb > 0;
    let sigma = NaN;
    if (ok) {
      const x = Math.log(r.px / r.cb);
      if (win > 0) {
        logs.push(x); sum += x; sumSq += x * x;
        if (logs.length > win) { const old = logs.shift()!; sum -= old; sumSq -= old * old; }
        const n = logs.length;
        if (n >= Math.min(MIN_OBS, win)) {
          const mean = sum / n;
          const v = Math.max(0, (sumSq - n * mean * mean) / Math.max(1, n - 1));
          sigma = Math.sqrt(v);
        }
      } else {
        wAll = wUpd(wAll, x);
        if (wAll.n >= MIN_OBS) sigma = wStd(wAll);
      }
    }
    const s = sigma * scale;
    const unitUsd = Number.isFinite(s) ? r.cb * (Math.exp(s) - 1) : NaN; // $ for +1σ (informational)
    out[i] = makeRow(r, unitUsd, null, (k) => (Number.isFinite(s) ? r.cb * Math.exp(k * s) : NaN));
  }
  return out;
}

function makeRow(r: SthCbBandInput, unit: number, pvr: number | null, at: (k: number) => number): SthCbBandRow {
  const row: SthCbBandRow = {
    close_date: r.close_date,
    btc_price_usd: r.px,
    sth_cost_basis_usd: r.cb,
    sigma_unit_usd: unit,
    sth_pvr: pvr,
    price_at_mean: r.cb,
  };
  for (const k of BAND_SIGMAS) {
    const lo = at(-k);
    // negative bands below zero are meaningless (linear mode) — clamp to NaN so they never trigger
    row[bandColumn(-k)] = Number.isFinite(lo) && lo > 0 ? lo : NaN;
    row[bandColumn(k)] = at(k);
  }
  return row;
}

/** Parse "sth_pvr", "sth_pvr:1.5", "sth_pvr:auto", "ratio_sigma:365", "ratio_sigma:365:1.25". */
export function parseBandSpec(spec: string | undefined | null): SthCbBandParams {
  if (!spec) return { ...DEFAULT_STH_CB_BAND_PARAMS };
  const [mode, a, b] = String(spec).split(":");
  if (mode === "ratio_sigma") {
    return { mode, window: a ? Number(a) : 365, scale: b ? Number(b) : 1 };
  }
  return { mode: "sth_pvr", window: 0, scale: a === undefined || a === "auto" ? "auto" : Number(a) };
}

export function bandSpecString(p: SthCbBandParams): string {
  return p.mode === "ratio_sigma" ? `ratio_sigma:${p.window}:${p.scale}` : `sth_pvr:${p.scale}`;
}
