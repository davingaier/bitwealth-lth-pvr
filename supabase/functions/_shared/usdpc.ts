// _shared/usdpc.ts — Single source of truth for USDPC yield-stablecoin math.
//
// USDPC is a yield-bearing stablecoin on VALR (~10% p.a.). Idle cash that would
// otherwise sit in USDT is swept into USDPC so it keeps growing while a client is
// out of BTC (e.g. at cycle tops, ~100% cash for a year+).
//
// Conversion rules (live pipeline):
//   - BEFORE every BTC buy: convert just-enough USDPC -> USDT (incl. taker fee)
//     to fund the buy.
//   - AFTER every BTC sell into USDT: sweep ALL idle USDT -> USDPC.
//
// VALR market: pair "USDPC/USDT" (normalised "USDPCUSDT").
//   price = USDT per 1 USDPC. As USDPC appreciates, price drifts above 1.0.
//   USDT -> USDPC  == BUY  USDPCUSDT (spend quote USDT)
//   USDPC -> USDT  == SELL USDPCUSDT (sell base USDPC)
//
// Conversions execute as MARKET (taker) orders at a 0.1% taker fee by default
// (instant fill so the pre-buy conversion can be performed synchronously).
//
// This module is intentionally dependency-light: the pure math helpers are reused
// by the live pipeline AND by the back-tester / simulator / optimizer, so the
// numbers stay identical across all systems.

// ── Defaults (overridable via lth_pvr.settings) ──────────────────────────────
export const USDPC_PAIR = "USDPC/USDT";
export const USDPC_DEFAULT_TAKER_FEE_RATE = 0.001; // 0.10%
export const USDPC_DEFAULT_APY = 0.10;             // 10% p.a. (simulators)
export const USDPC_DEFAULT_MIN_ORDER_USDT = 5;     // dust threshold; below this we stay in USDT

// VALR per-order size caps for the USDPC/USDT market. A single market order may
// not spend more than ~10 000 USDT (quote) nor sell more than ~46 000 USDPC
// (base). Conversions above these caps must be split into multiple orders.
// Slightly conservative defaults leave headroom for price drift / rounding.
export const USDPC_DEFAULT_MAX_QUOTE_USDT = 10000;  // max USDT spend per BUY order
export const USDPC_DEFAULT_MAX_BASE_USDPC = 46000;  // max USDPC sold per SELL order

export interface UsdpcConfig {
  pair: string;
  takerFeeRate: number;
  minOrderUsdt: number;
  defaultApy: number;
  /** Max USDT (quote) spendable in a single USDPC BUY order on VALR. */
  maxQuoteUsdt: number;
  /** Max USDPC (base) sellable in a single USDPC SELL order on VALR. */
  maxBaseUsdpc: number;
}

export const USDPC_DEFAULT_CONFIG: UsdpcConfig = {
  pair: USDPC_PAIR,
  takerFeeRate: USDPC_DEFAULT_TAKER_FEE_RATE,
  minOrderUsdt: USDPC_DEFAULT_MIN_ORDER_USDT,
  defaultApy: USDPC_DEFAULT_APY,
  maxQuoteUsdt: USDPC_DEFAULT_MAX_QUOTE_USDT,
  maxBaseUsdpc: USDPC_DEFAULT_MAX_BASE_USDPC,
};

/**
 * Split a conversion `total` into per-order chunks each ≤ `maxPerChunk`, so a
 * large USDPC conversion respects VALR's per-order size cap. Returns chunk sizes
 * (summing to `total`) rounded to `decimals`. The final chunk absorbs rounding
 * remainder so the chunks always sum back to `total`.
 *
 *   splitConversionAmount(25000, 10000)         -> [10000, 10000, 5000]
 *   splitConversionAmount(8000, 10000)          -> [8000]
 */
export function splitConversionAmount(
  total: number,
  maxPerChunk: number,
  decimals = 8,
): number[] {
  if (!(total > 0)) return [];
  if (!(maxPerChunk > 0) || total <= maxPerChunk) return [round(total, decimals)];
  const chunks: number[] = [];
  let remaining = total;
  while (remaining > maxPerChunk + 1e-9) {
    chunks.push(round(maxPerChunk, decimals));
    remaining -= maxPerChunk;
  }
  chunks.push(round(remaining, decimals));
  return chunks;
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}


// ── Pure conversion math ─────────────────────────────────────────────────────

export interface UsdtToUsdpcResult {
  /** USDPC units received after the taker fee. */
  usdpcReceived: number;
  /** Taker fee, expressed in USDPC units (fee is charged in the bought asset). */
  feeUsdpc: number;
}

/**
 * Convert a USDT amount into USDPC (a BUY on USDPCUSDT spending `usdtAmount` of quote).
 * Fee is taken in the bought asset (USDPC), matching VALR taker semantics.
 */
export function sizeUsdtToUsdpc(
  usdtAmount: number,
  price: number,
  feeRate: number = USDPC_DEFAULT_TAKER_FEE_RATE,
): UsdtToUsdpcResult {
  if (!(usdtAmount > 0) || !(price > 0)) return { usdpcReceived: 0, feeUsdpc: 0 };
  const gross = usdtAmount / price;
  const feeUsdpc = gross * feeRate;
  return { usdpcReceived: gross - feeUsdpc, feeUsdpc };
}

