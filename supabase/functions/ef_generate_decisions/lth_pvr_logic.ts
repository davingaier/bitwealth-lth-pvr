// lth_pvr_logic.ts
export const fin = (x)=>Number.isFinite(Number(x));

export async function computeBearPauseAt(sb, orgId, upToDateStr) {
  // Replay the same bear_pause rules as recompute_bear_pause:
  // - Enter pause if price > +2σ
  // - Exit pause once price < −1σ after being paused
  const { data, error } = await sb
    .from("ci_bands_daily")
    .select("date, btc_price, price_at_m100, price_at_p200")
    .eq("org_id", orgId)
    .lte("date", upToDateStr)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(`computeBearPauseAt query failed: ${error.message}`);
  }

  let paused = false;

  for (const row of data ?? []) {
    const px = Number(row.btc_price ?? 0);
    const m100 = fin(row.price_at_m100) ? Number(row.price_at_m100) : NaN; // -1σ
    const p200 = fin(row.price_at_p200) ? Number(row.price_at_p200) : NaN; // +2σ

    if (!fin(px)) continue;

    // Enter pause once we go above +2σ
    if (fin(p200) && px > p200) {
      paused = true;
    }

    // While paused, leave pause once price drops below -1σ
    if (paused && fin(m100) && px < m100) {
      paused = false;
    }
  }

  return paused;
}

