// sth_cb_strategy_logic.ts
// Shared STH Cost Basis (STH_CB) trading logic — single source of truth.
// Used by: ef_sth_cb_bt_execute (back-testing). A live decision generator can
// import the same `decideSthCb()` later so the back-tester and pipeline never drift.
//
// Strategy (ChartInspect "STH Line: Trend Band 5% + Capitulation Buy 70%"):
//
//   ratio = price / STH cost basis
//
//   Capitulation latch : ENTER when ratio <= capBuyRatio   (default 0.70)
//                        EXIT  when ratio >= capExitRatio  (default 1.00)
//   Trend latch        : ENTER when ratio >= trendEnterRatio (default 1.05)
//                        EXIT  when ratio <= trendExitRatio  (default 0.95)
//
//   inMarket = capLatch OR trendLatch    (ChartInspect `f5 = f3 || f4`)
//
// Momentum gate (BitWealth refinement): a latch EXIT (i.e. a sell) may be
// deferred until momentum turns non-positive — ROC(momoLength) <= momoThreshold.
// While deferred, the position is held; the exit fires on the first day the
// exit condition AND the momentum condition are both true.
//
// Position precedence when both latches are set: trend_hold.  When the trend
// latch engages, the capitulation latch is released (position is "upgraded")
// so a momentum-deferred capitulation exit cannot keep the portfolio in market
// after the trend latch later exits.  Symmetrically, a capitulation entry
// releases the trend latch.

// ========================================================================================
// TYPES
// ========================================================================================

export interface SthCbConfig {
  capBuyRatio: number;      // e.g. 0.70
  capExitRatio: number;     // e.g. 1.00
  trendEnterRatio: number;  // e.g. 1.05
  trendExitRatio: number;   // e.g. 0.95
  momoEnabled: boolean;     // master switch for the momentum gate
  momoLength: number;       // ROC look-back in days (e.g. 5)
  momoThreshold: number;    // sell allowed when ROC <= threshold (e.g. 0.0)
  momoOnCapExit: boolean;   // gate the capitulation exit (rule 2)
  momoOnTrendExit: boolean; // gate the trend exit (rule 3)
}

export interface SthCbState {
  capLatch: boolean;
  trendLatch: boolean;
}

export type SthCbPosition = "cash" | "cap_hold" | "trend_hold";

export interface SthCbSignal {
  inMarket: boolean;
  position: SthCbPosition;
  state: SthCbState;
  /** Human-readable rule that fired (or "Hold"). */
  rule: string;
  note: string;
  /** True when an exit condition was met but the momentum gate deferred the sell. */
  sellDeferred: boolean;
  ratio: number;
}

export const DEFAULT_STH_CB_CONFIG: SthCbConfig = {
  capBuyRatio: 0.70,
  capExitRatio: 1.00,
  trendEnterRatio: 1.05,
  trendExitRatio: 0.95,
  momoEnabled: true,
  momoLength: 5,
  momoThreshold: 0.0,
  momoOnCapExit: true,
  momoOnTrendExit: true,
};

export const INITIAL_STH_CB_STATE: SthCbState = { capLatch: false, trendLatch: false };

// ========================================================================================
// HELPERS
// ========================================================================================

export const fin = (x: unknown): boolean => Number.isFinite(Number(x));

export function positionOf(s: SthCbState): SthCbPosition {
  if (s.trendLatch) return "trend_hold";
  if (s.capLatch) return "cap_hold";
  return "cash";
}

/** Simple rate-of-change series: roc[i] = px[i] / px[i-len] - 1 (0 where undefined). */
export function computeRocSeries(prices: number[], len: number): number[] {
  const out = new Array<number>(prices.length).fill(0);
  if (len <= 0) return out;
  for (let i = len; i < prices.length; i++) {
    const now = prices[i];
    const prev = prices[i - len];
    if (now > 0 && prev > 0) out[i] = now / prev - 1;
  }
  return out;
}

// ========================================================================================
// CORE DECISION
// ========================================================================================

/**
 * Evaluate the STH_CB latches at one daily close.
 *
 * @param px     BTC close price
 * @param cb     STH cost basis (realized price of the <155d cohort)
 * @param roc    ROC(momoLength) at this close (used only when momentum gating is on)
 * @param prev   latch state carried from the previous close
 * @param config strategy thresholds
 */
