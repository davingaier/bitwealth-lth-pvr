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
| `ladder_optimize.ts` | Searches the v2 scale-out ladder itself — which LTH PVR bands to sell at and how much (1-dp sizes) | Yes, when tuning the ladder |
| `ideas.ts` | The lists of parameter values the optimizer tries for each refinement idea | Only edit if you want to change the ranges being tested |
| `lab_core.ts` | Shared plumbing: reading `.env`, loading the cached data, scoring, CSV output | No |
| `pool.ts` | The CPU-core worker pool shared by both optimizers | No |
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
| `--trade-bps 10` | Exchange fee on each BTC buy/sell in basis points (ChartInspect uses `fee 0.001` = 10 bps) | `8` (VALR) |
| `--contrib-bps 0` | Fee on each contribution in basis points (ZAR→USDT). ChartInspect has none | `18` (VALR) |
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
| `7`–`12` | σ-adaptive thresholds, momentum re-entry, minimum hold, LTH macro filter, capitulation confirmation, trailing stop | small |
| `hybrid` | The LTH-distribution neighbourhood that won the lump-sum campaign (20 knobs incl. ideas 13/14) | sampled |
| `fine` | Tight steps around the current winner — use with `--base '{winner}'` | sampled |
| `v2` | Ideas 15/16: scale-out ladders at the LTH PVR upper bands, momentum gate, dip re-buy — use with `--base '{hybrid v1}'` | sampled |
| `v2fine` | Tight steps around the v2 winner incl. `scaleCooldownDays` — use with `--base '{hybrid v2}'` | sampled |
| `v2knobs` | Everything in `v2fine` **except** the ladder (the ladder in `--base` is kept) — pair with `ladder_optimize.ts` | sampled |
| `all` | Every parameter from every idea at once — random sampling only | sampled |

Add `--climb K --passes N` to hill-climb from the top K after sampling (coordinate descent over each knob's
value list); with `--walk-forward`, `--wf-top M` controls how many finalists get the per-year scoring.

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

### Reproducing ChartInspect's headline (and why it won't match exactly)

ChartInspect's script is a **single $1 000 lump sum from 2017-01-01, 0.1 % fee, no momentum gate,
same-day fills, no management/performance fees**. The equivalent lab command is:

```powershell
deno run -A tools/sth_cb_lab/run.ts --start 2017-01-01 --upfront 1000 --monthly 0 --fees exchange_only --trade-bps 10 --contrib-bps 0 --same-day --config '{"momoEnabled":false}'
```

This gives ≈ 80 000 % ROI (≈ 9.6× HODL) against their 172 988 % (≈ 22× HODL). The remaining gap is the
**cost-basis data itself**: their `onchain.sth-cost-basis` metric is a different provider's calculation
from Research Bitcoin's `realized_price_sth`, and an all-in/all-out strategy is extremely sensitive to
exactly where that line sits. Shifting our cost basis by just ±3 % moves the ROI between 29 000 % and
79 000 %; +10 % takes it below HODL. Treat any single headline number — theirs or ours — with that in mind,
and use `--walk-forward` to judge robustness instead.

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
3. Either pick a **Rule preset** (*Hybrid v1* / *ChartInspect original*) and edit the labelled fields, or paste the
   JSON into **Advanced (extras JSON)** and click **Run back-test**.

