# STH_CB Lab — a plain-language guide

This folder is a **test bench for the STH Cost Basis strategy that runs on your own PC**.

It exists because trying ideas through the Admin UI is slow (each back-test is a round trip to the
database, ~30 seconds) and every new idea would otherwise need new database columns. The lab runs the
**exact same strategy code and accounting** that the Admin UI back-tester uses, but in memory — one
full 2015 → today simulation takes about 15 milliseconds, so you can try thousands of variations in a
minute and only send the winners to the Admin UI for the charts.

> **Golden rule:** results from different date ranges or contribution amounts cannot be compared by
> final NAV. $10 000 + $500/month from 2015 will always produce a vastly bigger dollar number than
> $500 + $100/month from 2020, whatever the strategy. Compare **NAV ÷ HODL**, **CAGR**, **max
> drawdown** — and always use the same window when checking a lab result in the Admin UI.

---

## What is in this folder

| File | What it is | Do you run it? |
|---|---|---|
| `fetch.ts` | Downloads the daily BTC price, STH cost basis and LTH PVR bands from your database and saves them to `data/series.json` | Yes — once, and again whenever you want fresher data |
| `run.ts` | Simulates **one** strategy configuration and prints a full report with every trade | Yes |
| `optimize.ts` | Simulates **thousands** of configurations in parallel on all your CPU cores and ranks them | Yes |
| `ideas.ts` | The lists of parameter values the optimizer tries for each refinement idea | Only edit if you want to change the ranges being tested |
| `lab_core.ts` | Shared plumbing: reading `.env`, loading the cached data, scoring, CSV output | No |
| `worker.ts` | The background process the optimizer spawns per CPU core | No |
| `data/` | The cached series (git-ignored) | — |
| `results/` | One CSV per optimizer run with every configuration tried (git-ignored) | Open in Excel |

The strategy itself lives in the shared code the Admin UI also uses:

- `supabase/functions/_shared/sth_cb_strategy_logic.ts` — the **rules** (when to buy / sell)
- `supabase/functions/_shared/sth_cb_simulator.ts` — the **accounting** (contributions, fees, USDPC yield, benchmarks)

Because both the lab and the Admin UI call these two files, a configuration gives identical numbers in
both places (checked to the last cent).

---

## Prerequisites