export function decideSthCb(
  px: number,
  cb: number,
  roc: number,
  prev: SthCbState,
  config: SthCbConfig,
): SthCbSignal {
  const s: SthCbState = { capLatch: !!prev?.capLatch, trendLatch: !!prev?.trendLatch };

  if (!(px > 0) || !(cb > 0)) {
    return {
      inMarket: s.capLatch || s.trendLatch,
      position: positionOf(s),
      state: s,
      rule: "Hold",
      note: "Missing price or STH cost basis — state carried forward",
      sellDeferred: false,
      ratio: NaN,
    };
  }

  const ratio = px / cb;
  const momoWeak = !config.momoEnabled || roc <= config.momoThreshold;
  const pct = (r: number) => `${(r * 100).toFixed(0)}%`;
  const rocTxt = `ROC${config.momoLength}=${(roc * 100).toFixed(2)}%`;

  let rule = "Hold";
  let note = `price ${pct(ratio)} of STH CB`;
  let sellDeferred = false;

  // ── Capitulation latch ────────────────────────────────────────────────────
  if (!s.capLatch && ratio <= config.capBuyRatio) {
    s.capLatch = true;
    s.trendLatch = false; // capitulation entry supersedes any (stale) trend hold
    rule = "R1 Capitulation buy";
    note = `price ${pct(ratio)} ≤ ${pct(config.capBuyRatio)} of STH CB`;
  } else if (s.capLatch && !s.trendLatch && ratio >= config.capExitRatio) {
    const gated = config.momoEnabled && config.momoOnCapExit;
    if (!gated || momoWeak) {
      s.capLatch = false;
      rule = "R2 Capitulation exit";
      note = `price ${pct(ratio)} ≥ ${pct(config.capExitRatio)} of STH CB` + (gated ? ` and ${rocTxt} ≤ thr` : "");
    } else {
      sellDeferred = true;
      rule = "R2 deferred (momentum)";
      note = `price ${pct(ratio)} ≥ ${pct(config.capExitRatio)} of STH CB but ${rocTxt} > thr — holding`;
    }
  }

  // ── Trend latch ───────────────────────────────────────────────────────────
  if (!s.trendLatch && ratio >= config.trendEnterRatio) {
    s.trendLatch = true;
    s.capLatch = false; // upgrade cap_hold -> trend_hold (releases a deferred R2)
    rule = "R3 Trend entry";
    note = `price ${pct(ratio)} ≥ ${pct(config.trendEnterRatio)} of STH CB`;
    sellDeferred = false;
  } else if (s.trendLatch && ratio <= config.trendExitRatio) {
    const gated = config.momoEnabled && config.momoOnTrendExit;
    if (!gated || momoWeak) {
      s.trendLatch = false;
      rule = "R3 Trend exit";
      note = `price ${pct(ratio)} ≤ ${pct(config.trendExitRatio)} of STH CB` + (gated ? ` and ${rocTxt} ≤ thr` : "");
    } else {
      sellDeferred = true;
      rule = "R3 deferred (momentum)";
      note = `price ${pct(ratio)} ≤ ${pct(config.trendExitRatio)} of STH CB but ${rocTxt} > thr — holding`;
    }
  }

  return {
    inMarket: s.capLatch || s.trendLatch,
    position: positionOf(s),
    state: s,
    rule,
    note,
    sellDeferred,
    ratio,
  };
}

/**
 * Replay a history of (price, cost-basis) closes to seed the latch state at a
 * given start. Returns the state after the last row.
 */
export function warmupSthCbState(
  rows: Array<{ px: number; cb: number }>,
  config: SthCbConfig,
  initial: SthCbState = INITIAL_STH_CB_STATE,
): SthCbState {
  const roc = computeRocSeries(rows.map((r) => r.px), config.momoLength);
  let s: SthCbState = { ...initial };
  for (let i = 0; i < rows.length; i++) {
    s = decideSthCb(rows[i].px, rows[i].cb, roc[i], s, config).state;
  }
  return s;
}
