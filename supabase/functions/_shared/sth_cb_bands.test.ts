// sth_cb_bands.test.ts
// Run with: deno test supabase/functions/_shared/sth_cb_bands.test.ts

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { bandColumn, bandSpecString, computeSthCbBands, parseBandSpec, SthCbBandInput } from "./sth_cb_bands.ts";

function series(n: number, f: (i: number) => Partial<SthCbBandInput>): SthCbBandInput[] {
  return Array.from({ length: n }, (_, i) => ({
    close_date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    px: 10_000, cb: 10_000, sth_supply: 1_000_000, ...f(i),
  }));
}

Deno.test("bandColumn naming matches lth_pvr band tables", () => {
  assertEquals(bandColumn(0), "price_at_mean");
  assertEquals(bandColumn(-1), "price_at_m100");
  assertEquals(bandColumn(-0.75), "price_at_m075");
  assertEquals(bandColumn(2.5), "price_at_p250");
  assertEquals(bandColumn(0.5), "price_at_p050");
});

Deno.test("parse/format band specs round-trip", () => {
  assertEquals(parseBandSpec("sth_pvr"), { mode: "sth_pvr", window: 0, scale: "auto" });
  assertEquals(parseBandSpec("sth_pvr:1.5"), { mode: "sth_pvr", window: 0, scale: 1.5 });
  assertEquals(parseBandSpec("ratio_sigma:365"), { mode: "ratio_sigma", window: 365, scale: 1 });
  assertEquals(bandSpecString(parseBandSpec("ratio_sigma:180:0.75")), "ratio_sigma:180:0.75");
});

Deno.test("mean band always equals the STH cost basis; bands are NaN until enough observations", () => {
  const rows = series(60, (i) => ({ px: 10_000 + i * 50, cb: 9_000 + i * 10 }));
  const out = computeSthCbBands(rows, { mode: "ratio_sigma", window: 0, scale: 1 });
  assertEquals(out[5].price_at_mean, rows[5].cb);
  assert(Number.isNaN(out[5].price_at_p100 as number), "no bands before MIN_OBS");
  assert(Number.isFinite(out[59].price_at_p100 as number));
});

Deno.test("ratio_sigma bands are symmetric in log space and scale with the multiplier", () => {
  const rows = series(400, (i) => ({ px: 10_000 * Math.exp(0.2 * Math.sin(i / 20)), cb: 10_000 }));
  const a = computeSthCbBands(rows, { mode: "ratio_sigma", window: 365, scale: 1 });
  const b = computeSthCbBands(rows, { mode: "ratio_sigma", window: 365, scale: 2 });
  const r = a[399];
  const up = Math.log((r.price_at_p100 as number) / (r.price_at_mean as number));
  const dn = Math.log((r.price_at_mean as number) / (r.price_at_m100 as number));
  assertAlmostEquals(up, dn, 1e-9);
  const up2 = Math.log((b[399].price_at_p100 as number) / (b[399].price_at_mean as number));
  assertAlmostEquals(up2, 2 * up, 1e-9);
  // +2σ is twice +1σ in log space
  const up200 = Math.log((r.price_at_p200 as number) / (r.price_at_mean as number));
  assertAlmostEquals(up200, 2 * up, 1e-9);
});

Deno.test("sth_pvr bands: +1σ corresponds to STH PVR = +1 (scale 1) and are linear", () => {
  const rows = series(200, (i) => ({ px: 10_000 + 2_000 * Math.sin(i / 15), cb: 10_000, sth_supply: 1_000_000 + i * 1000 }));
  const out = computeSthCbBands(rows, { mode: "sth_pvr", window: 0, scale: 1 });
  const r = out[199];
  const unit = r.sigma_unit_usd as number;
  assert(unit > 0);
  assertAlmostEquals((r.price_at_p100 as number) - (r.price_at_mean as number), unit, 1e-6);
  assertAlmostEquals((r.price_at_mean as number) - (r.price_at_m100 as number), unit, 1e-6);
  assertAlmostEquals((r.price_at_p250 as number) - (r.price_at_mean as number), 2.5 * unit, 1e-6);
  // sth_pvr reported = (px − cb) / raw unit
  assertAlmostEquals(r.sth_pvr as number, (r.btc_price_usd - (r.price_at_mean as number)) / unit, 1e-6);
});

Deno.test("sth_pvr 'auto' scale uses the expanding std of the STH PVR series", () => {
  const rows = series(300, (i) => ({ px: 10_000 + 3_000 * Math.sin(i / 10), cb: 10_000 }));
  const one = computeSthCbBands(rows, { mode: "sth_pvr", window: 0, scale: 1 });
  const auto = computeSthCbBands(rows, { mode: "sth_pvr", window: 0, scale: "auto" });
  const pvr = one.map((r) => r.sth_pvr as number).filter((v) => Number.isFinite(v));
  const mean = pvr.reduce((a, b) => a + b, 0) / pvr.length;
  const std = Math.sqrt(pvr.reduce((a, b) => a + (b - mean) ** 2, 0) / (pvr.length - 1));
  const unitOne = one[299].sigma_unit_usd as number;
  const unitAuto = auto[299].sigma_unit_usd as number;
  assertAlmostEquals(unitAuto / unitOne, std, 1e-6);
});

Deno.test("linear bands below zero are suppressed (NaN) so they can never trigger", () => {
  const rows = series(100, () => ({ px: 100, cb: 100, sth_supply: 10 }));
  // zero volatility → std 0 → no bands at all
  const out = computeSthCbBands(rows, { mode: "sth_pvr", window: 0, scale: 50 });
  assert(Number.isNaN(out[99].price_at_m100 as number) || (out[99].price_at_m100 as number) > 0);
});