- **Deno** (already installed on this machine — `deno --version` to check).
- The repo-root `.env` file with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORG_ID` (used only by
  `fetch.ts` to download the data).

All commands below are run from the repository root in PowerShell. `-A` just means "allow the script
to read files and use the network".

---

## Step 1 — Download the data (once)

```powershell
deno run -A tools/sth_cb_lab/fetch.ts
```

What it does: pulls ~5 800 daily rows (2011 → yesterday) of BTC price + STH cost basis, plus the LTH
PVR +σ band prices (needed only for refinement idea 4), and writes `data/series.json`.
Run it again any time you want the latest day included. Nothing else talks to the database.

---

## Step 2 — Test one configuration: `run.ts`

```powershell
deno run -A tools/sth_cb_lab/run.ts
```

With no options this simulates the **default strategy** (70 % capitulation buy, exit at the cost basis,
105 % trend entry, 95 % trend exit, momentum gate ROC-5 ≤ 0 %) from **2015-01-04 to the latest date**
with **$10 000 upfront + $500 per month**, next-day fills, and the full BitWealth fee stack.

### Options

| Option | Meaning | Default |
|---|---|---|
| `--start 2020-01-01` | First trading day | `2015-01-04` |
| `--end 2024-12-31` | Last trading day | latest date in the cache |
| `--upfront 1000` | Lump sum invested on day 1 (USDT) | `10000` |
| `--monthly 100` | Contribution on the first trading day of every month | `500` |
| `--same-day` | Fill at the same close as the signal (how ChartInspect back-tests). Without it the fill happens at the *next* day's close, which is what the live pipeline can actually achieve | next-day |
| `--fees exchange_only` | Only VALR exchange fees, no BitWealth management/performance fees, no USDPC. Use this to compare like-for-like with ChartInspect's numbers | `full` |
| `--config '{...}'` | Override the **base** strategy settings (see table of keys below) | — |
| `--extras '{...}'` | Switch on **refinement** flags (see table of keys below). `--config` and `--extras` are interchangeable; both are just merged over the defaults | — |
| `--walk-forward` | Also print a per-calendar-year table (explained in Step 4) | off |
| `--json` | Print the raw summary as JSON instead of the report (for scripts) | off |

Example — test idea 1 on a recent window with ChartInspect-style fills:

```powershell
deno run -A tools/sth_cb_lab/run.ts --start 2020-01-01 --upfront 500 --monthly 100 --same-day --extras '{"trendExitRatio":0.97,"trendExitConfirmDays":2}'
```

### Reading the report

```
Final NAV              $32,740,433   (HODL $24,029,095, Std DCA $6,333,369)
NAV ÷ HODL             1.363×
NAV ÷ Std DCA          5.170×
ROI / CAGR             40320% / 66.24%
Max drawdown           -52.0%
Calmar / Sharpe        1.27 / 1.56
Trades                 29 round-trips · 74.09% time in market
Fees                   mgmt/platform $1,104,181 · perf $3,750,088 · USDPC conv $223,801 · exch 4.2155 BTC
```

| Line | What it means |
|---|---|
| **Final NAV** | Portfolio value on the last day, after all fees. In brackets: the two benchmarks over the same window with the same contributions — **HODL** (buy everything on day 1 and never sell) and **Std DCA** (buy every contribution the day it arrives, never sell) |
| **NAV ÷ HODL** | The strategy's value divided by the HODL value. `1.36×` = 36 % better than just holding. **Below 1.0 means you would have been better off doing nothing.** This is the default ranking metric |
| **NAV ÷ Std DCA** | Same comparison against plain DCA |
| **ROI / CAGR** | Total return on gross contributions, and the equivalent compound annual growth rate |
| **Max drawdown** | The worst peak-to-trough fall in portfolio value (measured on a unit-value basis so new contributions don't disguise it). `-52 %` means at the worst point the portfolio was worth half its earlier peak |
| **Calmar** | CAGR ÷ max drawdown. Rewards smooth growth; higher is better |
| **Sharpe** | Average daily return ÷ its volatility, annualised. Higher = steadier |
| **Trades** | Number of all-in / all-out switches, and the share of days the portfolio held BTC |
| **Fees** | Total BitWealth management (or platform) fees, performance fees, USDPC conversion fees and VALR exchange fees over the whole run |

Below that is the **fill trail** — every trade: date, buy/sell, which rule fired, price, STH cost
basis, the price-to-cost-basis ratio, the momentum reading, the target BTC allocation and the NAV
after the trade. Read it to sanity-check that the rules did what you expect.

---

## Step 3 — Search for better settings: `optimize.ts`

```powershell
deno run -A tools/sth_cb_lab/optimize.ts --idea 1
```

This takes a **grid** (a list of candidate values for a few parameters), builds every combination,
simulates each one across all your CPU cores, ranks them and prints the top table. Every single
combination is also saved to `results/<timestamp>_<idea>_<objective>.csv`.

### Which `--idea` to pass

| `--idea` | What it sweeps | Combinations |
|---|---|---|
| `base` | The four price thresholds and the momentum gate of the original strategy | 3 840 |
| `1` | Anti-whipsaw: confirmation days and a slower momentum look-back on exits | 100 |
| `2` | Scale in / scale out: tiered buys at 70 %/60 %… and tiered sells at 150 %/200 %… | 25 |
| `3` | Only sell on the −5 % trend exit when the STH cost basis itself has stopped rising | 20 |
| `4` | Hybrid: sell at an LTH PVR +σ band instead of (or as well as) the −5 % exit | 16 |
| `5` | Re-entry ladder: after a −5 % exit, buy back at ~100 % instead of waiting for 105 % | 60 |
| `all` | Every parameter from every idea at once (≈ 150 million combinations — random sampling only) | sampled |

You can also pass your own grid instead of an idea:

```powershell
deno run -A tools/sth_cb_lab/optimize.ts --grid '{"trendExitRatio":[0.90,0.93,0.95],"momoLength":[3,5,8]}'
```

### Other options

| Option | Meaning | Default |
|---|---|---|
| `--objective X` | Which metric to rank by. One of `nav_vs_hodl`, `calmar`, `cagr`, `sharpe`, `final_nav`, `nav_vs_std_dca`. All metrics are always calculated and saved; this only decides the order | `nav_vs_hodl` |
| `--walk-forward` | Also score every calendar year separately and rank by *how many years beat HODL* first (see Step 4). Roughly 12× slower | off |
| `--mode grid` / `--mode random` | Try every combination, or a random sample of them | `auto` (random when the grid is bigger than `--samples`) |
| `--samples N` | How many random combinations to try | `2000` |
| `--base '{...}'` | Start every combination from this config instead of the defaults — use it to lock in a winner from a previous idea before testing the next one | defaults |
| `--top N` | How many rows to print | `20` |
| `--workers N` | How many CPU cores to use | all |
| `--start --end --upfront --monthly --fees --same-day` | Same meaning as in `run.ts` | same defaults |

Speed: ~65 configurations per second without walk-forward (≈ 240 000 per hour).

### Reading the top table

```
  #   nav_vs_hodl  NAV÷HODL  CAGR     MaxDD    Calmar Trades InMkt  WF    config
   1  1.397           1.40×    66.6%    -52%    1.28     25   74%  6/12  trendExitRatio=0.97 trendExitConfirmDays=2
