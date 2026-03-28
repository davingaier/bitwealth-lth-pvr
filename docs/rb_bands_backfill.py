#!/usr/bin/env python3
"""
rb_bands_backfill.py

Backfills lth_pvr.rb_bands_daily using Research Bitcoin API data.
Computes LTH PVR bands day-by-day with a Welford running state built from
scratch (starting from the first available RB observation ≈ 2010-07-18).

The formula is identical to ef_fetch_rb_bands:
  cum_std      = sqrt(m2 / (n-1))  [Welford variance of daily LTH_MC]
  pvr_target   = pvr_mean + mult * pvr_std   (constants seeded from CI)
  price_at_X   = (pvr_target * cum_std + lth_rc) / lth_supply

Usage (PowerShell):
  $env:RB_API_TOKEN            = "<token>"
  $env:SUPABASE_URL            = "https://wqnmxpooabmedvtackji.supabase.co"
  $env:SUPABASE_SERVICE_ROLE_KEY = "<key>"
  python docs/rb_bands_backfill.py

Optional flags:
  --from YYYY-MM-DD    First output date  (default: 2010-01-01)
  --to   YYYY-MM-DD    Last  output date  (default: yesterday)
  --dry-run            Compute but do NOT write to the database
  --update-state       After writing, patch rb_bands_state with the final
                       Welford values so that future ef_fetch_rb_bands runs
                       remain consistent with the backfilled history
"""

import argparse
import csv
import io
import json
import math
import os
import sys
from datetime import date, datetime, timedelta

import requests

# ── Configuration ─────────────────────────────────────────────────────────────
RB_BASE  = "https://api.researchbitcoin.net/v2"
RB_TOKEN = os.getenv("RB_API_TOKEN", "")
SB_URL   = os.getenv("SUPABASE_URL", "")
SB_KEY   = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ORG_ID   = "b0a77009-03b9-44a1-ae1d-34f157d44a8b"

# Fixed constants seeded from ChartInspect — must match ef_fetch_rb_bands/index.ts
PVR_MEAN = 0.8725631072438145
PVR_STD  = 0.9661021921370878

BAND_MULTS: dict[str, float] = {
    "m100": -1.00, "m075": -0.75, "m050": -0.50, "m025": -0.25,
    "mean":  0.00, "p050":  0.50, "p100":  1.00, "p150":  1.50,
    "p200":  2.00, "p250":  2.50,
}

BATCH_SIZE = 500
SCHEMA     = "lth_pvr"


# ── ResearchBitcoin helpers ───────────────────────────────────────────────────
def rb_fetch(endpoint: str, from_dt: str, to_dt: str) -> dict[str, float]:
    """Download a single RB metric over a date range → {date_str: float}.

    NOTE: to_dt must be strictly greater than from_dt (RB API constraint).
    Pass to_dt = last_date + 1 day before calling.
    """
    url = (
        f"{RB_BASE}/{endpoint}"
        f"?resolution=d1&from_time={from_dt}&to_time={to_dt}"
    )
    label = endpoint.split("/")[-1]
    print(f"  Fetching {label:<32s}  {from_dt} → {to_dt}", end="  ", flush=True)
    resp = requests.get(url, headers={"X-API-Token": RB_TOKEN}, timeout=120)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))
    out: dict[str, float] = {}
    for row in reader:
        day_str = row["time"][:10]
        val_key = next(k for k in row if k != "time")
        try:
            out[day_str] = float(row[val_key])
        except (ValueError, TypeError):
            pass  # skip rows with empty / non-numeric values
    print(f"{len(out)} rows")
    return out


# ── Supabase REST helpers ─────────────────────────────────────────────────────
def _sb_headers() -> dict[str, str]:
    return {
        "apikey":          SB_KEY,
        "Authorization":   f"Bearer {SB_KEY}",
        "Content-Type":    "application/json",
        "Accept-Profile":  SCHEMA,
        "Content-Profile": SCHEMA,
    }