Every hybrid rule has its own field; blank / "Off" disables it. The JSON box is only needed for keys without a
field (`exitRocLength`, multi-tier `capBuyTiers` / `sellTiers`, σ-mode thresholds) and is merged last, so it
overrides any field. Unknown keys (typos) make the run fail with the allowed list; the run's stored summary
carries `effective_config` — the exact configuration that ran.
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
| 7 | `sigmaMode`, `sigmaWindow`, `capBuySigma`, `capExitSigma`, `trendEnterSigma`, `trendExitSigma` | `"ratio_sigma"`, `365`, `-1.5`, `0`, `0.5`, `-0.5` | Express the thresholds in σ of ln(price ÷ CB) (or STH-PVR $ units with `"sth_pvr"`) so they widen in volatile regimes and tighten in calm ones. Any σ key set overrides its ratio twin |
| 8 | `reentryRocThreshold` | `0.05` | After a trend exit, re-enter as soon as ROC ≥ this and price ≥ `trendReentryRatio` (default 1.0) — don't wait for +5 % |
| 9 | `minHoldDays` | `15` | Ignore every exit rule for N days after an entry |
| 10 | `blockEntryAboveSigma` | `2.5` | No trend entries while price is above the LTH PVR +kσ band (macro top filter) |
| 11 | `capBuyRocThreshold` | `0` | A capitulation buy waits until ROC ≥ this (price has stopped falling) |
| 12 | `trailingStopPct` | `0.35` | Exit a trend hold once price is this far below its peak since entry; arms the re-entry ladder |
| 13 | `distReentryClearRatio` | `0.9` | After an LTH +σ distribution, block trend re-entries until price has come back to this ratio of the CB |
| 14 | `capBuyAtLthSigma` | `-0.5` | Also treat price ≤ the LTH PVR band at this σ (0 = mean, −0.5, −1) as a capitulation buy |
| 15 | `lthSellTiers` | `[{"sigma":1,"alloc":0.75},{"sigma":2.5,"alloc":0}]` | **Scale out at the LTH PVR upper bands**: at +1σ hold 75 % BTC … `alloc 0` = sell everything (replaces `distributeAtSigma`). Tiers latch per hold; entering a hold already above a tier does not sell on day one |
| 15 | `lthSellMomoGate` | `true` | Sell a ladder slice only once ROC ≤ `momoThreshold` (momentum has turned) rather than on the first touch of the band. Without it, ladders *lose* to a single all-out |
| 16 | `dipRebuyPct` | `0.10` | After a partial scale-out, go back to 100 % BTC once price has fallen this far from its post-sell peak. Re-arms the ladder for the next leg up |
| 16 | `dipRebuyAtCbRatio` | `1.10` | Alternative re-buy trigger: price back at ≤ this × the STH cost basis |
| 16 | `dipRebuyMax` | `3` | Maximum re-buys per hold (blank = unlimited) |
| v2 | `scaleCooldownDays` | `5` | Minimum days between a partial sell and a re-buy (either direction). Full exits ignore it. Kills next-day flip-flops |
| v2 | `rebalanceDrift` | `0.05` | Opt-in constant-mix: while at a partial allocation, rebalance when the held weight drifts this far from target. Default off — trades only when the target changes |

### The optimised "STH_CB hybrid v1" (2026-10-25)

Found by R1→R5 (≈ 61 000 configurations, lump-sum basis, walk-forward-first ranking):

```json
{"capBuyRatio":0.75,"capExitRatio":0.95,"trendEnterRatio":1.12,"trendExitRatio":0.97,"momoLength":2,"momoThreshold":-0.02,
 "distributeAtSigma":2.5,"cbSlopeDays":21,"trailingStopPct":0.35,"reentryRocThreshold":0.1,"minHoldDays":15,
 "blockEntryAboveSigma":2.5,"distReentryClearRatio":0.9,"capBuyAtLthSigma":-0.5,"trendReentryRatio":1.02,
 "capBuyRocThreshold":0,"sellTiers":[{"ratio":2,"alloc":0}]}
```

| Basis ($1 000 lump sum, 2017-01-01 → 2026-10-23) | NAV | ROI | × HODL | Max DD | WF |
|---|---|---|---|---|---|
| **Next-day fills, full BitWealth fees** | **$2 727 839** | **272 684 %** | **32.7×** | 48 % | 7/10 |
| Same-day fills, full fees | $2 301 729 | 230 073 % | 27.6× | 52 % | |
| Exchange fees only (gross) | $5 350 073 | 534 907 % | 64.1× | 49 % | |
| STH cost basis × 0.97 / × 1.03 | $1.38 M / $1.73 M | | 16.5× / 20.7× | | |
| LTH bands × 0.95 / × 1.05 | $1.75 M / $3.04 M | | 20.9× / 36.5× | | |
| Start 2018 / 2019 / 2020 / 2021 / 2022 / 2023 | | | 36.6× / 11.7× / 11.3× / 8.9× / 4.8× / 1.5× | | |
| $10 000 + $500/month | $38.3 M | 55 438 % | 6.7× | | |

Run `deno run -A tools/sth_cb_lab/robustness.ts --extras '{...}'` to regenerate this table for any config.
What the rules do in practice: sold Dec-2017 at $15.2k, re-bought $7.0k; out before COVID at $7.95k, back in
at $5.3k on 2020-03-18; out at $57k (Mar-21) and $61k (Oct-21); back in at $21k and $16.7k (Nov-22, LTH −0.5σ);
out at $109.5k (Oct-25); currently in since $59.9k (Jun-26). 33 trades in 9.8 years.

**Caveats, stated plainly:** the parameters were chosen on this very window (in-sample). Walk-forward 7/10 and
the start-year table are the evidence that it is not pure curve-fit, but 2023 and 2024 both lost to HODL,
and ±6 % on the cost-basis line still cuts the result by two-thirds. Paper-trade before capital.

