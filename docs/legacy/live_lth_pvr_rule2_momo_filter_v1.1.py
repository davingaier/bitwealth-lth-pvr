#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
LTH PVR Backtester (ChartInspect static bands) — v1.1 [Rule2: Momentum-Filtered Sells]
Change in v1.1:
- When bear_pause == True, the momentum filter does NOT apply (sells proceed regardless of ROC).
- Ledger remains ON by default.

CLI Example:
  python live_lth_pvr_rule2_momo_filter_v1_1.py \
    --ci-price-key ci_live_xxx \
    --start 2015-10-06 --end today \
    --out lth_pvr_rule2_v1_1.csv --debug

Notes:
- If start > end, we auto-swap and warn.
- Fees: trade fees in BTC (base) via --fee-bps (default 8). Contribution fee 0.18% in USDT via --contrib-fee-bps (default 18 bps).
- Bear-market pause: when price > +2.0σ, ALL buying pauses until price < −1.0σ again.
- Above mean, SELL tiers (Base 6–11). Below mean, BUY tiers (Base 1–5). Retrace exceptions buy Base 3 and skip selling that day.
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List

import pandas as pd
import numpy as np
import requests
from math import isfinite

CI_BASE = "https://chartinspect.com/api/v1"
PVR_BANDS_PATH = "/onchain/lth-pvr-bands"


# ------------------------- Helpers & IO -------------------------------------

def ymd_or_today(s: str) -> str:
    """Return YYYY-MM-DD, expanding 'today' to today's date in UTC."""
    if s.strip().lower() == "today":
        return dt.datetime.now(dt.UTC).strftime("%Y-%m-%d")
    try:
        _ = dt.datetime.strptime(s, "%Y-%m-%d")
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"Invalid date '{s}', expected YYYY-MM-DD or 'today'") from e
    return s


def fetch_ci_lth_pvr_bands(
    api_key: str,
    start: Optional[str],
    end: Optional[str],
    mode: str = "static",
    timeout: int = 60,
    debug: bool = False,
) -> pd.DataFrame:
    """Fetch LTH PVR bands from ChartInspect."""
    url = f"{CI_BASE}{PVR_BANDS_PATH}"
    params: Dict[str, Any] = {"mode": mode}
    if start:
        params["start"] = start
    if end:
        params["end"] = end

    headers = {"X-API-Key": api_key}
    if debug:
        print(f"[DEBUG] GET {url}")
        print(f"[DEBUG] params={params}")

    r = requests.get(url, headers=headers, params=params, timeout=timeout)
    r.raise_for_status()
    j = r.json()

    data = j.get("data", [])
    if not data:
        raise RuntimeError("CI PVR bands returned no data.")

    df = pd.DataFrame(data)

    # Normalize date to YYYY-MM-DD
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    elif "timestamp" in df.columns:
        df["date"] = pd.to_datetime(df["timestamp"], unit="ms").dt.strftime("%Y-%m-%d")
    else:
        raise RuntimeError("CI payload missing both 'date' and 'timestamp'.")

    return df.sort_values("date").reset_index(drop=True)


# ----------------------- Strategy / Ledger Logic ----------------------------

REQUIRED_COLUMNS = [
    "date", "btc_price",
    "price_at_pvr_mean",
    "price_at_pvr_plus_half_sigma",
    "price_at_pvr_plus_1sigma",
    "price_at_pvr_plus_1half_sigma",
    "price_at_pvr_plus_2sigma",
    "price_at_pvr_plus_2half_sigma",
    "price_at_pvr_minus_quarter_sigma",
    "price_at_pvr_minus_half_sigma",
    "price_at_pvr_minus_three_quarters_sigma",
    "price_at_pvr_minus_1sigma",
]


def map_ci_columns(df_ci: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in REQUIRED_COLUMNS if c not in df_ci.columns]
    if missing:
        raise RuntimeError(f"CI PVR payload missing required fields: {missing}")

    out = pd.DataFrame({
        "date": df_ci["date"],
        "price_ci": df_ci["btc_price"],
        "static_price_at_mean": df_ci["price_at_pvr_mean"],
        "static_price_at_-1.00": df_ci["price_at_pvr_minus_1sigma"],
        "static_price_at_-0.75": df_ci["price_at_pvr_minus_three_quarters_sigma"],
        "static_price_at_-0.50": df_ci["price_at_pvr_minus_half_sigma"],
        "static_price_at_-0.25": df_ci["price_at_pvr_minus_quarter_sigma"],
        "static_price_at_+0.50": df_ci["price_at_pvr_plus_half_sigma"],
        "static_price_at_+1.00": df_ci["price_at_pvr_plus_1sigma"],
        "static_price_at_+1.50": df_ci["price_at_pvr_plus_1half_sigma"],
        "static_price_at_+2.00": df_ci["price_at_pvr_plus_2sigma"],
        "static_price_at_+2.50": df_ci["price_at_pvr_plus_2half_sigma"],
    })

    # Diagnostics passthrough if present
    for c in [
        "lth_pvr", "lth_realized_price", "lth_supply", "lth_market_cap",
        "lth_realized_cap", "lth_cost_basis_usd", "cumulative_std_dev", "pvr_mean",
    ]:
        if c in df_ci.columns:
            out[c] = df_ci[c]

    return out