```

| Column | Meaning |
|---|---|
| `#` | Rank |
| first metric column | The value of the `--objective` you chose |
| `NAV÷HODL`, `CAGR`, `MaxDD`, `Calmar` | As in the `run.ts` report |
| `Trades`, `InMkt` | Number of switches and % of days holding BTC |
| `WF` | Only with `--walk-forward`: calendar years in which the strategy beat HODL, out of the total |
| `config` | **Only the settings that differ from the defaults.** `(defaults)` = the unchanged base strategy |

The **Baseline** line under the table shows the default strategy's figures on the same window, so you
can see whether a "winner" is actually an improvement.

### The CSV

Each row is one configuration: `score`, `folds_beating_hodl`, `final_nav`, `nav_vs_hodl`,
`nav_vs_std_dca`, `cagr_pct`, `max_dd_pct`, `calmar`, `sharpe`, `trades`, `pct_in_market`,
`diff` (the human-readable settings that differ from default) and `config` (the complete JSON — this
is what you paste into the Admin UI).

---

## Step 4 — Guard against over-fitting: `--walk-forward`

With 150 million combinations it is easy to find settings that look spectacular purely because they
happened to fit the past — and will not repeat. Walk-forward is the sanity check.

With `--walk-forward`, each configuration is additionally simulated **one calendar year at a time**
(2015, 2016, … 2026), each year starting with the latch state the strategy would really have had on
1 January. For each year the lab asks "did it beat HODL *this* year?". The optimizer then ranks by the
**number of winning years first**, and only then by your objective.

How to read it: a configuration with `NAV÷HODL 2.98×` overall but `WF 5/12` made nearly all of its
gain in a handful of years and lost to HODL in seven. One with `1.4×` and `9/12` is less flashy but far
more likely to keep working. Prefer breadth over a big headline number.

Related: `--same-day` reproduces ChartInspect's fill assumption. Use it to check that your numbers
line up with theirs; use the default next-day fills for decisions, because that is what the live
pipeline can execute.

---

## Step 5 — Promote a result to the Admin UI

At the end of every optimizer run you get:

```
To reproduce #1 in the Admin UI, paste this into "Advanced (extras JSON)":
  {"trendExitRatio":0.97,"trendExitConfirmDays":2}
and set the SAME window and contributions: Start 2015-01-04, End 2026-10-23, Upfront $10000, Monthly $500, next-day fill.
```

1. Admin UI → **Strategy Back-Testing** → Strategy = **STH Cost Basis**.
2. Set Start / End / Upfront / Monthly **to the values shown** (or expect a different NAV).
3. Paste the JSON into **Advanced (extras JSON)** and click **Run back-test**.

Any key in the JSON — base or refinement — overrides the form fields; the form inputs are updated to
show what was used. If the JSON contains a key the engine does not know (a typo), the run fails with a
message listing the allowed keys rather than silently ignoring it. The run's stored summary contains
`effective_config` — the exact configuration that ran.