### The "STH_CB hybrid v2" — scale out into euphoria, re-buy the dip (2026-10-26)

Davin's hypothesis: instead of sitting at 100 % BTC until the +2.5σ all-out, peel off slices as price climbs
through the LTH PVR upper bands and redeploy that USDT after the pull-back. Three rounds (~37 000 configs,
`--idea v2` then `v2fine`) confirmed it — **but only with the momentum gate**; blind ladders at the first band touch
lose to v1.

```json
{"capBuyRatio":0.75,"capExitRatio":0.95,"trendEnterRatio":1.12,"trendExitRatio":0.97,"momoLength":2,"momoThreshold":-0.02,
 "cbSlopeDays":21,"trailingStopPct":0.35,"reentryRocThreshold":0.1,"minHoldDays":15,"blockEntryAboveSigma":2.5,
 "distReentryClearRatio":0.85,"capBuyAtLthSigma":-0.5,"trendReentryRatio":1.02,"capBuyRocThreshold":0,
 "lthSellTiers":[{"sigma":1,"alloc":0.75},{"sigma":1.5,"alloc":0.5},{"sigma":2,"alloc":0.25},{"sigma":2.5,"alloc":0}],
 "lthSellMomoGate":true,"dipRebuyPct":0.1,"dipRebuyAtCbRatio":1.1,"dipRebuyMax":3,"scaleCooldownDays":5}
```

| Basis ($1 000 lump sum, 2017-01-01 → 2026-10-23) | v1 | **v2** |
|---|---|---|
| **Next-day fills, full BitWealth fees** | $2 727 839 · 32.7× · 33 trades | **$3 802 097 · 380 110 % · 45.6× · 49 trades** |
| Same-day fills | 27.6× | 41.8× |
| Exchange fees only (gross) | 64.1× | 90.3× |
| STH cost basis × 0.94 / 0.97 / 1.03 / 1.06 | 10.0× / 16.5× / 20.7× / 8.5× | 13.8× / 21.7× / 26.4× / 11.2× |
| LTH bands × 0.95 / 1.05 | 20.9× / 36.5× | 30.3× / 37.9× |
| Start 2018 / 2019 / 2020 / 2021 / 2022 / 2023 | 36.6× / 11.7× / 11.3× / 8.9× / 4.8× / 1.5× | 45.4× / 14.5× / 14.0× / 11.1× / 5.6× / 1.7× |
| $10 000 + $500/month | 6.7× | 9.2× |
| Max drawdown | 48 % | 48 % |
| Walk-forward years beating HODL | 7/10 | **8/10** |

v2 wins every row with the same drawdown. Where the money comes from: in 2021 v1 held 100 % until the $57k all-out;
v2 sold 25 % at $34.8k, re-bought $32k, sold to 25 % at $48.6k, re-bought $44.7k, sold again at $48.3k/$55.4k,
re-bought $53.5k, then exited at $58.2k/$61.4k. Same pattern Nov-17 ($7.4k → $6.4k → $16.6k) and Nov-24 → Jul-25
($93k/$102k/$108k/$119k slices, $94.7k/$104k re-buys). Only the Dec-24 re-buy was above its slice price (+1.8 %, via
the ≤ 110 % CB trigger); the other five were 3–14 % cheaper. Full logs: `results/v2_r3.log`, `results/v2_robustness.log`,
`results/v1_robustness.log` (local, git-ignored — regenerate with the commands above).