def add_bear_pause_flags(df: pd.DataFrame) -> pd.DataFrame:
    """Compute bear_pause (carry-forward state) and bear_pause_enter across the whole lookback."""
    pause = False
    pauses = []
    enters = []
    for _, row in df.iterrows():
        px = float(row["price_ci"])
        p2 = float(row["static_price_at_+2.00"])
        m1 = float(row["static_price_at_-1.00"])
        prev = pause
        if isfinite(p2) and px > p2:
            pause = True
        elif isfinite(m1) and px < m1:
            pause = False
        pauses.append(pause)
        enters.append(pause and not prev)
    out = df.copy()
    out["bear_pause"] = pauses
    out["bear_pause_enter"] = enters
    return out


def sigma_bucket(px: float, r: pd.Series) -> str:
    """Return the nearest lower-or-equal sigma band label for readability."""
    lvls = [
        ("-1.00σ", r["static_price_at_-1.00"]),
        ("-0.75σ", r["static_price_at_-0.75"]),
        ("-0.50σ", r["static_price_at_-0.50"]),
        ("-0.25σ", r["static_price_at_-0.25"]),
        ("mean",   r["static_price_at_mean"]),
        ("+0.50σ", r["static_price_at_+0.50"]),
        ("+1.00σ", r["static_price_at_+1.00"]),
        ("+1.50σ", r["static_price_at_+1.50"]),
        ("+2.00σ", r["static_price_at_+2.00"]),
        ("+2.50σ", r["static_price_at_+2.50"]),
    ]
    last = "<-1.00σ"
    for name, val in lvls:
        if isfinite(val) and px >= float(val):
            last = name
    return last

# Base sizes (fractions)
B1 = 0.22796
B2 = 0.21397
B3 = 0.19943
B4 = 0.18088
B5 = 0.12229
B6 = 0.00157
B7 = 0.00200
B8 = 0.00441
B9 = 0.01287
B10 = 0.03300
B11 = 0.09572