export function bucketLabel(px, r) {
  const lvls = [
    [
      "-1.00σ",
      r.price_at_m100
    ],
    [
      "-0.75σ",
      r.price_at_m075
    ],
    [
      "-0.50σ",
      r.price_at_m050
    ],
    [
      "-0.25σ",
      r.price_at_m025
    ],
    [
      "mean",
      r.price_at_mean
    ],
    [
      "+0.50σ",
      r.price_at_p050
    ],
    [
      "+1.00σ",
      r.price_at_p100
    ],
    [
      "+1.50σ",
      r.price_at_p150
    ],
    [
      "+2.00σ",
      r.price_at_p200
    ],
    [
      "+2.50σ",
      r.price_at_p250
    ]
  ];
  let last = "<-1.00σ";
  for (const [name, v] of lvls){
    if (fin(v) && px >= Number(v)) last = name;
  }
  return last;
}
// *** Exact state machine from ef_generate_decisions (incl. retrace exceptions) ***
export function decideTrade(px, r, roc5, state, B) {
  const mean = fin(r.price_at_mean) ? Number(r.price_at_mean) : NaN;
  const p_m025 = fin(r.price_at_m025) ? Number(r.price_at_m025) : NaN;
  const p_m050 = fin(r.price_at_m050) ? Number(r.price_at_m050) : NaN;
  const p_m075 = fin(r.price_at_m075) ? Number(r.price_at_m075) : NaN;
  const p_m100 = fin(r.price_at_m100) ? Number(r.price_at_m100) : NaN;
  const p_p050 = fin(r.price_at_p050) ? Number(r.price_at_p050) : NaN;
  const p_p100 = fin(r.price_at_p100) ? Number(r.price_at_p100) : NaN;
  const p_p150 = fin(r.price_at_p150) ? Number(r.price_at_p150) : NaN;
  const p_p200 = fin(r.price_at_p200) ? Number(r.price_at_p200) : NaN;
  const p_p250 = fin(r.price_at_p250) ? Number(r.price_at_p250) : NaN;
  const s = {
    bear_pause: false,
    was_above_p1: false,
    was_above_p15: false,
    r1_armed: false,
    r15_armed: false,
    ...state
  };
  // Bear pause set/clear
  if (fin(p_p200) && px > p_p200) s.bear_pause = true;
  if (fin(p_m100) && px < p_m100) {
    s.bear_pause = false;
    s.was_above_p1 = false;
    s.was_above_p15 = false;
    s.r1_armed = false;
    s.r15_armed = false;
  }
  if (s.bear_pause) {
    s.was_above_p1 = false;
    s.was_above_p15 = false;
    s.r1_armed = false;
    s.r15_armed = false;
  }
  // Eligibility memory (only when we are IN the ranges)
  if (!s.bear_pause) {
    if (fin(p_p100) && fin(p_p150) && px >= p_p100 && px < p_p150) s.was_above_p1 = true;
    if (fin(p_p150) && fin(p_p200) && px >= p_p150 && px < p_p200) s.was_above_p15 = true;
  }
  // Re-arm when back above boundary
  if (!s.bear_pause) {
    if (s.was_above_p1 && fin(p_p050) && px >= p_p050) s.r1_armed = true;
    if (s.was_above_p15 && fin(p_p100) && px >= p_p100) s.r15_armed = true;
  }
  // Retrace exceptions (BUY Base 3)
  let exc_b8_to_b6 = s.was_above_p1 && fin(mean) && fin(p_p050) && px >= mean && px < p_p050;
  let exc_b9_to_b7 = s.was_above_p15 && fin(p_p050) && fin(p_p100) && px >= p_p050 && px < p_p100;
  if (s.bear_pause && !(fin(p_m100) && px < p_m100)) {
    exc_b8_to_b6 = false;
    exc_b9_to_b7 = false;
  }
  if (exc_b9_to_b7) {
    return {
      action: "BUY",
      pct: B.B3,
      rule: "Base 3 (retrace B9→B7)",
      note: "Retrace: touched +1.5σ…+2.0σ; now in +0.5σ…+1.0σ",
      state: s
    };
  }
  if (exc_b8_to_b6) {
    return {
      action: "BUY",
      pct: B.B3,
      rule: "Base 3 (retrace B8→B6)",
      note: "Retrace: touched +1.0σ…+1.5σ; now in mean…+0.5σ",
      state: s
    };
  }
  // Core rules
  if (fin(mean) && px < mean) {
    if (s.bear_pause && !(fin(p_m100) && px < p_m100)) {
      return {
        action: "HOLD",
        pct: 0,
        rule: "Pause",
        note: "Bear pause active: buying disabled until < −1σ",
        state: s
      };
    }
    if (fin(p_m100) && px < p_m100) {
      return {
        action: "BUY",
        pct: B.B1,
        rule: "Base 1",
        note: "< −1.0σ",
        state: s
      };
    }
    if (fin(p_m075) && px < p_m075) {
      return {
        action: "BUY",
        pct: B.B2,
        rule: "Base 2",
        note: "−1.0σ…−0.75σ",
        state: s
      };
    }
    if (fin(p_m050) && px < p_m050) {
      return {
        action: "BUY",
        pct: B.B3,
        rule: "Base 3",
        note: "−0.75σ…−0.5σ",
        state: s
      };
    }
    if (fin(p_m025) && px < p_m025) {
      return {
        action: "BUY",
        pct: B.B4,
        rule: "Base 4",
        note: "−0.5σ…−0.25σ",
        state: s
      };
    }
    return {
      action: "BUY",
      pct: B.B5,
      rule: "Base 5",
      note: "−0.25σ…mean",
      state: s
    };
  }
  // Sell zone (≥ mean); momentum filter only for Bases 7–9.
  // Rule change: when bear_pause is TRUE, the momentum filter does not apply.
  const mom_ok = s.bear_pause ? true : roc5 > 0;
  if (fin(p_p050) && px < p_p050) {
    return {
      action: "SELL",
      pct: B.B6,
      rule: "Base 6",
      note: "mean…+0.5σ",
      state: s
    };
  }
  if (fin(p_p100) && px < p_p100) {
    return mom_ok ? {
      action: "SELL",
      pct: B.B7,
      rule: "Base 7",
      note: "+0.5σ…+1.0σ",
      state: s
    } : {
      action: "HOLD",
      pct: 0,
      rule: "Hold (momo≤0)",
      note: "Momentum blocks sell in +0.5σ…+1.0σ",
      state: s
    };
  }
  if (fin(p_p150) && px < p_p150) {
    return mom_ok ? {
      action: "SELL",
      pct: B.B8,
      rule: "Base 8",
      note: "+1.0σ…+1.5σ",
      state: s
    } : {
      action: "HOLD",
      pct: 0,
      rule: "Hold (momo≤0)",
      note: "Momentum blocks sell in +1.0σ…+1.5σ",
      state: s
    };
  }
  if (fin(p_p200) && px < p_p200) {
    return mom_ok ? {
      action: "SELL",
      pct: B.B9,
      rule: "Base 9",
      note: "+1.5σ…+2.0σ",
      state: s
    } : {
      action: "HOLD",
      pct: 0,
      rule: "Hold (momo≤0)",
      note: "Momentum blocks sell in +1.5σ…+2.0σ",
      state: s
    };
  }
  if (fin(p_p250) && px < p_p250) {
    return {
      action: "SELL",
      pct: B.B10,
      rule: "Base 10",
      note: "+2.0σ…+2.5σ",
      state: s
    };
  }
  return {
    action: "SELL",
    pct: B.B11,
    rule: "Base 11",
    note: "≥ +2.5σ",
    state: s
  };
}
