#!/usr/bin/env python3
"""
Walk-Forward Testing Orchestrator — LTH PVR Strategy
=====================================================

Runs two parallel test tracks across 9 annual OOS folds:
  Track A (Validation):   Frozen production params applied to each OOS window.
  Track B (Optimisation): Grid-search best params per training window applied to the same OOS window.

All simulation runs through the existing ef_bt_execute edge function.
All optimisation runs through the existing ef_optimize_lth_pvr_strategy edge function (3 phases
per fold to stay within the Supabase edge function 60 s timeout).

Fold structure — anchored / expanding windows, annual OOS periods:
  Fold 1: Train 2015-01-04 → 2016-12-31  |  OOS 2017-01-01 → 2017-12-31
  Fold 2: Train 2015-01-04 → 2017-12-31  |  OOS 2018-01-01 → 2018-12-31
  ...
  Fold 9: Train 2015-01-04 → 2024-12-31  |  OOS 2025-01-01 → 2025-12-31

Pass criterion per fold: LTH PVR OOS final NAV > Std DCA OOS final NAV.

Results are written to lth_pvr_bt.wft_runs, wft_folds, and wft_fold_daily for display
in the Admin UI Walk-Forward panel.

Required environment variables:
  SUPABASE_URL              Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY Service role key (NOT the publishable/anon key)
  ORG_ID                    Organisation UUID

Optional environment variables:
  WFT_VARIATION_ID    UUID of the variation to test (default: production variation)
  WFT_UPFRONT_USDT    Upfront USDT contribution per fold (default: 10000)
  WFT_MONTHLY_USDT    Monthly USDT contribution per fold (default: 500)
  WFT_BAND_SOURCE     rb or ci (default: rb)
  WFT_SKIP_TRACK_B    Set to 1 to skip optimisation and run Track A only (faster)
  WFT_START_FOLD      Resume from this fold number 1-9 (default: 1)
  WFT_RUN_ID          Resume an existing wft_run_id instead of creating a new one

Usage:
  pip install httpx
  python docs/wft/run_walk_forward.py
"""

import datetime
import os
import sys
import time
import uuid

try:
    import httpx
except ImportError:
    print("ERROR: httpx is required.  Run:  pip install httpx")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# Configuration from environment
# ─────────────────────────────────────────────────────────────────────────────

SUPABASE_URL  = (os.getenv("SUPABASE_URL") or os.getenv("SB_URL") or "").rstrip("/")
SERVICE_KEY   = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ORG_ID        = os.getenv("ORG_ID", "")

VARIATION_ID  = os.getenv("WFT_VARIATION_ID", "")   # default → production variation
UPFRONT_USDT  = float(os.getenv("WFT_UPFRONT_USDT", "10000"))
MONTHLY_USDT  = float(os.getenv("WFT_MONTHLY_USDT", "500"))
BAND_SOURCE   = os.getenv("WFT_BAND_SOURCE", "rb")
SKIP_TRACK_B  = os.getenv("WFT_SKIP_TRACK_B", "0") == "1"
START_FOLD    = int(os.getenv("WFT_START_FOLD", "1"))
RESUME_RUN_ID = os.getenv("WFT_RUN_ID", "")

# Standard fee parameters — match the public back-tester defaults
MAKER_BPS_TRADE   = 8.0      # 0.08% VALR BTC/USDT exchange fee (charged in BTC)
MAKER_BPS_CONTRIB = 18.0     # 0.18% VALR USDT/ZAR exchange fee (charged in USDT)
PLATFORM_FEE_PCT  = 0.0075   # 0.75% BitWealth platform fee on contributions
PERF_FEE_PCT      = 0.10     # 10%   BitWealth performance fee (high-water mark)