def decide_trade(
    px: float,
    r: pd.Series,
    state: Dict[str, Any],
) -> Tuple[str, float, str, str]:
    """Decide action based on rules.

    Returns: (action, pct, rule_name, note)
      - action: 'BUY' | 'SELL' | 'HOLD'
      - pct: fraction of holding to use (USDT for buy, BTC for sell). 0..1
      - rule_name: e.g., 'Base 1', 'Base 8', 'Retrace +1→+0.5'
      - note: extra context
    """
    mean = float(r["static_price_at_mean"]) if isfinite(r["static_price_at_mean"]) else float('nan')

    # Threshold helpers
    def th(label: str) -> float:
        return float(r[label]) if isfinite(r[label]) else float('nan')

    m = mean
    p_m025 = th("static_price_at_-0.25")
    p_m050 = th("static_price_at_-0.50")
    p_m075 = th("static_price_at_-0.75")
    p_m100 = th("static_price_at_-1.00")
    p_p050 = th("static_price_at_+0.50")
    p_p100 = th("static_price_at_+1.00")
    p_p150 = th("static_price_at_+1.50")
    p_p200 = th("static_price_at_+2.00")
    p_p250 = th("static_price_at_+2.50")

    # ------------------- Update state flags (cross/retrace/pause) -------------------
    # If we didn't precompute a pause flag for this row, derive it from price.
    if "bear_pause" not in r.index:
        # Enter pause when px > +2.0σ
        if isfinite(p_p200) and px > p_p200:
            state["bear_pause"] = True
        # Exit pause when px < -1.0σ
        if isfinite(p_m100) and px < p_m100:
            state["bear_pause"] = False

    # While paused: never accumulate or re-arm retrace eligibility
    if state.get("bear_pause", False):
        state["was_above_p1"] = False
        state["was_above_p15"] = False
        state["r1_armed"] = False
        state["r15_armed"] = False
    elif isfinite(p_m100) and px < p_m100:
        # On the precise exit print (< -1.0σ), reset eligibility once
        state["was_above_p1"] = False
        state["was_above_p15"] = False
        state["r1_armed"] = False
        state["r15_armed"] = False

    # Cross memory for retraces — eligibility only when we CLOSE IN the ranges
    if not state.get("bear_pause", False):
        # Case A eligibility: [+1.0σ, +1.5σ)
        if isfinite(p_p100) and isfinite(p_p150) and (px >= p_p100) and (px < p_p150):
            state["was_above_p1"] = True
        # Case B eligibility: [+1.5σ, +2.0σ)
        if isfinite(p_p150) and isfinite(p_p200) and (px >= p_p150) and (px < p_p200):
            state["was_above_p15"] = True

    # Re-arm edge triggers when price is back above the retrace boundary
    if not state.get("bear_pause", False):
        if state.get("was_above_p1", False) and isfinite(p_p050) and (px >= p_p050):
            state["r1_armed"] = True
        if state.get("was_above_p15", False) and isfinite(p_p100) and (px >= p_p100):
            state["r15_armed"] = True

    # Retrace EXCEPTIONS (B8→B6 and B9→B7), per v5:
    # - Buy DAILY at Base 3 while inside the target band (suppresses any sell that day)
    # - Re-trigger allowed without needing a fresh B8/B9 touch
    exc_b8_to_b6 = (
        state.get("was_above_p1", False)
        and isfinite(m) and isfinite(p_p050)
        and (px >= m) and (px < p_p050)       # Band 6: mean … +0.5σ
    )
    exc_b9_to_b7 = (
        state.get("was_above_p15", False)
        and isfinite(p_p050) and isfinite(p_p100)
        and (px >= p_p050) and (px < p_p100)  # Band 7: +0.5σ … +1.0σ
    )

    # Pause gating (Rule 1): no exception-buys during pause unless exiting via < −1.0σ
    if state.get("bear_pause", False) and not (isfinite(p_m100) and px < p_m100):
        exc_b8_to_b6 = False
        exc_b9_to_b7 = False

    if exc_b9_to_b7:
        return ("BUY", B3, "Base 3 (retrace B9→B7)", "Retrace: touched +1.5σ…+2.0σ; now in +0.5σ…+1.0σ")
    if exc_b8_to_b6:
        return ("BUY", B3, "Base 3 (retrace B8→B6)", "Retrace: touched +1.0σ…+1.5σ; now in mean…+0.5σ")

    # ------------------- Core rules -------------------
    if isfinite(m) and px < m:
        # Buy-only zone, unless we're in bear pause (ALL buys disabled) until a close < -1.0σ
        if state.get("bear_pause", False) and not (isfinite(p_m100) and px < p_m100):
            return ("HOLD", 0.0, "Pause", "Bear market pause active: buying disabled until < -1σ")
        # tiered buys by distance below mean
        if isfinite(p_m100) and px < p_m100:
            return ("BUY", B1, "Base 1", "< -1.0σ")
        if isfinite(p_m075) and px < p_m075:
            return ("BUY", B2, "Base 2", "-1.0σ…-0.75σ")
        if isfinite(p_m050) and px < p_m050:
            return ("BUY", B3, "Base 3", "-0.75σ…-0.5σ")
        if isfinite(p_m025) and px < p_m025:
            return ("BUY", B4, "Base 4", "-0.5σ…-0.25σ")
        # below mean but above -0.25σ
        return ("BUY", B5, "Base 5", "-0.25σ…mean")

    # px ≥ mean: Sell-only zone (retrace handled earlier)
    # v1.1 rule: if bear_pause is True, ignore momentum filter (treat as mom_ok=True)
    mom_ok = True if state.get("bear_pause", False) else (float(r.get("roc5", 0.0)) > 0.0)

    if isfinite(p_p050) and px < p_p050:
        return ("SELL", B6, "Base 6", "mean…+0.5σ")
    elif isfinite(p_p100) and px < p_p100:
        if mom_ok:
            return ("SELL", B7, "Base 7", "+0.5σ…+1.0σ")
        else:
            return ("HOLD", 0.0, "Hold (momo≤0)", "Momentum filter blocks sell in +0.5σ…+1.0σ")
    elif isfinite(p_p150) and px < p_p150:
        if mom_ok:
            return ("SELL", B8, "Base 8", "+1.0σ…+1.5σ")
        else:
            return ("HOLD", 0.0, "Hold (momo≤0)", "Momentum filter blocks sell in +1.0σ…+1.5σ")
    elif isfinite(p_p200) and px < p_p200:
        if mom_ok:
            return ("SELL", B9, "Base 9", "+1.5σ…+2.0σ")
        else:
            return ("HOLD", 0.0, "Hold (momo≤0)", "Momentum filter blocks sell in +1.5σ…+2.0σ")
    elif isfinite(p_p250) and px < p_p250:
        return ("SELL", B10, "Base 10", "+2.0σ…+2.5σ")
    else:
        return ("SELL", B11, "Base 11", "+2.5σ or above")


