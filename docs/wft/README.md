# Walk-Forward Testing — Python Orchestrator

## Prerequisites

```powershell
pip install httpx
```

## Required Environment Variables

```powershell
$env:SUPABASE_URL              = "https://wqnmxpooabmedvtackji.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<your-service-role-key>"
$env:ORG_ID                    = "b0a77009-03b9-44a1-ae1d-34f157d44a8b"
```

## Optional Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WFT_VARIATION_ID` | production variation | UUID of variation to test |
| `WFT_UPFRONT_USDT` | `10000` | Upfront USDT contribution |
| `WFT_MONTHLY_USDT` | `500` | Monthly USDT contribution |
| `WFT_BAND_SOURCE` | `rb` | `rb` or `ci` |
| `WFT_SKIP_TRACK_B` | `0` | Set to `1` to skip optimisation (Track A only, ~3× faster) |
| `WFT_START_FOLD` | `1` | Resume from this fold (1-9) |
| `WFT_RUN_ID` | *(new)* | Resume an existing `wft_run_id` |

## Running

> **Important:** Run all commands from the **project root** — the folder containing `docs\wft\`.
> ```powershell
> Set-Location "C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr"
> ```

```powershell
# Full run (both tracks, all 9 folds) — estimated 3-6 hours
python docs/wft/run_walk_forward.py

# Validation only (Track A, no optimisation) — estimated 30-60 minutes
$env:WFT_SKIP_TRACK_B = "1"
python docs/wft/run_walk_forward.py

# Resume from fold 5
$env:WFT_START_FOLD = "5"
$env:WFT_RUN_ID     = "<existing-wft-run-id>"
python docs/wft/run_walk_forward.py
```

## Output

Results are written to:
- `lth_pvr_bt.wft_runs` — one row per run
- `lth_pvr_bt.wft_folds` — one row per fold (9 per run)
- `lth_pvr_bt.wft_fold_daily` — daily OOS NAV per fold/track (for charts)

View in the Admin UI → **Strategy Back-Testing → Walk-Forward Validation** panel,
or query directly:

```sql
SELECT * FROM lth_pvr_bt.v_wft_summary
WHERE wft_run_id = '<your-run-id>'
ORDER BY fold_number;
```

## How It Works

### Fold Structure (Anchored / Expanding Windows)
```
Fold 1: Train 2015-01-04 → 2016-12-31  |  OOS 2017
Fold 2: Train 2015-01-04 → 2017-12-31  |  OOS 2018
...
Fold 9: Train 2015-01-04 → 2024-12-31  |  OOS 2025
```

### Track A — Validation
Runs the frozen production variation parameters through each OOS period
**without any optimisation**.  Directly answers: *did the current parameters
just happen to work on the data they were tuned on, or do they generalise?*

### Track B — Optimisation
For each fold:
1. **Phase 1**: Calls `ef_optimize_lth_pvr_strategy` with momentum sweep
   (momo_len 3-14 × momo_thr 0.00-0.05, ~72 combos).
2. **Phase 2**: Calls again with buy-side B1-B5 at grid_size=3 (~243 combos),
   sell side locked at production values, best momo from Phase 1 locked.
3. **Phase 3**: Calls again with sell-side B6-B11 at grid_size=3 (~729 combos),
   buy side locked at Phase 2 best, momo locked.

Then runs `ef_bt_execute` on the OOS window with the assembled best config.

### Pass Criterion
A fold **passes** if `LTH PVR OOS final NAV > Std DCA OOS final NAV`.

### Efficiency Ratio
`passes / 9 folds`.  A score of ≥ 7/9 (78%) on Track A indicates the
current production parameters are robust and not merely in-sample lucky.
