# STH_CB Lab — local experimentation & optimisation

Runs the **exact same simulator** the admin back-tester uses
(`supabase/functions/_shared/sth_cb_simulator.ts` + `sth_cb_strategy_logic.ts`) in-memory on
your machine, so you can test refinement ideas and sweep parameters without touching the
database. A full 2015→2026 simulation takes ~15 ms; the optimizer evaluates ~60–70 configs/s
per run on all CPU cores.

Requires [Deno](https://deno.land) (already installed) and the repo-root `.env`
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORG_ID`) for the one-off data fetch.

## 1. Fetch / refresh the series (once)

```powershell
deno run -A tools/sth_cb_lab/fetch.ts
```
Caches price + STH cost basis (from `get_sth_cost_basis_series`) and LTH PVR RB bands (for idea 4)
to `tools/sth_cb_lab/data/series.json` (git-ignored). Re-run whenever you want yesterday's data.

## 2. Run one configuration

```powershell
deno run -A tools/sth_cb_lab/run.ts                                   # defaults, 2015-01-04 → latest
deno run -A tools/sth_cb_lab/run.ts --start 2020-01-01 --upfront 1000 --monthly 100
deno run -A tools/sth_cb_lab/run.ts --extras '{"trendExitConfirmDays":2}' --config '{"trendExitRatio":0.97}'
deno run -A tools/sth_cb_lab/run.ts --same-day --fees exchange_only   # ChartInspect-style comparison
deno run -A tools/sth_cb_lab/run.ts --walk-forward                    # per-calendar-year OOS table
```
Prints NAV / NAV÷HODL / CAGR / max drawdown / Calmar / Sharpe / trades / fees and the full fill trail.

## 3. Optimise an idea

```powershell
deno run -A tools/sth_cb_lab/optimize.ts --idea base                    # thresholds + momentum (3 840 combos)
deno run -A tools/sth_cb_lab/optimize.ts --idea 1                       # anti-whipsaw (confirm days / slow ROC)
deno run -A tools/sth_cb_lab/optimize.ts --idea 2                       # scale in / scale out tiers
deno run -A tools/sth_cb_lab/optimize.ts --idea 3                       # cost-basis slope filter
deno run -A tools/sth_cb_lab/optimize.ts --idea 4                       # distribute at LTH PVR +σ bands
deno run -A tools/sth_cb_lab/optimize.ts --idea 5                       # re-entry ladder
deno run -A tools/sth_cb_lab/optimize.ts --idea all --mode random --samples 5000 --walk-forward
deno run -A tools/sth_cb_lab/optimize.ts --grid '{"trendExitRatio":[0.9,0.93,0.95],"momoLength":[3,5,8]}'
```

| Flag | Meaning |
|---|---|
| `--objective` | `nav_vs_hodl` (default), `calmar`, `cagr`, `sharpe`, `final_nav`, `nav_vs_std_dca` — all metrics are always reported, this one ranks |
| `--walk-forward` | Also score each calendar year as an out-of-sample window (seeded by warm-up to that date). Results are ranked first by *years beating HODL*, then by the objective — your over-fitting guard |
| `--mode grid\|random\|auto` / `--samples N` | Full enumeration or reproducible random sample (auto = random when grid > samples) |
| `--base '{...}'` | Config every combination is merged onto (e.g. lock in a winner from a previous idea) |
| `--start --end --upfront --monthly --fees --same-day` | Same as `run.ts` |
| `--workers N` / `--top N` | Parallelism (default = CPU cores) and table size |

Every evaluated combination is written to `tools/sth_cb_lab/results/<timestamp>_<idea>_<objective>.csv`
(score, all metrics, config diff, full config JSON) for Excel / further analysis.

## 4. Promote a winner to the Admin UI

The optimizer prints the winning config's non-default keys as JSON. Paste it into
**Strategy Back-Testing → STH Cost Basis → Advanced (extras JSON)** and run — the edge function
merges it over the form fields (`simParamsFromBtParams`), so you get the charts, the companion LTH PVR
overlay and a persistent `sth_cb_bt` run. Lab and edge function produce identical numbers
(regression-checked to the last digit on 2026-10-24).

## Adding a new idea

1. Add the flag to `SthCbConfig` and its behaviour to `decideSthCb()` in
   `supabase/functions/_shared/sth_cb_strategy_logic.ts` (+ a unit test).
2. If it needs a new per-day input, derive it in `sth_cb_simulator.ts` (`extraAt`).
3. Add the key to `EXTRA_CONFIG_KEYS` in the simulator and a grid in `ideas.ts`.

No migration is needed — the flag travels in `bt_params.extras`.

## Ideas implemented

| # | Flags | Idea |
|---|---|---|
| 1 | `trendExitConfirmDays`, `exitRocLength` | require N closes below the exit line / gate exits on a slower ROC |
| 2 | `capBuyTiers`, `sellTiers` | scale in at 70 %/60 %…, scale out at 150 %/200 %… of the STH CB |
| 3 | `cbSlopeDays` | only honour the trend exit when the STH CB itself is flat/falling |
| 4 | `distributeAtSigma`, `disableTrendExit` | sell at LTH PVR +1.5σ/+2σ/+2.5σ instead of (or as well as) −5 % |
| 5 | `trendReentryRatio` | after a trend exit re-enter at 100 % instead of 105 % |
| 6 | `--same-day`, `--walk-forward` | validation modes |