def build_ledger(
    df: pd.DataFrame,
    with_ledger: bool,
    start_contrib: float,
    monthly_contrib: float,
    monthly_only: bool,
    fee_bps: float,
    contrib_fee_bps: float,
    debug: bool = False,
) -> pd.DataFrame:
    # --- Resolve price column (supports CI/raw/generic inputs) ---
    price_col = "price_ci"
    if price_col not in df.columns:
        for cand in ("price_usd", "btc_price", "price", "close"):
            if cand in df.columns:
                price_col = cand
                break
        else:
            raise KeyError("No price column found. Expected one of: price_ci, price_usd, btc_price, price, close")

    out = df.copy()

    # Momentum feature: 5-day ROC
    _ps = None
    for _cand in ("price_ci","price_usd","btc_price","price","close"):
        if _cand in out.columns:
            _ps = out[_cand].astype(float)
            break
    out["roc5"] = (_ps.pct_change(5).fillna(0.0)) if _ps is not None else 0.0
    out["ledger"] = "on" if with_ledger else "off"
    out["with_ledger"] = bool(with_ledger)
    out.attrs["with_ledger"] = with_ledger

    if not with_ledger:
        return out

    fee_rate = (fee_bps or 0.0) / 10_000.0  # trade fee in BTC (base)
    contrib_fee_rate = (contrib_fee_bps or 0.0) / 10_000.0  # contribution fee in USDT

    usdt_balance = 0.0
    btc_balance = 0.0

    state = {
        "bear_pause": False,
        "was_above_p1": False,   # eligibility for retrace Case A ([+1.0σ, +1.5σ))
        "was_above_p15": False,  # eligibility for retrace Case B ([+1.5σ, +2.0σ))
        "r1_armed": True,        # retrace A can fire on next close < +0.5σ (edge-trigger)
        "r15_armed": True,       # retrace B can fire on next close < +1.0σ (edge-trigger)
    }

    rows = []

    for i, r in out.iterrows():
        px = float(r[price_col]) if isfinite(r[price_col]) else 0.0
        d = dt.datetime.strptime(r["date"], "%Y-%m-%d").date()

        # ---------------- Contributions ----------------
        contrib_gross = 0.0
        if i == 0:
            contrib_gross = float(start_contrib or 0.0)
        if monthly_only:
            if d.day == 1:
                if i != 0:
                    contrib_gross += float(monthly_contrib or 0.0)
                elif i == 0 and contrib_gross == 0.0:  # start_contrib=0 but month start
                    contrib_gross += float(monthly_contrib or 0.0)
        else:
            contrib_gross += float(monthly_contrib or 0.0)

        contrib_fee_usdt = contrib_gross * contrib_fee_rate
        contrib_net = contrib_gross - contrib_fee_usdt
        usdt_balance += contrib_net

        # ---------------- Sync precomputed bear-pause into state ----------------
        if "bear_pause" in r and pd.notna(r["bear_pause"]):
            prev_pause = bool(state.get("bear_pause", False))
            now_pause = bool(r["bear_pause"])
            # If we enter pause today, clear retrace eligibility & disarm
            if (not prev_pause) and now_pause:
                state["was_above_p1"] = False
                state["was_above_p15"] = False
                state["r1_armed"] = False
                state["r15_armed"] = False
            state["bear_pause"] = now_pause

        # ---------------- Decision ----------------
        action, pct, rule_name, note = decide_trade(px, r, state)

        # ---------------- Sizing & Fees (BASE for both sides) ----------------
        trade_btc = trade_usdt = fee_usdt = 0.0
        fee_btc = 0.0
        base = "USDT" if action == "BUY" else ("BTC" if action == "SELL" else "-")

        if action == "BUY" and pct > 0 and px > 0:
            notional_usdt = pct * usdt_balance
            if notional_usdt > 0:
                gross_btc = notional_usdt / px
                fee_btc = gross_btc * fee_rate
                net_btc = max(gross_btc - fee_btc, 0.0)
                trade_usdt = notional_usdt
                trade_btc = net_btc
                # update balances
                usdt_balance -= trade_usdt
                btc_balance += trade_btc

        elif action == "SELL" and pct > 0 and px > 0 and btc_balance > 0:
            target_qty = pct * btc_balance
            fee_on_target = target_qty * fee_rate
            total_btc_deduction = target_qty + fee_on_target
            # Cap to available BTC
            if total_btc_deduction > btc_balance:
                scale = btc_balance / total_btc_deduction if total_btc_deduction > 0 else 0.0
                target_qty *= scale
                fee_on_target *= scale
                total_btc_deduction = btc_balance
            proceeds_usdt = target_qty * px
            fee_btc = fee_on_target
            trade_btc = target_qty
            trade_usdt = proceeds_usdt
            # update balances
            btc_balance -= total_btc_deduction
            usdt_balance += trade_usdt

        # ---------------- Record ----------------
        nav_usd = usdt_balance + btc_balance * px
        rows.append({
            "date": r["date"],
            "price_usd": px,
            "band_bucket": sigma_bucket(px, r),
            "action": action,
            "rule": rule_name,
            "note": note,
            "amount_pct": pct,
            "base": base,
            "trade_btc": trade_btc,
            "trade_usdt": trade_usdt,
            "fee_usdt": fee_usdt,  # always 0 for trade fees now
            "fee_btc": fee_btc,
            "contrib_gross_usdt": contrib_gross,
            "contrib_fee_usdt": contrib_fee_usdt,
            "contrib_net_usdt": contrib_net,
            "contrib_usdt": contrib_net,  # backward compatible
            "usdt_balance": usdt_balance,
            "btc_balance": btc_balance,
            "nav_usd": nav_usd,
        })

    ledger = pd.DataFrame(rows)
    merged = pd.merge(out, ledger, on="date", how="left", suffixes=("", ""))
    merged["with_ledger"] = True

    # ---- Cumulative contributions ----
    if "contrib_gross_usdt" in merged.columns and "contrib_gross_usdt_cum" not in merged.columns:
        merged["contrib_gross_usdt_cum"] = merged["contrib_gross_usdt"].fillna(0).cumsum()
    if "contrib_net_usdt" in merged.columns:
        merged["contrib_net_usdt_cum"] = merged["contrib_net_usdt"].fillna(0).cumsum()

    # Use net contributions as invested capital; if absent, fall back to gross
    invested = None
    if "contrib_net_usdt_cum" in merged.columns:
        invested = merged["contrib_gross_usdt_cum"].copy()
    elif "contrib_gross_usdt_cum" in merged.columns:
        invested = merged["contrib_gross_usdt_cum"].copy()

    # ---- total_roi = NAV / invested - 1 (from trade start) ----
    if invested is not None:
        merged["total_roi"] = 0.0
        pos = invested > 0
        merged.loc[pos, "total_roi"] = (merged.loc[pos, "nav_usd"] / invested[pos]) - 1.0

        # ---- cagr = (NAV / invested)^(1/years) - 1 ----
        dates = pd.to_datetime(merged["date"])
        years = (dates - dates.iloc[0]).dt.days / 365.25
        merged["cagr"] = 0.0
        mask = pos & (years > 0)
        ratio = (merged.loc[mask, "nav_usd"] / invested[mask]).clip(lower=1e-12)
        merged.loc[mask, "cagr"] = ratio.pow(1.0 / years[mask]) - 1.0
    else:
        # If invested is unavailable, still add columns for schema stability
        merged["total_roi"] = 0.0
        merged["cagr"] = 0.0

    return merged