def sb_upsert(table: str, rows: list[dict]) -> None:
    """Upsert rows into an lth_pvr table via Supabase PostgREST."""
    url = f"{SB_URL}/rest/v1/{table}"
    headers = {**_sb_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"}
    resp = requests.post(
        url, headers=headers,
        params={"on_conflict": "org_id,date,mode"},
        data=json.dumps(rows),
        timeout=60,
    )
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(f"Upsert HTTP {resp.status_code}: {resp.text[:400]}")


def sb_patch(table: str, match: dict, data: dict) -> None:
    """PATCH matching rows in an lth_pvr table."""
    url = f"{SB_URL}/rest/v1/{table}"
    headers = {**_sb_headers(), "Prefer": "return=minimal"}
    params  = {k: f"eq.{v}" for k, v in match.items()}
    resp = requests.patch(url, headers=headers, params=params,
                          data=json.dumps(data), timeout=15)
    if resp.status_code not in (200, 201, 204):
        raise RuntimeError(f"Patch HTTP {resp.status_code}: {resp.text[:400]}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--from", dest="from_dt", default="2010-01-01",
        help="First date to include in output (YYYY-MM-DD, default: 2010-01-01)",
    )
    parser.add_argument(
        "--to", dest="to_dt",
        default=(date.today() - timedelta(days=1)).isoformat(),
        help="Last date to include in output  (YYYY-MM-DD, default: yesterday)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Compute bands but do NOT write to the database",
    )
    parser.add_argument(
        "--update-state", action="store_true",
        help=(
            "After writing, patch rb_bands_state with the final Welford values "
            "so future ef_fetch_rb_bands runs are consistent with this backfill"
        ),
    )
    args = parser.parse_args()

    # Validate env vars
    for val, name in [
        (RB_TOKEN, "RB_API_TOKEN"),
        (SB_URL,   "SUPABASE_URL"),
        (SB_KEY,   "SUPABASE_SERVICE_ROLE_KEY"),
    ]:
        if not val:
            sys.exit(f"Error: {name} environment variable is not set")

    # RB API: to_time must be strictly > from_time; add one day to our last date
    fetch_to = (date.fromisoformat(args.to_dt) + timedelta(days=1)).isoformat()

    print("=" * 65)
    print("  RB Bands Backfill")
    print(f"  Output range  : {args.from_dt} → {args.to_dt}")
    print(f"  Dry run       : {args.dry_run}")
    print(f"  Update state  : {args.update_state}")
    print("=" * 65)

    # ── Step 1: Fetch historical data ────────────────────────────────────────
    print("\nStep 1: Fetching historical data from Research Bitcoin API")
    supply      = rb_fetch("supply_distribution/supply_lth",   args.from_dt, fetch_to)
    realised    = rb_fetch("realizedprice/realized_price_lth", args.from_dt, fetch_to)
    price_data  = rb_fetch("price/price",                      args.from_dt, fetch_to)

    # ── Step 2: Compute Welford running state + bands ────────────────────────
    print("\nStep 2: Computing running Welford state and bands")

    # Welford is updated on every date where supply_lth AND price are available.
    # This ensures the running state is complete even for dates outside the
    # requested output range.
    all_mc_dates = sorted(set(supply) & set(price_data))
    if not all_mc_dates:
        sys.exit("Error: no overlapping dates between supply_lth and price series")

    print(f"  LTH_MC dates  : {all_mc_dates[0]} → {all_mc_dates[-1]}  ({len(all_mc_dates)} days)")

    mc_n:    float = 0.0   # using float for Welford accumulator; cast to int for DB
    mc_mean: float = 0.0
    mc_m2:   float = 0.0

    rows: list[dict] = []
    fetched_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    for d in all_mc_dates:
        lth_mc = supply[d] * price_data[d]

        # Welford online update (always, regardless of output date range)
        mc_n   += 1
        delta   = lth_mc - mc_mean
        mc_mean += delta / mc_n
        delta2  = lth_mc - mc_mean
        mc_m2  += delta * delta2

        # Only emit output rows within the requested range
        if d < args.from_dt or d > args.to_dt:
            continue
        # Need std dev (n >= 2) and realized price to compute bands
        if mc_n < 2 or d not in realised:
            continue

        cum_std    = math.sqrt(mc_m2 / (mc_n - 1))
        lth_supply = supply[d]
        lth_rc     = lth_supply * realised[d]
        btc_price  = price_data[d]

        band_cols: dict[str, float] = {}
        for band, mult in BAND_MULTS.items():
            pvr_t = PVR_MEAN + mult * PVR_STD
            band_cols[f"price_at_{band}"] = round(
                (pvr_t * cum_std + lth_rc) / lth_supply, 2
            )

        rows.append({
            "org_id":      ORG_ID,
            "date":        d,
            "mode":        "static",
            "btc_price":   round(btc_price, 2),
            **band_cols,
            "source_hash": None,
            "fetched_at":  fetched_at,
        })

    print(f"  Rows computed : {len(rows)}")
    if rows:
        r0, r1 = rows[0], rows[-1]
        print(
            f"  First row     : {r0['date']}  "
            f"m100={r0['price_at_m100']:>10,.2f}  "
            f"mean={r0['price_at_mean']:>10,.2f}  "
            f"p250={r0['price_at_p250']:>10,.2f}"
        )
        print(
            f"  Last row      : {r1['date']}  "
            f"m100={r1['price_at_m100']:>10,.2f}  "
            f"mean={r1['price_at_mean']:>10,.2f}  "
            f"p250={r1['price_at_p250']:>10,.2f}"
        )

    if args.dry_run:
        print("\nDry run — no data written to the database.")
        return

    if not rows:
        print("\nNo rows to write — nothing to do.")
        return

    # ── Step 3: Batch upsert to rb_bands_daily ───────────────────────────────
    print(f"\nStep 3: Upserting to lth_pvr.rb_bands_daily (batch size {BATCH_SIZE})")
    written = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        sb_upsert("rb_bands_daily", batch)
        written += len(batch)
        print(f"  {written:>5} / {len(rows)} rows written", end="\r", flush=True)
    print(f"  {written:>5} / {len(rows)} rows written ✓")

    # ── Step 4: (optional) update rb_bands_state ────────────────────────────
    if args.update_state:
        print("\nStep 4: Patching rb_bands_state with final Welford values")
        last_mc_date = all_mc_dates[-1]
        cum_std_final = math.sqrt(mc_m2 / (mc_n - 1)) if mc_n >= 2 else 0.0
        sb_patch(
            "rb_bands_state",
            {"org_id": ORG_ID},
            {
                "mc_n":      int(mc_n),
                "mc_mean":   round(mc_mean, 4),
                "mc_m2":     round(mc_m2, 4),
                "last_date": last_mc_date,
            },
        )
        print(f"  n={int(mc_n):,}, cum_std=${cum_std_final:,.2f}, last_date={last_mc_date}")

    print("\n=== Backfill complete ===")


if __name__ == "__main__":
    main()