You can also copy the full `config` cell from the CSV; it is the same thing with every key spelled out.

---

## All configuration keys

Ratios are **price ÷ STH cost basis** (so `0.70` = price at 70 % of the cost basis).

### Base strategy

| Key | Default | Meaning |
|---|---|---|
| `capBuyRatio` | `0.70` | Rule 1 — buy everything when price falls to this ratio (capitulation) |
| `capExitRatio` | `1.00` | Rule 2 — sell everything bought under rule 1 when price recovers to this ratio |
| `trendEnterRatio` | `1.05` | Rule 3 — buy everything when price rises to this ratio (trend) |
| `trendExitRatio` | `0.95` | Rule 3 exit — sell the trend position when price falls to this ratio |
| `momoEnabled` | `true` | Master switch for the momentum gate on sells |
| `momoLength` | `5` | Momentum = % price change over this many days (ROC) |
| `momoThreshold` | `0` | A sell is allowed only once momentum ≤ this (0 = price no longer rising) |
| `momoOnCapExit` | `true` | Apply the gate to the rule-2 sell |
| `momoOnTrendExit` | `true` | Apply the gate to the rule-3 exit sell |

### Refinement ideas (all off unless set)

| Idea | Key | Example | Meaning |
|---|---|---|---|
| 1 | `trendExitConfirmDays` | `3` | The trend exit needs this many **consecutive** closes below `trendExitRatio` before it fires. A close back above the line resets the count |
| 1 | `exitRocLength` | `20` | Use a slower momentum reading (this many days) for the gate on **exits**, while entries keep `momoLength` |
| 2 | `capBuyTiers` | `[{"ratio":0.70,"alloc":0.5},{"ratio":0.60,"alloc":1}]` | Scale **in**: at 70 % hold 50 % BTC, at 60 % go to 100 %. Replaces `capBuyRatio` |
| 2 | `sellTiers` | `[{"ratio":1.5,"alloc":0.66},{"ratio":2.0,"alloc":0}]` | Scale **out** while in market: at 150 % of the cost basis reduce to 66 % BTC, at 200 % sell all (`alloc 0`). Tiers latch — a dip does not re-buy |
| 3 | `cbSlopeDays` | `14` | The trend exit only fires if the STH cost basis has been flat or falling over this many days. A rising cost basis with a −5 % dip is treated as a healthy pullback |
| 4 | `distributeAtSigma` | `2` | Sell everything when price reaches the LTH PVR **+2σ** band (allowed: 0.5, 1, 1.5, 2, 2.5) |
| 4 | `disableTrendExit` | `true` | Switch the −5 % trend exit off entirely (usually paired with `distributeAtSigma` or `sellTiers`) |
| 5 | `trendReentryRatio` | `1.00` | After a trend exit, re-enter at this ratio instead of waiting for `trendEnterRatio`. Not armed after a capitulation exit |

---

## Typical workflow

```powershell
deno run -A tools/sth_cb_lab/fetch.ts                                      # 1. fresh data
deno run -A tools/sth_cb_lab/run.ts                                        # 2. baseline report
deno run -A tools/sth_cb_lab/optimize.ts --idea base --walk-forward        # 3. tune the core thresholds robustly
deno run -A tools/sth_cb_lab/optimize.ts --idea 1 --walk-forward --base '{"trendExitRatio":0.97}'   # 4. add ideas on top of the winner
deno run -A tools/sth_cb_lab/run.ts --extras '{...}' --walk-forward        # 5. inspect the fill trail of the candidate
# 6. paste into the Admin UI with the same window → charts + companion LTH PVR comparison
```

---

## Adding a new idea (for the developer)

1. Add the flag to `SthCbConfig` and its behaviour to `decideSthCb()` in
   `sth_cb_strategy_logic.ts`, plus a unit test (`deno test supabase/functions/_shared/sth_cb_strategy_logic.test.ts`).
2. If it needs a new daily input (like the cost-basis slope), derive it in `sth_cb_simulator.ts` (`extraAt`).
3. Add the key to `EXTRA_CONFIG_KEYS` in the simulator and a grid entry in `ideas.ts`.

No database change is needed — the flag travels in `bt_params.extras`.