def write_csv_safely(df: pd.DataFrame, out_path: str, debug: bool = False) -> str:
    p = Path(out_path)
    try:
        df.to_csv(p, index=False)
        if debug:
            print(f"[DEBUG] wrote {p} with {len(df):,} rows.")
        return str(p)
    except PermissionError:
        ts = dt.datetime.now(dt.UTC).strftime("%Y%m%d_%H%M%S")
        alt = p.with_name(f"{p.stem}_{ts}{p.suffix}")
        df.to_csv(alt, index=False)
        print(f"[WARN] '{p.name}' appears locked. Wrote to '{alt.name}' instead.")
        return str(alt)


# ----------------------- Optimization Helpers -------------------------------

def _max_drawdown(nav: pd.Series) -> float:
    """Max drawdown as a fraction (0..1)."""
    if len(nav) == 0:
        return 0.0
    nav = nav.astype(float).fillna(method="ffill").fillna(0.0)
    roll_max = np.maximum.accumulate(nav.values)
    dd = np.where(roll_max > 0, (roll_max - nav.values) / roll_max, 0)
    return float(np.nanmax(dd) if dd.size else 0.0)

def _cash_drag(usdt: pd.Series, nav: pd.Series) -> float:
    """Average USDT/NAV (0..1)."""
    nav = nav.astype(float).replace(0.0, np.nan)
    ratio = (usdt.astype(float) / nav).clip(lower=0.0, upper=1.0)
    return float(np.nanmean(ratio))