The Admin UI preset *STH CB Hybrid v2* is now the default; the tracker card has a selector for v1 / v2.
Fact sheet: `docs/STH_CB_Hybrid_v2_Fact_Sheet.html` — regenerate its data with
`deno run -A tools/sth_cb_lab/factsheet_data.ts --variant v2` (no flag = the v1 sheet's data).

### Optimising the ladder itself: `ladder_optimize.ts` (2026-10-27)

`optimize.ts` can only pick a ladder from a fixed list. `ladder_optimize.ts` searches the ladder *shape*:

```powershell
deno run -A tools/sth_cb_lab/ladder_optimize.ts --base '{hybrid v2 json}' --climb 15 --walk-forward --wf-top 250
```

- **Phase 0** adds a 10 / 20 / 30 % sell at the LTH PVR **mean** and/or **+0.5σ** to the base ladder — a direct answer to
  "does trimming early help?".
- **Phase 1** enumerates **every** ladder over the bands `--levels 0,0.5,1,1.5,2,2.5` with allocations in `--step 0.1`
  (1 dp) steps, non-increasing from the mean upward (`1.0` at a band = no rung there) — 8 007 ladders — with the
  momentum gate on and off.
- **Phase 2** (`--climb K`) coordinate-descends the re-buy / cooldown / gate knobs for the top K ladders.
- **Phase 3** (`--walk-forward`) scores the top `--wf-top` per calendar year. Output: CSV + top table + a
  "best with / without a rung at each band" summary.

**Findings (lump sum 2017-01-01 → 2026-10-23, full fees, Hybrid v2 base = $3 802 097):**

| Question | Answer |
|---|---|
| Small sell (10–30 %) at the **mean** | **Hurts badly**: −22 % to −36 % NAV, trades 49 → 75. Price spends most of every bull run above the mean, so the rung fires constantly and the re-buy churns |
| Small sell at **+0.5σ** | Mildly negative: −3 % (10 %) to −11 % (30 %), trades 49 → 59 |
| Any ladder that includes a mean rung | Best possible $3.24 M — below v2 |
| Momentum gate off | Best possible $2.73 M — the gate stays essential |
| Dropping the +2.5σ full exit | $4.40 M → $2.10 M — the final all-out stays essential |
| **Optimised sizes** | **`+1σ → 20 %`, `+1.5σ → 10 %`, `+2.5σ → 0 %`** = **$4 398 785 · 52.7× HODL · 48 trades · DD 48 % · WF 8/10 (+15.7 % vs v2)**. Same trigger dates as v2 — only the slice sizes differ |
| Shape of the optimum | A smooth monotone surface: NAV rises steadily the *more* is sold at +1σ and +1.5σ (90 %→$3.3 M … 20 %→$4.4 M). Not a lucky spike. 4-rung `30/20/10/0` = $4.30 M (−2 %) if a gentler profile is preferred |
| Other knobs on top (`--idea v2knobs`, 12 822 configs) | +0.65 % at best (cooldown 4 d, re-buy ≤108 % CB) with 6 extra trades — noise |
| Robustness (`robustness.ts`) | The optimised ladder beats v2 on **every** stress row (CB ±3/6 %, LTH bands ±5 %, all start years, all DCA schedules), same DD, same WF |

Why selling *more* at +1σ wins: the slice is only sold once momentum has turned above +1σ, and the dip re-buy restores 100 %
after a 10 % pull-back (or at ≤110 % CB). The more BTC converted to USDT at the top of the swing, the more is re-bought
lower — it is a mean-reversion trade on the euphoria leg, and the +2.5σ rung still catches the blow-off. Caveat: 5 of 6
historical re-buys were cheaper than their slice; the Mar-21 and Dec-24 re-buys were not, and with 80–90 % sold those cost more.

> **Bug fixed 2026-10-27 (affects earlier search breadth, not results):** `optimize.ts` keyed its "already evaluated"
> map with `JSON.stringify(c, Object.keys(c).sort())`. A replacer *array* filters nested objects too, so the
> `{sigma, alloc}` tiers inside `lthSellTiers` were stripped and every ladder with the same top-level keys collided.
> Earlier v2 runs therefore evaluated far fewer distinct ladders than reported (the v2 winner itself is unaffected —
> it was verified independently). All scripts now use `configKey()` from `lab_core.ts`.

**Promoted (2026-10-27) as "STH_CB hybrid v2.1"** — the gentler 4-rung ladder was chosen over the 3-rung optimum:
`lthSellTiers: [{1→0.3},{1.5→0.2},{2→0.1},{2.5→0}]`, everything else as v2 → **$4 304 977 · 430 398 % · 51.6× HODL ·
49 trades · DD 48 % · WF 8/10**. Default Admin UI preset, tracker row `hybrid_v2_1`, fact sheet
`docs/STH_CB_Hybrid_v2_1_Fact_Sheet.html` (`factsheet_data.ts --variant v2_1`, compares against v2).

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

---

# Part 2 — LTH PVR engine on STH-CB bands (`lth_run.ts`, `lth_optimize.ts`)

A second experiment lives in the same folder: keep the **three LTH PVR pillars** — (1) tiered buy sizes
B1–B5 below the mean and tiered sell sizes B6–B11 above it, (2) the momentum filter on the middle sell
tiers, (3) bear-pause with retrace buys — but replace the LTH PVR bands with bands drawn around the
**STH cost basis**. In the database this is the band source **`sth_cb`** (next to `rb` and `ci`).

## How the bands are defined

Mean band = STH cost basis. The ±σ unit comes from one of two definitions (`--bands` spec):

| Spec | Meaning |
|---|---|
| `sth_pvr:auto` | σ-unit = expanding std-dev of STH market cap ÷ STH supply (so +1σ is "STH PVR = +1"), multiplied by the expanding std-dev of the STH PVR series — the faithful analogue of how the LTH PVR bands are built |
| `sth_pvr:2` | Same unit, fixed multiplier 2 (any number works) |
| `ratio_sigma:365:1` | σ = std-dev of ln(price ÷ cost basis) over the last 365 days (0 = all history), multiplier 1; bands are `cb × exp(±kσ)` |

The code is `supabase/functions/_shared/sth_cb_bands.ts`; the database copy (`lth_pvr.sth_cb_bands_daily`)
is recomputed from `lth_pvr.onchain_pvr_daily` every day by `ef_fetch_onchain_pvr` using the definition
stored in `lth_pvr.sth_cb_band_params`. Changing the definition = `UPDATE` that row + call the function
with `{ "sth_cb_bands": "backfill" }`.

## Commands

```powershell
deno run -A tools/sth_cb_lab/lth_run.ts --start 2017-01-01 --end 2026-10-23 --upfront 1000 --monthly 0          # production LTH params on sth_pvr:auto
deno run -A tools/sth_cb_lab/lth_run.ts ... --bands ratio_sigma:365:1                                           # another band definition
deno run -A tools/sth_cb_lab/lth_run.ts ... --genes '{...}' --walk-forward                                      # a specific candidate (paste from the optimiser)
deno run -A tools/sth_cb_lab/lth_optimize.ts --start 2017-01-01 --end 2026-10-23 --upfront 1000 --monthly 0     # full search
```

`lth_optimize.ts` searches 18 "genes" (band spec, B1–B11, momentum length/threshold, bear-pause
enter/exit σ, retrace on/off + base) in three phases: ~4 800 *structured* seeds (sensible lump-sum shapes)
plus random samples → coordinate-descent hill-climbing from the top K → walk-forward scoring of the top M.
It prints the **baseline**, the **max in-sample** result, the **most robust** result (most calendar years
beating HODL) and whether anything cleared `--target` (default 200 000 %). Flags: `--samples`, `--climb`,
`--passes`, `--wf-top`, `--seed`, `--seedgenes '{...}'`, `--lock '{"bandSpec":"sth_pvr:2"}'`,
`--objective roi|nav_vs_hodl|cagr|sharpe|calmar`, `--no-structured`.

> Note: the LTH PVR engine fills at the **signal close** (that is how the production LTH PVR back-tester
> works), unlike the STH_CB strategy's next-day default.

## Result of the 2026-10-25 campaign (target: >200 000 % ROI, $1 000 lump sum, 2017-01-01 → 2026-10-23, full BitWealth fees)

Two campaigns, **27 122 configurations** evaluated.

| | ROI | NAV | × HODL | Max DD | WF years |
|---|---|---|---|---|---|
| Production LTH PVR params on `sth_pvr:auto` | 1 930 % | $20 304 | 0.24× | 76 % | — |
| **Best found** (`sth_pvr:2`, all-in below mean, sell 10 %/day in +0.5–1σ only when 3-day ROC > 20 %, 20 %/day above +2.5σ, pause 2σ → −0.5σ) | **18 201 %** | $183 005 | 2.19× | 77 % | 4/10 |
| Same, without BitWealth fees (gross) | 32 788 % | $328 883 | 3.94× | | |
| For reference: ChartInspect STH_CB rules on the same basis | 55 824 % | $559 239 | 6.70× | 52 % | |
| Target | 200 000 % | $2 001 000 | 24× | | |

**The target was not reached, and the search shows why it cannot be with these three pillars.** Both
campaigns converge on the same flat plateau (dozens of neighbouring configs give the identical result),
which is the signature of a structural ceiling rather than an under-searched space:

- The LTH pillars only **buy below the mean** and **sell into strength above it**. They have no
  trailing exit — nothing sells when price falls from +1σ back through the cost basis — so the portfolio
  rides every bear market down (max drawdown 77 %, the same as HODL). The one rule that made
  ChartInspect's STH_CB strategy work was precisely that −5 % exit below the cost basis.
- The only re-entry above the mean is the retrace exception, which is too narrow to re-board a trend.
- A lump sum removes the engine's main lever: the B1–B5 tiers were designed to size *monthly inflows*,
  not to time a single stake.
- Fees matter at this scale: 1 % management + 10 % performance take the gross 32 788 % down to 18 201 %.

The best configuration is saved as the variation template **"STH-CB Bands v1 (lump-sum optimised,
experimental)"** and `band_source = 'sth_cb'` is selectable in the Admin back-tester, simulator and
optimizer. Treat it as a research artefact: it beats HODL in only 4 of 10 calendar years.