export interface UsdpcToUsdtResult {
  /** USDPC units that must be sold to net `usdtNeeded`. */
  usdpcToSell: number;
  /** USDT actually received (== usdtNeeded when not capped by balance). */
  usdtReceived: number;
  /** Taker fee, expressed in USDT (fee is charged in the received asset). */
  feeUsdt: number;
}

/**
 * Size a USDPC -> USDT conversion (a SELL on USDPCUSDT) so the net USDT received
 * equals `usdtNeeded`. Fee is taken in the received asset (USDT).
 *
 * Caps at `usdpcAvailable`: if the holding can't cover the need, sell everything
 * and return whatever USDT that nets.
 */
export function sizeUsdpcToUsdt(
  usdtNeeded: number,
  usdpcAvailable: number,
  price: number,
  feeRate: number = USDPC_DEFAULT_TAKER_FEE_RATE,
): UsdpcToUsdtResult {
  if (!(usdtNeeded > 0) || !(price > 0) || !(usdpcAvailable > 0)) {
    return { usdpcToSell: 0, usdtReceived: 0, feeUsdt: 0 };
  }
  // usdtReceived = usdpcToSell * price * (1 - feeRate)  ->  solve for usdpcToSell
  let usdpcToSell = usdtNeeded / (price * (1 - feeRate));
  if (usdpcToSell > usdpcAvailable) usdpcToSell = usdpcAvailable;
  const gross = usdpcToSell * price;
  const feeUsdt = gross * feeRate;
  return { usdpcToSell, usdtReceived: gross - feeUsdt, feeUsdt };
}

/** USD (≈USDT) value of a USDPC holding at a given market price. */
export function usdpcValueUsd(usdpcBalance: number, price: number): number {
  if (!(usdpcBalance > 0) || !(price > 0)) return 0;
  return usdpcBalance * price;
}

// ── Yield modelling for simulators ───────────────────────────────────────────
// Live trading derives growth from the real daily USDPC market price. Simulators
// don't have a historical USDPC price series, so they model appreciation as a
// fixed APY compounded daily via a synthetic price.

/** Daily compounding factor for a given annual percentage yield. */
export function dailyYieldFactor(apy: number): number {
  if (!(apy > 0)) return 1;
  return Math.pow(1 + apy, 1 / 365);
}

/**
 * Synthetic USDPC price (USDT per USDPC) `days` after a start date, growing at
 * `apy` compounded daily from `startPrice` (default 1.0). Used by simulators so
 * that holding USDPC units valued at this synthetic price reproduces the live
 * "value at market price" behaviour.
 */
export function syntheticUsdpcPrice(days: number, apy: number, startPrice = 1): number {
  if (!(apy > 0) || !(days > 0)) return startPrice;
  return startPrice * Math.pow(1 + apy, days / 365);
}

// ── Config loading (live pipeline) ───────────────────────────────────────────
// Reads overrides from lth_pvr.settings (key/val text table). Any missing key
// falls back to the default. Never throws — config problems must not break the
// trading pipeline.

interface SettingsReader {
  schema: (s: string) => {
    from: (t: string) => {
      select: (c: string) => {
        in: (col: string, vals: string[]) => Promise<{ data: Array<{ key: string; val: string }> | null; error: unknown }>;
      };
    };
  };
}

const SETTINGS_KEYS = {
  pair: "usdpc_pair",
  takerFeeRate: "usdpc_taker_fee_rate",
  minOrderUsdt: "usdpc_min_order_usdt",
  defaultApy: "usdpc_default_apy",
  maxQuoteUsdt: "usdpc_max_quote_usdt",
  maxBaseUsdpc: "usdpc_max_base_usdpc",
} as const;

export async function loadUsdpcConfig(sb: SettingsReader): Promise<UsdpcConfig> {
  const cfg: UsdpcConfig = { ...USDPC_DEFAULT_CONFIG };
  try {
    const { data, error } = await sb
      .schema("lth_pvr")
      .from("settings")
      .select("key,val")
      .in("key", Object.values(SETTINGS_KEYS));
    if (error || !data) return cfg;
    const map = new Map(data.map((r) => [r.key, r.val]));
    if (map.has(SETTINGS_KEYS.pair)) cfg.pair = String(map.get(SETTINGS_KEYS.pair));
    const fee = Number(map.get(SETTINGS_KEYS.takerFeeRate));
    if (Number.isFinite(fee) && fee >= 0) cfg.takerFeeRate = fee;
    const minU = Number(map.get(SETTINGS_KEYS.minOrderUsdt));
    if (Number.isFinite(minU) && minU >= 0) cfg.minOrderUsdt = minU;
    const apy = Number(map.get(SETTINGS_KEYS.defaultApy));
    if (Number.isFinite(apy) && apy >= 0) cfg.defaultApy = apy;
    const maxQ = Number(map.get(SETTINGS_KEYS.maxQuoteUsdt));
    if (Number.isFinite(maxQ) && maxQ > 0) cfg.maxQuoteUsdt = maxQ;
    const maxB = Number(map.get(SETTINGS_KEYS.maxBaseUsdpc));
    if (Number.isFinite(maxB) && maxB > 0) cfg.maxBaseUsdpc = maxB;
  } catch (_e) {
    // fall back to defaults
  }
  return cfg;
}