def _time_splits_index(dates: List[str], k: int = 4, min_len: int = 200) -> List[Tuple[int, int]]:
    """Split the index into k contiguous windows (inclusive of start, exclusive of end)."""
    n = len(dates)
    if n < k * min_len:
        k = max(1, n // max(1, min_len))
    if k <= 1:
        return [(0, n)]
    edges = [int(round(i * n / k)) for i in range(k + 1)]
    edges = sorted(set(edges))
    pairs = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
    return [(a, b) for (a, b) in pairs if (b - a) >= min_len]

def _apply_bases(params: Dict[str, float]) -> None:
    """In-place update of global Base constants."""
    global B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11
    B1 = float(params["B1"]);   B2  = float(params["B2"]);   B3  = float(params["B3"])
    B4 = float(params["B4"]);   B5  = float(params["B5"])
    B6 = float(params["B6"]);   B7  = float(params["B7"]);   B8  = float(params["B8"])
    B9 = float(params["B9"]);   B10 = float(params["B10"]);  B11 = float(params["B11"])

def _get_bases() -> Dict[str, float]:
    """Return current global Base constants."""
    return {
        "B1": float(B1), "B2": float(B2), "B3": float(B3), "B4": float(B4), "B5": float(B5),
        "B6": float(B6), "B7": float(B7), "B8": float(B8), "B9": float(B9), "B10": float(B10), "B11": float(B11),
    }

def _metrics_from_out(out: pd.DataFrame) -> Tuple[float, float, float]:
    """(terminal NAV, max drawdown, avg cash-drag)."""
    nav = out["nav_usd"].astype(float)
    usdt = out["usdt_balance"].astype(float)
    nav_end = float(nav.iloc[-1]) if len(nav) else 0.0
    dd = _max_drawdown(nav)
    drag = _cash_drag(usdt, nav)
    return nav_end, dd, drag

def _score_params(
    df_ci: pd.DataFrame,
    params: Dict[str, float],
    *,
    splits: int,
    lam_dd: float,
    mu_drag: float,
    with_ledger: bool,
    start_contrib: float,
    monthly_contrib: float,
    monthly_only: bool,
    fee_bps: float,
    contrib_fee_bps: float,
    debug: bool = False,
) -> float:
    """Walk-forward robust score = median over splits of NAV_end / (1 + lam*DD + mu*drag)."""
    _apply_bases(params)

    df = map_ci_columns(df_ci)
    df = add_bear_pause_flags(df)

    dates = list(df["date"])
    windows = _time_splits_index(dates, k=splits, min_len=200)
    if debug:
        print(f"[DEBUG] evaluating over {len(windows)} splits: {windows}")

    fold_scores = []
    for (a, b) in windows:
        df_fold = df.iloc[a:b].reset_index(drop=True)
        out = build_ledger(
            df_fold,
            with_ledger=with_ledger,
            start_contrib=start_contrib,
            monthly_contrib=monthly_contrib,
            monthly_only=monthly_only,
            fee_bps=fee_bps,
            contrib_fee_bps=contrib_fee_bps,
            debug=False,
        )
        nav = out["nav_usd"].astype(float)
        usdt = out["usdt_balance"].astype(float)
        nav_end = float(nav.iloc[-1]) if len(nav) else 0.0
        dd = _max_drawdown(nav)
        drag = _cash_drag(usdt, nav)
        score = nav_end / (1.0 + lam_dd * dd + mu_drag * drag)
        fold_scores.append(score)

    if not fold_scores:
        return 0.0
    return float(np.median(fold_scores))

def _run_optuna(
    df_ci: pd.DataFrame,
    *,
    trials: int,
    splits: int,
    lam_dd: float,
    mu_drag: float,
    seed: int,
    with_ledger: bool,
    start_contrib: float,
    monthly_contrib: float,
    monthly_only: bool,
    fee_bps: float,
    contrib_fee_bps: float,
    debug: bool = False,
) -> Dict[str, float]:
    """Search Base sizes with monotonic constraints using Optuna."""
    try:
        import optuna  # lazy import
    except Exception as e:
        raise SystemExit(
            "Optuna is required for --optuna. Install with:  pip install optuna"
        ) from e

    def suggest_params(trial: "optuna.trial.Trial") -> Dict[str, float]:
        # ---- Buys (monotone decreasing): B1 >= B2 >= B3 >= B4 >= B5
        B1v = trial.suggest_float("B1", 0.05, 0.30)
        r2  = trial.suggest_float("buy_ratio_2", 0.30, 0.95); B2v = B1v * r2
        r3  = trial.suggest_float("buy_ratio_3", 0.30, 0.95); B3v = B2v * r3
        r4  = trial.suggest_float("buy_ratio_4", 0.30, 0.95); B4v = B3v * r4
        r5  = trial.suggest_float("buy_ratio_5", 0.30, 0.95); B5v = B4v * r5

        # ---- Sells (monotone increasing): B6 <= ... <= B11
        B6v = trial.suggest_float("B6", 0.001, 0.03)
        g7  = trial.suggest_float("sell_mult_7", 1.10, 3.00); B7v  = B6v * g7
        g8  = trial.suggest_float("sell_mult_8", 1.10, 3.00); B8v  = B7v * g8
        g9  = trial.suggest_float("sell_mult_9", 1.10, 3.00); B9v  = B8v * g9
        g10 = trial.suggest_float("sell_mult_10",1.10, 3.00); B10v = B9v * g10
        g11 = trial.suggest_float("sell_mult_11",1.10, 3.00); B11v = B10v * g11
        B11v = float(min(B11v, 0.35))

        return {"B1":B1v,"B2":B2v,"B3":B3v,"B4":B4v,"B5":B5v,
                "B6":B6v,"B7":B7v,"B8":B8v,"B9":B9v,"B10":B10v,"B11":B11v}

    def objective(trial: "optuna.trial.Trial") -> float:
        theta = suggest_params(trial)
        score = _score_params(
            df_ci,
            theta,
            splits=splits,
            lam_dd=lam_dd,
            mu_drag=mu_drag,
            with_ledger=with_ledger,
            start_contrib=start_contrib,
            monthly_contrib=monthly_contrib,
            monthly_only=monthly_only,
            fee_bps=fee_bps,
            contrib_fee_bps=contrib_fee_bps,
            debug=debug,
        )
        return score

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=seed))
    study.optimize(objective, n_trials=int(trials), show_progress_bar=debug)

    best = study.best_params
    best_full = {
        "B1": best["B1"],
        "B2": best["B1"] * best["buy_ratio_2"],
        "B3": best["B1"] * best["buy_ratio_2"] * best["buy_ratio_3"],
        "B4": best["B1"] * best["buy_ratio_2"] * best["buy_ratio_3"] * best["buy_ratio_4"],
        "B5": best["B1"] * best["buy_ratio_2"] * best["buy_ratio_3"] * best["buy_ratio_4"] * best["buy_ratio_5"],
        "B6": best["B6"],
        "B7": best["B6"] * best["sell_mult_7"],
        "B8": best["B6"] * best["sell_mult_7"] * best["sell_mult_8"],
        "B9": best["B6"] * best["sell_mult_7"] * best["sell_mult_8"] * best["sell_mult_9"],
        "B10": best["B6"] * best["sell_mult_7"] * best["sell_mult_8"] * best["sell_mult_9"] * best["sell_mult_10"],
        "B11": min(best["B6"] * best["sell_mult_7"] * best["sell_mult_8"] * best["sell_mult_9"] * best["sell_mult_10"] * best["sell_mult_11"], 0.35),
    }
    if debug:
        print("[DEBUG] Best Bases:", {k: round(v, 5) for k, v in best_full.items()})
        print("[DEBUG] Best score:", study.best_value)
    return best_full