# Walk-forward fold definitions: (fold_number, train_end, oos_start, oos_end)
TRAIN_START = "2015-01-04"
FOLDS = [
    (1, "2016-12-31", "2017-01-01", "2017-12-31"),  # First major BTC bull run
    (2, "2017-12-31", "2018-01-01", "2018-12-31"),  # Crypto winter
    (3, "2018-12-31", "2019-01-01", "2019-12-31"),  # Recovery
    (4, "2019-12-31", "2020-01-01", "2020-12-31"),  # COVID crash + bull
    (5, "2020-12-31", "2021-01-01", "2021-12-31"),  # Parabolic bull run
    (6, "2021-12-31", "2022-01-01", "2022-12-31"),  # Bear + LUNA/FTX
    (7, "2022-12-31", "2023-01-01", "2023-12-31"),  # Recovery
    (8, "2023-12-31", "2024-01-01", "2024-12-31"),  # Halving + ETF bull
    (9, "2024-12-31", "2025-01-01", "2025-12-31"),  # Most recent year
]

REST       = f"{SUPABASE_URL}/rest/v1"
EF         = f"{SUPABASE_URL}/functions/v1"
BT_SCHEMA  = "lth_pvr_bt"

POLL_INTERVAL = 10   # seconds between bt_runs status checks
POLL_TIMEOUT  = 600  # seconds max wait per simulation run (10 minutes)


# ─────────────────────────────────────────────────────────────────────────────
# HTTP helpers
# ─────────────────────────────────────────────────────────────────────────────

def rest_headers(prefer: str = "", schema: str = "") -> dict:
    h = {
        "Authorization": f"Bearer {SERVICE_KEY}",
        "apikey":        SERVICE_KEY,
        "Content-Type":  "application/json",
    }
    if prefer:
        h["Prefer"] = prefer
    if schema:
        h["Accept-Profile"]  = schema
        h["Content-Profile"] = schema
    return h


def ef_headers() -> dict:
    return {
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type":  "application/json",
    }


def rest_get(client: httpx.Client, path: str, params: dict = None,
             schema: str = "") -> list:
    r = client.get(f"{REST}/{path}", params=params,
                   headers=rest_headers(schema=schema))
    r.raise_for_status()
    return r.json()


def rest_post(client: httpx.Client, path: str, data, schema: str = "") -> None:
    r = client.post(f"{REST}/{path}", json=data,
                    headers=rest_headers("return=minimal", schema=schema))
    r.raise_for_status()


def rest_patch(client: httpx.Client, path: str, params: dict,
               data: dict, schema: str = "") -> None:
    r = client.patch(f"{REST}/{path}", params=params, json=data,
                     headers=rest_headers("return=minimal", schema=schema))
    r.raise_for_status()


def ef_post(client: httpx.Client, function_name: str,
            data: dict, timeout: float = 90.0) -> dict:
    r = client.post(f"{EF}/{function_name}", json=data,
                    headers=ef_headers(), timeout=timeout)
    r.raise_for_status()
    return r.json()


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

def validate_env() -> None:
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL (or SB_URL)")
    if not SERVICE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not ORG_ID:
        missing.append("ORG_ID")
    if missing:
        print("ERROR: Missing required environment variables:")
        for m in missing:
            print(f"  $env:{m} = '...'")
        sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Strategy variation helpers
# ─────────────────────────────────────────────────────────────────────────────

def fetch_variation(client: httpx.Client, variation_id: str = "") -> dict:
    """Fetch a variation row from lth_pvr.strategy_variation_templates."""
    params = {"select": "*"}
    if variation_id:
        params["id"] = f"eq.{variation_id}"
    else:
        params["is_production"] = "eq.true"
    rows = rest_get(client, "strategy_variation_templates",
                    params=params, schema="lth_pvr")
    if not rows:
        label = variation_id or "production variation"
        raise ValueError(f"No variation found for {label} in lth_pvr.strategy_variation_templates")
    return rows[0]


