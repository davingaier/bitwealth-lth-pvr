// sth_cb_strategy_logic.ts
// Shared STH Cost Basis (STH_CB) trading logic — single source of truth.
// Used by: _shared/sth_cb_simulator.ts (back-tester EF + local lab). A live decision
// generator must import the same `decideSthCb()` so back-test and pipeline never drift.
//
// Base strategy (ChartInspect "STH Line: Trend Band 5% + Capitulation Buy 70%"):
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
// Momentum gate (BitWealth refinement): a latch EXIT (a sell) may be deferred until
// momentum turns non-positive — ROC(momoLength) <= momoThreshold.
//
// Position precedence when both latches are set: trend_hold. When the trend latch
// engages, the capitulation latch is released (position "upgraded") so a
// momentum-deferred capitulation exit cannot keep the portfolio in market after the
// trend latch later exits. A capitulation entry releases the trend latch.
//
// Experimental refinements (all OFF unless configured — see SthCbConfig):
//   1. trendExitConfirmDays / exitRocLength  — anti-whipsaw on the trend exit
//   2. capBuyTiers / sellTiers               — scale in / scale out (targetAlloc < 1)
//   3. cbSlopeDays                           — honour trend exit only if the STH CB is flat/falling
//   4. distributeAtSigma (+ disableTrendExit) — exit at an LTH PVR upper band instead of −5 %
//   5. trendReentryRatio                     — cheaper re-entry after a trend exit
//   6. (validation modes live in the simulator / lab, not here)

// ========================================================================================
// TYPES
// ========================================================================================

export interface AllocTier {
  /** price / STH-cost-basis ratio at which this tier triggers */
  ratio: number;
  /** target BTC allocation (0..1) once this tier has triggered */
  alloc: number;
}

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

  // ── Idea 1: anti-whipsaw ──────────────────────────────────────────────────
  /** Require N consecutive closes <= trendExitRatio before the trend exit fires (1 = off). */
  trendExitConfirmDays?: number;
  /** Use a separate (slower) ROC length for the momentum gate on exits; needs `extra.rocExit`. */
  exitRocLength?: number;

  // ── Idea 2: scaling ───────────────────────────────────────────────────────
  /** Scale-in tiers, e.g. [{ratio:0.70,alloc:0.5},{ratio:0.60,alloc:1}]. Replaces capBuyRatio when set. */
  capBuyTiers?: AllocTier[];
  /** Scale-out tiers while in market, e.g. [{ratio:1.5,alloc:0.66},{ratio:2.0,alloc:0.33}]. alloc 0 = full exit. */
  sellTiers?: AllocTier[];

  // ── Idea 3: cost-basis slope filter ──────────────────────────────────────
  /** Trend exit only fires if the STH CB slope over N days <= 0; needs `extra.cbSlope`. */
  cbSlopeDays?: number;

  // ── Idea 4: hybrid distribution at LTH PVR bands ─────────────────────────
  /** Sell everything when price >= the LTH PVR band at this sigma (0.5,1,1.5,2,2.5); needs `extra.bands`. */
  distributeAtSigma?: number;
  /** Skip the −5 % trend exit entirely (pair with distributeAtSigma or sellTiers). */
  disableTrendExit?: boolean;

  // ── Idea 5: re-entry ladder ───────────────────────────────────────────────
  /** After a trend exit, re-enter when ratio >= this (e.g. 1.00) instead of trendEnterRatio. */
  trendReentryRatio?: number;
}

export interface SthCbState {
  capLatch: boolean;
  trendLatch: boolean;
  /** idea 1: consecutive closes meeting the trend-exit condition */
  exitConfirmCount?: number;
  /** idea 2: number of capitulation tiers hit (0 = none) */
  capTierLevel?: number;
  /** idea 2: number of sell tiers hit (0 = none) */
  sellTierLevel?: number;
  /** idea 5: last exit was a trend exit → cheaper re-entry armed */
  reentryArmed?: boolean;
}

export type SthCbPosition = "cash" | "cap_hold" | "trend_hold";

/** Optional per-day inputs needed only by the experimental flags. */
export interface SthCbExtraInputs {
  /** ROC over `exitRocLength` days (idea 1) */
  rocExit?: number;
  /** STH cost basis slope over `cbSlopeDays` (cb[t] / cb[t-N] − 1) (idea 3) */
  cbSlope?: number;
  /** LTH PVR band price levels keyed p050|p100|p150|p200|p250 (idea 4) */
  bands?: Record<string, number | null | undefined>;
}