# --------------------------- Main ------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="LTH PVR backtester using ChartInspect static bands (v1.1 Rule2).")
    parser.add_argument("--ci-price-key", required=True, help="ChartInspect API key (X-API-Key).")
    parser.add_argument("--start", default="2015-10-06", type=ymd_or_today, help="YYYY-MM-DD or 'today'.")
    parser.add_argument("--end", default="today", type=ymd_or_today, help="YYYY-MM-DD or 'today'.")
    parser.add_argument("--mode", default="static", choices=["static", "cumulative"], help="Band mode from CI.")
    parser.add_argument("--lookback-start", default="2010-01-01", type=ymd_or_today,
                        help="Fetch CI data from this earlier date to precompute bear-pause state (default 2010-01-01).")
    parser.add_argument("--out", default="lth_pvr_rule2_v1_1.csv", help="Output CSV path.")
    parser.add_argument("--debug", action="store_true", help="Verbose logging.")
    # ---- Optuna optimizer (optional) ----
    parser.add_argument("--optuna", action="store_true",
                        help="Run Optuna walk-forward optimization of Base sizes and write a CSV using the best set.")
    parser.add_argument("--trials", type=int, default=120,
                        help="Optuna trial count (default 120).")
    parser.add_argument("--splits", type=int, default=4,
                        help="Number of time splits for walk-forward scoring (default 4).")
    parser.add_argument("--lambda-dd", type=float, default=0.25,
                        help="Penalty weight for max drawdown in the robust score (default 0.25).")
    parser.add_argument("--mu-drag", type=float, default=0.10,
                        help="Penalty weight for average USDT/NAV cash drag (default 0.10).")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for Optuna's sampler (default 42).")

    # Ledger switch: ON by default
    parser.add_argument("--with-ledger", dest="with_ledger", action="store_true", default=True,
                        help="(Default ON) include ledger columns.")
    parser.add_argument("--no-ledger", dest="with_ledger", action="store_false",
                        help="Turn ledger OFF (metadata only).")

    # Ledger economics
    parser.add_argument("--start-contrib", type=float, default=0.00,
                        help="USDT contribution on the very first backtest day (gross, fee will be deducted).")
    parser.add_argument("--monthly-contrib", type=float, default=5000.00,
                        help="USDT contributed (gross) on the 1st of every month only.")
    parser.add_argument("--monthly-only", action="store_true", default=True,
                        help="Only contribute on the 1st calendar day of each month (default True).")
    parser.add_argument("--fee-bps", type=float, default=8.0,
                        help="Trading fee in basis points, charged in BASE (BTC) for buys & sells. Default 8 bps.")
    parser.add_argument("--contrib-fee-bps", type=float, default=18.0,
                        help="Contribution fee in basis points, charged in USDT. Default 18 bps (0.18%).")

    args, unknown = parser.parse_known_args()
    if args.debug and unknown:
        print(f"[DEBUG] Ignoring unknown flags: {unknown}")

    # Guard: start <= end (swap if needed)
    try:
        d_start = dt.datetime.strptime(args.start, "%Y-%m-%d").date()
        d_end = dt.datetime.strptime(args.end, "%Y-%m-%d").date()
    except Exception:
        d_start = d_end = None
    if d_start and d_end and d_start > d_end:
        print(f"[WARN] start ({args.start}) > end ({args.end}); swapping.")
        args.start, args.end = args.end, args.start

    if args.debug:
        print(f"[DEBUG] Window: {args.start} -> {args.end}")

    df_ci = fetch_ci_lth_pvr_bands(
        api_key=args.ci_price_key,
        start=args.lookback_start,  # fetch earlier to compute bear-pause state
        end=args.end,
        mode=args.mode,
        timeout=60,
        debug=args.debug,
    )

    # ---------------- Optuna branch ----------------
    if args.optuna:
        df_best = map_ci_columns(df_ci)
        df_best = add_bear_pause_flags(df_best)
        df_best["_dt"] = pd.to_datetime(df_best["date"])
        start_dt = pd.to_datetime(args.start); end_dt = pd.to_datetime(args.end)
        df_best = (
            df_best.loc[(df_best["_dt"] >= start_dt) & (df_best["_dt"] <= end_dt)]
                   .drop(columns=["_dt"])
                   .reset_index(drop=True)
        )

        # --- Baseline (with current Bases) ---
        baseline_bases = _get_bases()
        _apply_bases(baseline_bases)
        baseline_out = build_ledger(
            df_best,
            with_ledger=True,
            start_contrib=args.start_contrib,
            monthly_contrib=args.monthly_contrib,
            monthly_only=args.monthly_only,
            fee_bps=args.fee_bps,
            contrib_fee_bps=args.contrib_fee_bps,
            debug=False,
        )

        # --- Optimize Bases ---
        best = _run_optuna(
            df_ci,
            trials=args.trials,
            splits=args.splits,
            lam_dd=args.lambda_dd,
            mu_drag=args.mu_drag,
            seed=args.seed,
            with_ledger=True,
            start_contrib=args.start_contrib,
            monthly_contrib=args.monthly_contrib,
            monthly_only=args.monthly_only,
            fee_bps=args.fee_bps,
            contrib_fee_bps=args.contrib_fee_bps,
            debug=args.debug,
        )

        # --- Best run ---
        _apply_bases(best)
        best_out = build_ledger(
            df_best,
            with_ledger=True,
            start_contrib=args.start_contrib,
            monthly_contrib=args.monthly_contrib,
            monthly_only=args.monthly_only,
            fee_bps=args.fee_bps,
            contrib_fee_bps=args.contrib_fee_bps,
            debug=False,
        )
        final_path = write_csv_safely(best_out, args.out, debug=args.debug)

        b_nav, b_dd, b_drag = _metrics_from_out(baseline_out)
        o_nav, o_dd, o_drag = _metrics_from_out(best_out)
        imp = (o_nav / b_nav - 1.0) * 100.0 if b_nav > 0 else float("nan")

        print("\n=== LTH PVR: Baseline vs Optuna Best ===")
        print(f"Window: {args.start} → {args.end}")
        print(f"{'Metric':<14}{'Baseline':>15}{'Optuna Best':>15}{'Delta/Notes':>18}")
        print(f"{'-'*62}")
        print(f"{'Terminal NAV':<14}{b_nav:>15,.2f}{o_nav:>15,.2f}{imp:>17.2f}%")
        print(f"{'Max Drawdown':<14}{b_dd:>15.3f}{o_dd:>15.3f}{(o_dd-b_dd):>17.3f}")
        print(f"{'Cash Drag':<14}{b_drag:>15.3f}{o_drag:>15.3f}{(o_drag-b_drag):>17.3f}")
        pretty = ", ".join([f"{k}={best[k]:.5f}" for k in ["B1","B2","B3","B4","B5","B6","B7","B8","B9","B10","B11"]])
        print(f"\nBEST BASES → {pretty}")
        print(f"OPTUNA OK: wrote best-config CSV to {final_path}\n")
        return

    df = map_ci_columns(df_ci)
    df = add_bear_pause_flags(df)

    # Enforce local date filter (CI may ignore start/end).
    df["_dt"] = pd.to_datetime(df["date"])
    start_dt = pd.to_datetime(args.start)
    end_dt = pd.to_datetime(args.end)
    df = (
        df.loc[(df["_dt"] >= start_dt) & (df["_dt"] <= end_dt)]
          .drop(columns=["_dt"])
          .reset_index(drop=True)
    )
    if df.empty:
        raise RuntimeError(f"No CI rows in the requested window: {args.start} → {args.end}")

    out = build_ledger(
        df,
        with_ledger=args.with_ledger,
        start_contrib=args.start_contrib,
        monthly_contrib=args.monthly_contrib,
        monthly_only=args.monthly_only,
        fee_bps=args.fee_bps,
        contrib_fee_bps=args.contrib_fee_bps,
        debug=args.debug,
    )

    final_path = write_csv_safely(out, args.out, debug=args.debug)
    print(f"OK: wrote rails to {final_path}")


if __name__ == "__main__":
    main()