def variation_to_bt_params(var: dict) -> dict:
    """Map a strategy_variation_templates row to bt_params column names."""
    return {
        "b1":  float(var["b1"]),
        "b2":  float(var["b2"]),
        "b3":  float(var["b3"]),
        "b4":  float(var["b4"]),
        "b5":  float(var["b5"]),
        "b6":  float(var["b6"]),
        "b7":  float(var["b7"]),
        "b8":  float(var["b8"]),
        "b9":  float(var["b9"]),
        "b10": float(var["b10"]),
        "b11": float(var["b11"]),
        "bear_pause_enter_sigma": float(var["bear_pause_enter_sigma"]),
        "bear_pause_exit_sigma":  float(var["bear_pause_exit_sigma"]),
        "momo_len":       int(var["momentum_length"]),
        "momo_thr":       float(var["momentum_threshold"]),
        "enable_retrace": bool(var["enable_retrace"]),
        "retrace_base":   int(var["retrace_base"]),
    }


def config_to_bt_params(cfg: dict) -> dict:
    """Map an optimizer StrategyConfig response to bt_params column names."""
    B = cfg.get("B", {})
    return {
        "b1":  float(B.get("B1", 0)),
        "b2":  float(B.get("B2", 0)),
        "b3":  float(B.get("B3", 0)),
        "b4":  float(B.get("B4", 0)),
        "b5":  float(B.get("B5", 0)),
        "b6":  float(B.get("B6", 0)),
        "b7":  float(B.get("B7", 0)),
        "b8":  float(B.get("B8", 0)),
        "b9":  float(B.get("B9", 0)),
        "b10": float(B.get("B10", 0)),
        "b11": float(B.get("B11", 0)),
        "bear_pause_enter_sigma": float(cfg.get("bearPauseEnterSigma", 2.0)),
        "bear_pause_exit_sigma":  float(cfg.get("bearPauseExitSigma", -1.0)),
        "momo_len":       int(cfg.get("momentumLength", 5)),
        "momo_thr":       float(cfg.get("momentumThreshold", 0.0)),
        "enable_retrace": bool(cfg.get("enableRetrace", True)),
        "retrace_base":   int(cfg.get("retraceBase", 3)),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Back-test execution helpers
# ─────────────────────────────────────────────────────────────────────────────

def create_bt_run(client: httpx.Client, oos_start: str, oos_end: str,
                  params_override: dict) -> str:
    """
    Create a bt_runs + bt_params row pair and return the bt_run_id.
    params_override must contain B1-B11, momo_len, momo_thr, enable_retrace, etc.
    """
    run_id = str(uuid.uuid4())

    # Insert bt_runs row
    rest_post(client, "bt_runs", {
        "bt_run_id":   run_id,
        "org_id":      ORG_ID,
        "status":      "running",
        "band_source": BAND_SOURCE,
    }, schema=BT_SCHEMA)

    # Insert bt_params row
    rest_post(client, "bt_params", {
        "bt_run_id":            run_id,
        "start_date":           oos_start,
        "end_date":             oos_end,
        "upfront_contrib_usdt": UPFRONT_USDT,
        "monthly_contrib_usdt": MONTHLY_USDT,
        "maker_bps_trade":      MAKER_BPS_TRADE,
        "maker_bps_contrib":    MAKER_BPS_CONTRIB,
        "platform_fee_pct":     PLATFORM_FEE_PCT,
        "performance_fee_pct":  PERF_FEE_PCT,
        **params_override,
    }, schema=BT_SCHEMA)

    return run_id


def run_and_poll_bt(client: httpx.Client, run_id: str) -> None:
    """
    Trigger ef_bt_execute for the given run_id and poll until completion.
    Raises TimeoutError after POLL_TIMEOUT seconds.
    """
    ef_post(client, "ef_bt_execute",
            {"bt_run_id": run_id, "band_source": BAND_SOURCE},
            timeout=120.0)

    deadline = time.time() + POLL_TIMEOUT
    while time.time() < deadline:
        rows = rest_get(client, "bt_runs",
                        params={"bt_run_id": f"eq.{run_id}",
                                "select": "status,error"},
                        schema=BT_SCHEMA)
        if not rows:
            raise RuntimeError(f"bt_run {run_id} disappeared")
        status = rows[0]["status"]
        if status == "ok":
            return
        if status == "error":
            raise RuntimeError(f"ef_bt_execute failed: {rows[0].get('error', '?')}")
        time.sleep(POLL_INTERVAL)

    raise TimeoutError(f"ef_bt_execute timed out after {POLL_TIMEOUT}s for run {run_id}")


def read_bt_results(client: httpx.Client, run_id: str, oos_start: str
                    ) -> tuple:
    """
    Read OOS simulation results from bt_results_daily and bt_std_dca_balances.
    Returns (lth_final_nav, std_dca_final_nav, cagr_pct, lth_daily, std_daily)
    where *_daily = list of {date, nav_usd, btc_balance, usdt_balance}.
    """
    # LTH PVR daily results
    lth_rows = rest_get(client, "bt_results_daily", params={
        "bt_run_id":  f"eq.{run_id}",
        "close_date": f"gte.{oos_start}",
        "select":     "close_date,nav_usd,btc_balance,usdt_balance,cagr_percent",
        "order":      "close_date.asc",
        "limit":      "2000",
    }, schema=BT_SCHEMA)

    # Std DCA daily results
    std_rows = rest_get(client, "bt_std_dca_balances", params={
        "bt_run_id":  f"eq.{run_id}",
        "trade_date": f"gte.{oos_start}",
        "select":     "trade_date,nav_usd,btc_balance,usdt_balance",
        "order":      "trade_date.asc",
        "limit":      "2000",
    }, schema=BT_SCHEMA)

    if not lth_rows:
        raise ValueError(f"No bt_results_daily rows for bt_run_id {run_id}")

    lth_final = float(lth_rows[-1]["nav_usd"])
    cagr      = float(lth_rows[-1].get("cagr_percent") or 0)
    std_final = float(std_rows[-1]["nav_usd"]) if std_rows else 0.0

    lth_daily = [
        {"date": r["close_date"], "nav_usd": float(r["nav_usd"]),
         "btc_balance": float(r.get("btc_balance") or 0),
         "usdt_balance": float(r.get("usdt_balance") or 0)}
        for r in lth_rows
    ]
    std_daily = [
        {"date": r["trade_date"], "nav_usd": float(r["nav_usd"]),
         "btc_balance": float(r.get("btc_balance") or 0),
         "usdt_balance": float(r.get("usdt_balance") or 0)}
        for r in std_rows
    ]

    return lth_final, std_final, cagr, lth_daily, std_daily


# ─────────────────────────────────────────────────────────────────────────────
# Phased optimiser helpers
# ─────────────────────────────────────────────────────────────────────────────

def _fixed_range(value: float) -> dict:
    """Return a b_range dict that locks a parameter to a single value."""
    return {"min": value, "max": value, "step": 1}


def run_optimizer_phases(client: httpx.Client, variation_id: str,
                         train_end: str, prod_params: dict) -> dict:
    """
    Run the 3-phase grid search over the training window and return the best
    StrategyConfig.  Each phase stays well within the 60 s EF timeout.

    Phase 1 — Momentum only  (~72 combos: momo_len 3-14 × momo_thr 0.00-0.05)
    Phase 2 — Buy-side B1-B5 (~243 combos: 3^5 with B6-B11 locked)
    Phase 3 — Sell-side B6-B11 (~729 combos: 3^6 with B1-B5 locked)

    Falls back gracefully to production params for any phase that fails.
    """
    # Defaults (used as fallback if a phase fails)
    best_momo_len = prod_params["momo_len"]
    best_momo_thr = prod_params["momo_thr"]
    best_buy_config: dict = {}    # {B1..B5} from Phase 2 best
    final_config: dict = {}

    # ── Phase 1: Momentum ────────────────────────────────────────────────────
    print("      Phase 1 – momentum sweep (momo_len 3-14 × momo_thr 0.00-0.05) …",
          end="", flush=True)
    try:
        resp1 = ef_post(client, "ef_optimize_lth_pvr_strategy", {
            "variation_id":         variation_id,
            "start_date":           TRAIN_START,
            "end_date":             train_end,
            "upfront_usd":          UPFRONT_USDT,
            "monthly_usd":          MONTHLY_USDT,
            "objective":            "sharpe",
            "band_source":          BAND_SOURCE,
            "grid_size":            1,      # keep all B values at current
            "momo_length_range":    {"min": 3,   "max": 14,   "step": 1},
            "momo_threshold_range": {"min": 0.0, "max": 0.05, "step": 0.01},
        }, timeout=120.0)
        best_momo_len = int(resp1["best"]["config"]["momentumLength"])
        best_momo_thr = float(resp1["best"]["config"]["momentumThreshold"])
        print(f" done. momo_len={best_momo_len}, momo_thr={best_momo_thr:.3f}")
    except Exception as exc:
        print(f" FAILED ({exc}). Using production momo params.")

    # Locked momo ranges for subsequent phases
    locked_momo = {
        "momo_length_range":    {"min": best_momo_len, "max": best_momo_len, "step": 1},
        "momo_threshold_range": {"min": best_momo_thr, "max": best_momo_thr, "step": 0.01},
    }

    # ── Phase 2: Buy-side B1-B5 (lock B6-B11 at production values) ──────────
    print("      Phase 2 – buy-side B1-B5 (grid_size=3, ±20%) …",
          end="", flush=True)
    try:
        locked_sell = {f"b{i}": _fixed_range(prod_params[f"b{i}"]) for i in range(6, 12)}
        resp2 = ef_post(client, "ef_optimize_lth_pvr_strategy", {
            "variation_id": variation_id,
            "start_date":   TRAIN_START,
            "end_date":     train_end,
            "upfront_usd":  UPFRONT_USDT,
            "monthly_usd":  MONTHLY_USDT,
            "objective":    "sharpe",
            "band_source":  BAND_SOURCE,
            "grid_size":    3,
            "b_ranges":     locked_sell,
            **locked_momo,
        }, timeout=120.0)
        best_buy_config = resp2["best"]["config"]["B"]
        print(f" done. B1={float(best_buy_config['B1']):.5f}")
    except Exception as exc:
        print(f" FAILED ({exc}). Using production buy-side params.")
        best_buy_config = {f"B{i}": prod_params[f"b{i}"] for i in range(1, 12)}

    # ── Phase 3: Sell-side B6-B11 (lock B1-B5 at Phase 2 best) ─────────────
    print("      Phase 3 – sell-side B6-B11 (grid_size=3, ±20%) …",
          end="", flush=True)
    try:
        locked_buy = {f"b{i}": _fixed_range(float(best_buy_config[f"B{i}"]))
                      for i in range(1, 6)}
        resp3 = ef_post(client, "ef_optimize_lth_pvr_strategy", {
            "variation_id": variation_id,
            "start_date":   TRAIN_START,
            "end_date":     train_end,
            "upfront_usd":  UPFRONT_USDT,
            "monthly_usd":  MONTHLY_USDT,
            "objective":    "sharpe",
            "band_source":  BAND_SOURCE,
            "grid_size":    3,
            "b_ranges":     locked_buy,
            **locked_momo,
        }, timeout=120.0)
        final_config = resp3["best"]["config"]
        # Patch best buy-side values back in (Phase 3 locked buy side with Phase 2 values,
        # so resp3's B config already contains the Phase 2 best B1-B5)
        print(f" done. B6={float(final_config['B']['B6']):.5f}")
    except Exception as exc:
        print(f" FAILED ({exc}). Assembling best config from earlier phases.")
        # Assemble best available: Phase 1 momo + Phase 2 buy + production sell
        fallback_B = {f"B{i}": float(best_buy_config.get(f"B{i}",
                                     prod_params[f"b{i}"])) for i in range(1, 12)}
        var_row = fetch_variation.__wrapped__ if hasattr(fetch_variation, "__wrapped__") \
                  else None  # already have prod_params, reconstruct StrategyConfig
        final_config = {
            "B": fallback_B,
            "bearPauseEnterSigma": prod_params["bear_pause_enter_sigma"],
            "bearPauseExitSigma":  prod_params["bear_pause_exit_sigma"],
            "momentumLength":      best_momo_len,
            "momentumThreshold":   best_momo_thr,
            "enableRetrace":       prod_params["enable_retrace"],
            "retraceBase":         prod_params["retrace_base"],
        }

    return final_config


# ─────────────────────────────────────────────────────────────────────────────
# WFT DB write helpers
# ─────────────────────────────────────────────────────────────────────────────

def create_wft_run(client: httpx.Client, variation_id: str) -> str:
    run_id = str(uuid.uuid4())
    rest_post(client, "wft_runs", {
        "wft_run_id":   run_id,
        "org_id":       ORG_ID,
        "variation_id": variation_id,
        "band_source":  BAND_SOURCE,
        "description":  f"WFT initiated {datetime.date.today().isoformat()}",
        "upfront_usdt": UPFRONT_USDT,
        "monthly_usdt": MONTHLY_USDT,
        "folds_total":  9,
        "status":       "running",
    }, schema=BT_SCHEMA)
    return run_id


def create_wft_fold(client: httpx.Client, wft_run_id: str, fold_num: int,
                    train_start: str, train_end: str,
                    oos_start: str, oos_end: str) -> str:
    fold_id = str(uuid.uuid4())
    rest_post(client, "wft_folds", {
        "wft_fold_id": fold_id,
        "wft_run_id":  wft_run_id,
        "fold_number": fold_num,
        "train_start": train_start,
        "train_end":   train_end,
        "oos_start":   oos_start,
        "oos_end":     oos_end,
        "status":      "pending",
    }, schema=BT_SCHEMA)
    return fold_id


def update_wft_fold(client: httpx.Client, fold_id: str, updates: dict) -> None:
    rest_patch(client, "wft_folds",
               params={"wft_fold_id": f"eq.{fold_id}"},
               data=updates, schema=BT_SCHEMA)


def update_wft_run(client: httpx.Client, wft_run_id: str, updates: dict) -> None:
    rest_patch(client, "wft_runs",
               params={"wft_run_id": f"eq.{wft_run_id}"},
               data=updates, schema=BT_SCHEMA)


def write_wft_fold_daily(client: httpx.Client, fold_id: str,
                         track: str, rows: list) -> None:
    """Bulk-insert daily OOS NAV rows for one track of one fold."""
    payload = [
        {
            "wft_fold_id":  fold_id,
            "result_date":  r["date"],
            "track":        track,
            "nav_usd":      r["nav_usd"],
            "btc_balance":  r.get("btc_balance"),
            "usdt_balance": r.get("usdt_balance"),
        }
        for r in rows
    ]
    chunk_size = 500
    for i in range(0, len(payload), chunk_size):
        rest_post(client, "wft_fold_daily",
                  payload[i:i + chunk_size], schema=BT_SCHEMA)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    validate_env()

    print("=" * 70)
    print("LTH PVR Walk-Forward Testing Orchestrator")
    print("=" * 70)
    print(f"  Supabase URL  : {SUPABASE_URL}")
    print(f"  Band source   : {BAND_SOURCE}")
    print(f"  Contributions : ${UPFRONT_USDT:,.0f} upfront + ${MONTHLY_USDT:,.0f}/month")
    print(f"  Skip Track B  : {SKIP_TRACK_B}")
    print(f"  Starting fold : {START_FOLD}")
    if RESUME_RUN_ID:
        print(f"  Resuming run  : {RESUME_RUN_ID}")
    print()

    with httpx.Client(timeout=30.0) as client:

        # ── Resolve or resume WFT run ─────────────────────────────────────────
        # When launched from the Admin UI, WFT_RUN_ID is set and the run row
        # already exists in the DB with status='queued'.  Read its parameters
        # from the DB so the user doesn't need to set every env var manually.
        upfront_usdt = UPFRONT_USDT
        monthly_usdt = MONTHLY_USDT
        band_source  = BAND_SOURCE
        skip_b       = SKIP_TRACK_B
        variation_id_override = VARIATION_ID

        if RESUME_RUN_ID:
            wft_run_id = RESUME_RUN_ID
            print(f"Resuming WFT run: {wft_run_id} …", end="", flush=True)
            # Read run row to pick up UI-configured parameters
            rows = rest_get(client, "wft_runs",
                            params={"wft_run_id": f"eq.{wft_run_id}", "select": "*"},
                            schema=BT_SCHEMA)
            if not rows:
                print(f"\nERROR: wft_run_id {wft_run_id} not found in wft_runs.")
                sys.exit(1)
            run_row = rows[0]
            upfront_usdt          = float(run_row.get("upfront_usdt") or upfront_usdt)
            monthly_usdt          = float(run_row.get("monthly_usdt") or monthly_usdt)
            band_source           = run_row.get("band_source") or band_source
            variation_id_override = run_row.get("variation_id") or variation_id_override
            print(" loaded.")

            # Transition queued → running
            if run_row.get("status") == "queued":
                update_wft_run(client, wft_run_id, {
                    "status":     "running",
                    "started_at": _utcnow(),
                })
            print()
        else:
            wft_run_id = None

        # Override module-level globals so all helpers pick up the resolved values
        globals()["UPFRONT_USDT"] = upfront_usdt
        globals()["MONTHLY_USDT"] = monthly_usdt
        globals()["BAND_SOURCE"]  = band_source

        # ── Resolve variation ─────────────────────────────────────────────────
        print("Fetching variation …", end="", flush=True)
        variation = fetch_variation(client, variation_id_override)
        variation_id   = variation["id"]
        variation_name = variation.get("display_name") or variation["variation_name"]
        prod_params    = variation_to_bt_params(variation)
        print(f" {variation_name} ({variation_id})")
        print()

        # ── Create new WFT run record (if not resuming) ───────────────────────
        if not wft_run_id:
            wft_run_id = create_wft_run(client, variation_id)
            print(f"Created WFT run: {wft_run_id}")
        print()

        track_a_passes = 0
        track_b_passes = 0
        folds_attempted = 0

        # ── Process each fold ─────────────────────────────────────────────────
        for fold_num, train_end, oos_start, oos_end in FOLDS:
            if fold_num < START_FOLD:
                continue

            folds_attempted += 1
            print(f"{'─' * 70}")
            print(f"Fold {fold_num}/9  |  Train: {TRAIN_START} → {train_end}"
                  f"  |  OOS: {oos_start} → {oos_end}")
            print(f"{'─' * 70}")

            fold_id = create_wft_fold(
                client, wft_run_id, fold_num,
                TRAIN_START, train_end, oos_start, oos_end,
            )

            fold_updates: dict = {}
            std_daily_rows: list = []

            # ── Track A: Validation ──────────────────────────────────────────
            print("  [Track A] Validation — frozen production params …")
            try:
                update_wft_fold(client, fold_id, {"status": "simulating"})
                run_id_a = create_bt_run(client, oos_start, oos_end, prod_params)
                run_and_poll_bt(client, run_id_a)
                a_nav, a_std, a_cagr, daily_a, std_daily_rows = \
                    read_bt_results(client, run_id_a, oos_start)
                a_passed = a_nav > a_std
                if a_passed:
                    track_a_passes += 1
                verdict = "✅ PASS" if a_passed else "❌ FAIL"
                print(f"  [Track A] LTH=${a_nav:,.0f}  StdDCA=${a_std:,.0f}"
                      f"  CAGR={a_cagr:.1f}%  → {verdict}")

                fold_updates.update({
                    "track_a_bt_run_id":        run_id_a,
                    "track_a_oos_final_nav":     a_nav,
                    "track_a_std_dca_final_nav": a_std,
                    "track_a_oos_cagr_pct":      a_cagr,
                    "track_a_passed":            a_passed,
                })
                write_wft_fold_daily(client, fold_id, "a", daily_a)
                write_wft_fold_daily(client, fold_id, "std_dca", std_daily_rows)

            except Exception as exc:
                print(f"  [Track A] ERROR: {exc}")
                fold_updates.update({
                    "status":        "failed",
                    "error_message": f"Track A: {exc}",
                })
                update_wft_fold(client, fold_id, fold_updates)
                update_wft_run(client, wft_run_id,
                               {"folds_completed": fold_num})
                continue

            # ── Track B: Optimisation ────────────────────────────────────────
            if SKIP_TRACK_B:
                print("  [Track B] Skipped (WFT_SKIP_TRACK_B=1).")
                fold_updates.update({
                    "status":       "completed",
                    "completed_at": _utcnow(),
                })
            else:
                print(f"  [Track B] Optimising on {TRAIN_START} → {train_end} …")
                try:
                    update_wft_fold(client, fold_id, {"status": "optimising"})
                    best_config = run_optimizer_phases(
                        client, variation_id, train_end, prod_params,
                    )

                    print("  [Track B] Running OOS simulation with optimised params …")
                    update_wft_fold(client, fold_id, {"status": "simulating"})
                    run_id_b = create_bt_run(client, oos_start, oos_end,
                                            config_to_bt_params(best_config))
                    run_and_poll_bt(client, run_id_b)
                    b_nav, b_std, b_cagr, daily_b, _ = \
                        read_bt_results(client, run_id_b, oos_start)
                    b_passed = b_nav > b_std
                    if b_passed:
                        track_b_passes += 1
                    verdict = "✅ PASS" if b_passed else "❌ FAIL"
                    print(f"  [Track B] LTH=${b_nav:,.0f}  StdDCA=${b_std:,.0f}"
                          f"  CAGR={b_cagr:.1f}%  → {verdict}")

                    fold_updates.update({
                        "track_b_best_config":       best_config,
                        "track_b_bt_run_id":         run_id_b,
                        "track_b_oos_final_nav":     b_nav,
                        "track_b_std_dca_final_nav": b_std,
                        "track_b_oos_cagr_pct":      b_cagr,
                        "track_b_passed":            b_passed,
                        "status":                    "completed",
                        "completed_at":              _utcnow(),
                    })
                    write_wft_fold_daily(client, fold_id, "b", daily_b)

                except Exception as exc:
                    print(f"  [Track B] ERROR: {exc}")
                    fold_updates.update({
                        "status":        "completed",   # Track A still valid
                        "completed_at":  _utcnow(),
                        "error_message": f"Track B: {exc}",
                    })

            update_wft_fold(client, fold_id, fold_updates)
            update_wft_run(client, wft_run_id, {"folds_completed": fold_num})
            print()

        # ── Finalise run ──────────────────────────────────────────────────────
        update_wft_run(client, wft_run_id, {
            "status":       "completed",
            "completed_at": _utcnow(),
        })

        print("=" * 70)
        print(f"Walk-Forward Test Complete")
        print(f"  wft_run_id     : {wft_run_id}")
        print(f"  Track A (Validation):   {track_a_passes}/{folds_attempted} folds passed")
        if not SKIP_TRACK_B:
            print(f"  Track B (Optimisation): {track_b_passes}/{folds_attempted} folds passed")
        print("=" * 70)
        print()
        print("View results in the Admin UI → Strategy Back-Testing → Walk-Forward Validation")
        print(f"Or query directly: SELECT * FROM lth_pvr_bt.v_wft_summary WHERE wft_run_id = '{wft_run_id}';")


def _utcnow() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


if __name__ == "__main__":
    main()