export interface SthCbSignal {
  inMarket: boolean;
  position: SthCbPosition;
  /** Target BTC allocation 0..1 (1 = all-in). Always 0 when position is cash. */
  targetAlloc: number;
  state: SthCbState;
  /** Human-readable rule that fired (or "Hold"). */
  rule: string;
  note: string;
  /** True when an exit condition was met but a gate (momentum / slope / confirm) deferred the sell. */
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

/** Map a sigma multiplier to the band column suffix used by lth_pvr.rb_bands_daily. */
export function sigmaKey(sigma: number): string | null {
  const map: Record<string, string> = { "0.5": "p050", "1": "p100", "1.5": "p150", "2": "p200", "2.5": "p250" };
  return map[String(sigma)] ?? null;
}

function capTiers(config: SthCbConfig): AllocTier[] {
  const t = config.capBuyTiers?.length ? [...config.capBuyTiers] : [{ ratio: config.capBuyRatio, alloc: 1 }];
  return t.sort((a, b) => b.ratio - a.ratio); // highest ratio first (hit first on the way down)
}

function sellTiers(config: SthCbConfig): AllocTier[] {
  return (config.sellTiers ?? []).slice().sort((a, b) => a.ratio - b.ratio); // lowest first (hit first on the way up)
}

function allocFor(s: SthCbState, config: SthCbConfig): number {
  if (!s.capLatch && !s.trendLatch) return 0;
  let alloc = 1;
  if (s.capLatch && !s.trendLatch && config.capBuyTiers?.length) {
    const tiers = capTiers(config);
    const lvl = Math.min(s.capTierLevel ?? 0, tiers.length);
    alloc = lvl > 0 ? tiers[lvl - 1].alloc : 0;
  }
  const st = sellTiers(config);
  const sl = Math.min(s.sellTierLevel ?? 0, st.length);
  if (sl > 0) alloc = Math.min(alloc, st[sl - 1].alloc);
  return Math.max(0, Math.min(1, alloc));
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
 * @param config strategy thresholds (+ optional experimental flags)
 * @param extra  per-day inputs required by experimental flags (ignored when flags are off)
 */
export function decideSthCb(
  px: number,
  cb: number,
  roc: number,
  prev: SthCbState,
  config: SthCbConfig,
  extra: SthCbExtraInputs = {},
): SthCbSignal {
  const s: SthCbState = {
    capLatch: !!prev?.capLatch,
    trendLatch: !!prev?.trendLatch,
    exitConfirmCount: prev?.exitConfirmCount ?? 0,
    capTierLevel: prev?.capTierLevel ?? (prev?.capLatch ? 1 : 0),
    sellTierLevel: prev?.sellTierLevel ?? 0,
    reentryArmed: !!prev?.reentryArmed,
  };

  if (!(px > 0) || !(cb > 0)) {
    return {
      inMarket: s.capLatch || s.trendLatch,
      position: positionOf(s),
      targetAlloc: allocFor(s, config),
      state: s,
      rule: "Hold",
      note: "Missing price or STH cost basis — state carried forward",
      sellDeferred: false,
      ratio: NaN,
    };
  }

  const ratio = px / cb;
  const pct = (r: number) => `${(r * 100).toFixed(0)}%`;

  // Momentum gate: exits use the slower ROC when exitRocLength is configured and supplied
  const useExitRoc = !!config.exitRocLength && fin(extra.rocExit);
  const rocGate = useExitRoc ? Number(extra.rocExit) : roc;
  const momoWeak = !config.momoEnabled || rocGate <= config.momoThreshold;
  const rocTxt = `ROC${useExitRoc ? config.exitRocLength : config.momoLength}=${(rocGate * 100).toFixed(2)}%`;

  // Idea 3: cost-basis slope filter (only applies when configured AND an input is supplied)
  const slopeActive = !!config.cbSlopeDays && fin(extra.cbSlope);
  const slopeOk = !slopeActive || Number(extra.cbSlope) <= 0;

  let rule = "Hold";
  let note = `price ${pct(ratio)} of STH CB`;
  let sellDeferred = false;

  const enterCash = () => {
    s.capLatch = false;
    s.trendLatch = false;
    s.capTierLevel = 0;
    s.sellTierLevel = 0;
    s.exitConfirmCount = 0;
  };

  // ── Capitulation latch (idea 2 generalises the single 70 % level to tiers) ─
  const cTiers = capTiers(config);
  {
    const hit = cTiers.filter((t) => ratio <= t.ratio).length;
    if (hit > (s.capTierLevel ?? 0)) {
      const first = !s.capLatch;
      s.capLatch = true;
      s.trendLatch = false; // capitulation entry supersedes any (stale) trend hold
      s.capTierLevel = hit;
      s.sellTierLevel = 0;
      s.exitConfirmCount = 0;
      s.reentryArmed = false;
      rule = first ? "R1 Capitulation buy" : `R1 Capitulation tier ${hit}`;
      note = `price ${pct(ratio)} ≤ ${pct(cTiers[hit - 1].ratio)} of STH CB`;
    } else if (s.capLatch && !s.trendLatch && ratio >= config.capExitRatio) {
      const gated = config.momoEnabled && config.momoOnCapExit;
      if (!gated || momoWeak) {
        enterCash();
        rule = "R2 Capitulation exit";
        note = `price ${pct(ratio)} ≥ ${pct(config.capExitRatio)} of STH CB` + (gated ? ` and ${rocTxt} ≤ thr` : "");
      } else {
        sellDeferred = true;
        rule = "R2 deferred (momentum)";
        note = `price ${pct(ratio)} ≥ ${pct(config.capExitRatio)} of STH CB but ${rocTxt} > thr — holding`;
      }
    }
  }

  // ── Trend latch ───────────────────────────────────────────────────────────
  const ladder = s.reentryArmed && !!config.trendReentryRatio;
  const enterRatio = ladder ? Number(config.trendReentryRatio) : config.trendEnterRatio;
  if (!s.trendLatch && ratio >= enterRatio) {
    s.trendLatch = true;
    s.capLatch = false; // upgrade cap_hold -> trend_hold (releases a deferred R2)
    s.capTierLevel = 0;
    s.sellTierLevel = 0;
    s.exitConfirmCount = 0;
    s.reentryArmed = false;
    rule = (ladder && enterRatio !== config.trendEnterRatio) ? "R5 Trend re-entry (ladder)" : "R3 Trend entry";
    note = `price ${pct(ratio)} ≥ ${pct(enterRatio)} of STH CB`;
    sellDeferred = false;
  } else if (s.trendLatch && !config.disableTrendExit && ratio <= config.trendExitRatio) {
    const confirmDays = Math.max(1, Math.trunc(config.trendExitConfirmDays ?? 1));
    s.exitConfirmCount = (s.exitConfirmCount ?? 0) + 1;
    const confirmed = s.exitConfirmCount >= confirmDays;
    const gated = config.momoEnabled && config.momoOnTrendExit;
    if (confirmed && (!gated || momoWeak) && slopeOk) {
      enterCash();
      s.reentryArmed = true;
      rule = "R3 Trend exit";
      note = `price ${pct(ratio)} ≤ ${pct(config.trendExitRatio)} of STH CB` +
        (confirmDays > 1 ? ` for ${confirmDays} closes` : "") +
        (gated ? ` and ${rocTxt} ≤ thr` : "") +
        (slopeActive ? " and CB slope ≤ 0" : "");
    } else {
      sellDeferred = true;
      const why = !confirmed ? `confirm ${s.exitConfirmCount}/${confirmDays}` : (!slopeOk ? "CB rising" : "momentum");
      rule = `R3 deferred (${why})`;
      note = `price ${pct(ratio)} ≤ ${pct(config.trendExitRatio)} of STH CB but ${why} — holding`;
    }
  } else if (s.trendLatch) {
    s.exitConfirmCount = 0; // condition not met today → reset the confirmation streak
  }

  // ── Idea 4: distribution at an LTH PVR upper band (any hold type) ─────────
  if ((s.capLatch || s.trendLatch) && config.distributeAtSigma) {
    const key = sigmaKey(config.distributeAtSigma);
    const level = key ? Number(extra.bands?.[key]) : NaN;
    if (fin(level) && level > 0 && px >= level) {
      enterCash();
      s.reentryArmed = false;
      rule = `R4 Distribution at +${config.distributeAtSigma}σ`;
      note = `price ${px.toFixed(0)} ≥ LTH PVR ${key} ${level.toFixed(0)}`;
      sellDeferred = false;
    }
  }

  // ── Idea 2: scale-out tiers while in market ───────────────────────────────
  const sTiers = sellTiers(config);
  if ((s.capLatch || s.trendLatch) && sTiers.length) {
    const hit = sTiers.filter((t) => ratio >= t.ratio).length;
    if (hit > (s.sellTierLevel ?? 0)) {
      s.sellTierLevel = hit;
      const tier = sTiers[hit - 1];
      if (tier.alloc <= 0) {
        enterCash();
        s.reentryArmed = false;
        rule = `R6 Sell tier ${hit} (full exit)`;
      } else {
        rule = `R6 Sell tier ${hit} → ${Math.round(tier.alloc * 100)}% BTC`;
      }
      note = `price ${pct(ratio)} ≥ ${pct(tier.ratio)} of STH CB`;
      sellDeferred = false;
    }
  }

  return {
    inMarket: s.capLatch || s.trendLatch,
    position: positionOf(s),
    targetAlloc: allocFor(s, config),
    state: s,
    rule,
    note,
    sellDeferred,
    ratio,
  };
}

/**
 * Replay a history of closes to seed the latch state at a given start.
 * Returns the state after the last row. Only the base inputs are derived here;
 * the simulator's replay also derives the experimental inputs.
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
