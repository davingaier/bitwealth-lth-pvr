# STH Cost Basis (STH_CB) Strategy – Test Cases

**Version:** v0.6.164 · **Date:** 2026-10-24 · **Scope:** rules engine + Admin UI back-tester (no live pipeline)

Strategy reference: SDD §0 change-log entry v0.6.164. Rules engine:
`supabase/functions/_shared/sth_cb_strategy_logic.ts`. Back-tester: `ef_sth_cb_bt_execute`.

---

## 1. Rules engine unit tests (`deno test supabase/functions/_shared/sth_cb_strategy_logic.test.ts`)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| U-01 | R1 latches at ratio ≤ 0.70 | `cap_hold`, rule "R1 Capitulation buy" | as expected | PASS |
| U-02 | ratio 0.7001 does not trigger R1 | `cash` | as expected | PASS |
| U-03 | R2 exits at ratio ≥ 1.00 without momentum gate; 0.99 holds | hold then `cash` | as expected | PASS |
| U-04 | R2 deferred while ROC > thr, fires once ROC ≤ thr | `sellDeferred=true` then exit | as expected | PASS |
| U-05 | R3 entry ≥ 1.05, dip to 0.99 holds, exit at ≤ 0.95 | hysteresis honoured | as expected | PASS |
| U-06 | `momoOnTrendExit=false` → trend exit sells despite positive ROC | `cash` | as expected | PASS |
| U-07 | OR-latch: cap_hold gaps from 0.98 → 1.06 in one close | stays in market as `trend_hold`, cap latch released | as expected | PASS |
| U-08 | Deferred R2 then trend entry then trend exit | final `cash` (no stale cap latch) | as expected | PASS |
| U-09 | Capitulation while trend-latched | `cap_hold`, trend latch released | as expected | PASS |
| U-10 | Missing price / cost basis | state carried forward, no trade | as expected | PASS |
| U-11 | `computeRocSeries` | 0 during look-back, then px[i]/px[i−len]−1 | as expected | PASS |
| U-12 | `warmupSthCbState` replay | seeds `{cap:true, trend:false}` for the fixture | as expected | PASS |

Result: **12 passed, 0 failed** (2026-10-24). Extended to **20 passed** with the refinement-flag tests below.

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| U-13 | Base config `targetAlloc` 1 in market / 0 in cash | as stated | as expected | PASS |
| U-14 | Idea 1 `trendExitConfirmDays=3` needs 3 consecutive closes; a close above the line resets | exit on 3rd consecutive | as expected | PASS |
| U-15 | Idea 1 `exitRocLength` gates on `extra.rocExit` not the fast ROC | deferred while slow ROC > 0 | as expected | PASS |
| U-16 | Idea 2 `capBuyTiers` 50 % @70 %, 100 % @60 %; exit sells all | allocs 0.5 → 1 → 0 | as expected | PASS |
| U-17 | Idea 2 `sellTiers` latch (no re-buy on dip); `alloc 0` tier = full exit | 1 → 0.66 → 0.66 → cash | as expected | PASS |
| U-18 | Idea 3 `cbSlopeDays` blocks exit while CB rising; inert without input | deferred / exits | as expected | PASS |
| U-19 | Idea 4 `distributeAtSigma=2` exits at p200; `disableTrendExit` ignores −10 % dip | R4 fires; normal 105 % re-entry | as expected | PASS |
| U-20 | Idea 5 `trendReentryRatio=1.00` armed only after a trend exit, not after R2 | ladder re-entry / no re-entry | as expected | PASS |

### Simulator regression (`_shared/sth_cb_simulator.ts` vs deployed EF)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| S-01 | Lab `run.ts` defaults 2015-01-04→2026-10-23 vs EF run `26fba122` | identical NAV / trades / HODL / Std DCA | $32,740,433 · 29 · $24,029,095 · $6,333,369 (identical) | PASS |
| S-02 | EF run `8aa277dc` (`trend_exit_ratio=0.97`, `extras={"trendExitConfirmDays":2}`) vs lab | identical | NAV 33579806.2621442, 25 trades, maxDD −0.519560040733831 (identical) | PASS |
| S-03 | UI paging: RPC `order` + `limit/offset` over 2020→2026 | 1000 / 1000 / 488 rows | as expected | PASS |
| S-04 | Optimizer idea 1 (100 combos) on all cores | completes, CSV written, baseline row recognised | 1.5 s, 67 evals/s | PASS |
| S-05 | Optimizer idea 5 `--walk-forward` | 12 annual folds scored, ranking by folds first | baseline 5/12 | PASS |
| S-06 | Run `2e575462` (extras containing base keys) before fix | base keys honoured | **FAIL** — base keys dropped, NAV $52,612 (= lab with keys stripped) | FIXED |
| S-07 | Run `2e575462` re-executed after fix | matches lab on same window | $103,294.50, 23 trades, 1.055× HODL (identical) | PASS |
| S-08 | Extras with a typo key | EF rejects with allowed-key list | implemented (`unknownExtraKeys`) | PASS |

### band_source = 'sth_cb' (LTH PVR engine on STH-CB σ bands, v0.6.167)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| C-01 | `sth_cb_bands.test.ts` (naming, spec parsing, symmetry, linearity, auto scale, NaN guards) | 7 pass | 7 passed | PASS |
| C-02 | Migration widens `band_source` CHECKs | decisions_daily, bt_runs, wft_runs | all three widened (NOTICE) | PASS |
| C-03 | `{ "sth_cb_bands": "backfill" }` on `ef_fetch_onchain_pvr` | full series upserted | 5 789 rows, params sth_pvr/2 | PASS |
| C-04 | `v_backtest_prices_sth_cb` | mean = STH CB, upper bands populated, sub-zero bands NULL | 2026-10-24: mean 75 763, p200 234 427, m100 NULL | PASS |
| C-05 | `ef_bt_execute` with `band_source='sth_cb'`, winner params, $1 000 lump 2017→2026 (run `0417e7f6`) | ≈ lab 18 201 % | 18 122 % ($182 218) — 0.4 % engine difference | PASS |
| C-06 | Optimisation campaign 1 (11 335 configs) | best found | 16 332 % | DONE |
| C-07 | Optimisation campaign 2 (15 787 configs, widened grid, seeded) | best found | 18 201 %, WF 4/10 | DONE |
| C-08 | Target > 200 000 % ROI | reached? | **not reached** — structural ceiling ≈ 2× HODL | FAIL (documented) |
| C-09 | Variation template `sth_cb_bands_lump_v1` | visible in Simulator/Optimizer dropdowns | inserted (id be770de4) — pending visual check | SKIP |

### STH_CB hybrid v1 — autonomous iteration (v0.6.168)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| H-01 | Unit tests ideas 7–14 (σ thresholds, momentum re-entry, min-hold, macro filter, ROC confirmation, trailing stop, post-distribution block, LTH −σ capitulation) | all pass | 28 passed | PASS |
| H-02 | R1 (ideas 1–5, 15 000 random) | best | $1 414 372, 16.95× | DONE |
| H-03 | R2 hybrid + climb + WF (8 379) | best / robust | $1 414 372 / $1 329 017 (6/10) | DONE |
| H-04 | R3 hybrid + ideas 13/14 (12 664) | best | $1 698 391, 20.4×, 7/10 | DONE |
| H-05 | R4 fine search (11 410) | best | **$2 727 839, 32.7×, 7/10, DD 48 %** | DONE |
| H-06 | R5 second seed (13 974) | improvement? | none — stable optimum | DONE |
| H-07 | Target > 200 000 % ROI on bw_lump | reached | 272 684 % | PASS |
| H-08 | `robustness.ts` battery | survives perturbations | see README table; worst case (CB × 0.94) still 10× HODL | PASS |
| H-09 | Admin path `ef_sth_cb_bt_execute` with the winner's extras (run `9cfaba5b`) | = lab | $2 727 839.29, 33 trades — identical | PASS |

### STH_CB hybrid v2 — scale-out ladder + dip re-buy (v0.6.172)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| V2-01 | Unit tests ideas 15/16 + cooldown (`lthSellTiers` latching, momentum gate, fresh-entry tier init, dip re-buy by % and by CB ratio, `dipRebuyMax`, `scaleCooldownDays` blocks re-buy/next slice but not full exit) | all pass | 34 passed | PASS |
| V2-02 | Naïve ladder (no gate, no re-buy) vs v1 | ≥ v1? | loses to v1 — gate required | DONE |
| V2-03 | v2 R1 `--idea v2` (12 k, WF) | best | $3.29 M, 8/10 | DONE |
| V2-04 | v2 R2 `--idea v2fine` (12 k) | best | $3.40 M, 40.7× | DONE |
| V2-05 | Cooldown probe 0–10 d | optimum | 5 d ($3.64 M); ≥ 7 d degrades | DONE |
| V2-06 | v2 R3 `v2fine` + cooldown (12 754, climb 14×4, WF top 250) | best | **$3 802 097, 45.6×, 49 trades, DD 48 %, WF 8/10** | DONE |
| V2-07 | `robustness.ts` v2 vs v1 (30 rows) | v2 ≥ v1 | v2 better on every row, same DD | PASS |
| V2-08 | Fill trail inspection | no churn; re-buys below slice price | 49 trades; 5/6 re-buys 3–14 % cheaper, Dec-24 +1.8 % (CB-ratio trigger) | PASS |
| V2-09 | Deployed `ef_sth_cb_bt_execute` with v2 extras (run `7e0b19cd`) | = lab | $3 802 096.89, 49 trades — identical | PASS |
| V2-10 | UI preset *Hybrid v2* → `btReadSthCbParams()` | exactly the 15 v2 extras, no `sellTiers`/`distributeAtSigma` | verified headless | PASS |
| V2-11 | `tracker_config` row `hybrid_v2` + `ef_sth_cb_tracker` rebuild | 2 trackers, rows to latest close | v1 $2.69 M / v2 $3.75 M to 2026-10-25, 3 585 rows each | PASS |
| V2-12 | Tracker card selector + partial-allocation tiles (mocked client) | "TREND HOLD · 50 % BTC", "SCALE OUT to 25 % BTC", ladder tile, switch v1↔v2 remembered | as expected | PASS |
| V2-13 | Tracker card signed-in rendering of real v2 rows | chart + tiles | pending manual check | SKIP |
| V2-14 | `factsheet_data.ts --variant v2` → `STH_CB_Hybrid_v2_Fact_Sheet.html` | 3 pages fit A4; headline = lab; battery "as tested" = headline; v1 column = v1 sheet | spare 46/27/10 px at 96 dpi; $3,802,097 / 49 trades; v1 $2,727,839; assert added in generator | PASS |

### Ladder sizing study (v0.6.173)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| L-01 | `configKey()` keeps nested tier objects distinct | two ladders with different allocs → different keys | fixed; first (buggy) run evaluated 359 configs, fixed run 16 294 | PASS |
| L-02 | Ladder enumeration count (6 bands, 0.1 step, non-increasing, 1.0 = no rung) | Σ C(6,k)·C(10,k) = 8 007 | 8 007 (after fixing the skip-band ordering bug) | PASS |
| L-03 | Phase 0: 10/20/30 % sell at the mean on the v2 base | material change? | −22 / −29 / −36 % NAV, 75 trades | DONE (negative) |
| L-04 | Phase 0: 10/20/30 % sell at +0.5σ | material change? | −3 / −7 / −11 % NAV, 59 trades | DONE (negative) |
| L-05 | Phase 1+2+3 optimum | > v2 | `+1σ→20 % +1.5σ→10 % +2.5σ→0 %` = $4 398 785, 52.7×, 48 trades, DD 48 %, WF 8/10 (+15.7 %) | PASS |
| L-06 | Momentum gate off / no +2.5σ exit | worse | best gate-off $2.73 M; no final exit $2.10 M | PASS |
| L-07 | `--idea v2knobs` on the optimum (12 822 configs) | other knobs matter? | +0.65 % best (cooldown 4, re-buy ≤108 % CB), +6 trades — noise | DONE |
| L-08 | `robustness.ts` optimum vs v2 | ≥ v2 on every row | better on all 30 rows, same DD/WF | PASS |
| L-09 | Promotion of 30/20/10/0 as **Hybrid v2.1**: UI preset default emits 15 keys incl. the new ladder; `tracker_config` row `hybrid_v2_1` built; fact sheet pages fit; deployed EF run `3eb68310` | = lab $4,304,977 / 49 trades | all as expected; EF identical to the cent | PASS |

---

## 2. Database / RPC

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| D-01 | Migration applies cleanly (scratch-workdir `db push`) | 1 migration pushed, version `20261024160000` recorded | as expected | PASS |
| D-02 | `public.strategies` has `STH_CB` → `sth_cb` | row present | as expected | PASS |
| D-03 | `get_sth_cost_basis_series('2026-10-20')` | 4 rows; 2026-10-23 px 81 525 / CB 75 779 / ratio 1.076 | as expected | PASS |
| D-04 | `sth_cb_bt` not exposed → EF insert | `Invalid schema: sth_cb_bt` (PGRST106) | reproduced, fixed by adding both schemas to Exposed schemas | PASS |
| D-05 | `sth_cb_bt_get_annual` called with service role (no `auth.uid()`) | 42501 "not found or access denied" | as expected (guard works) | PASS |
| D-06 | `sth_cb_bt_list_runs` with service role | 0 rows (guard) | as expected | PASS |
| D-07 | RPCs called by a signed-in org admin from the Admin UI | rows returned | — pending manual UI check | SKIP |

---

## 3. Back-tester smoke run (run `26fba122-2b23-48f0-97a4-8483930409fc`)

Params: 2015-01-04 → 2026-10-23 · $10 000 upfront + $500/month · 8 / 18 bps VALR · management plan 1 % p.a.
+ 10 % performance fee · USDPC on (10 % APY, 0.1 % conv) · thresholds 70/100/105/95 · momentum ROC5 ≤ 0 % on both
exits · next-day fill.

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| B-01 | Run completes within EF time budget | `status=ok` | 32 s, 4 311 daily rows | PASS |
| B-02 | Warm-up seeds latches at start | state reflects 2014 bear (price < 0.7 × CB) | `{cap:true, trend:false}`, day-1 deploy | PASS |
| B-03 | Capitulation buys on known bottoms | 2018, 2020-03, 2021-06, 2022-06 | 2018-02-07 $7 944, 2018-03-30 $6 907, 2018-11-25 $3 841, 2020-03-14 $5 425, 2021-06-23 $33 752, 2022-06-14 $22 207 | PASS |
| B-04 | Trend exits at ≤ 0.95 only when ROC ≤ 0 | every R3 exit row has ratio ≤ 0.95 and roc ≤ 0 | all 14 exits: ratio 0.87–0.985*, roc −0.66 %…−17 % | PASS |
| B-05 | No round-trip when cap_hold rallies through CB | cap_hold → trend_hold upgrade, no SELL at ratio 1.0 | 2015-08 / 2018-02 sequences show upgrade then later R3 exit | PASS |
| B-06 | Contribution handling | monthly buys labelled "Deploy contribution" while in market; cash accrues in USDPC while out | ledger shows `convert` sweeps while in cash, contribution buys while in market | PASS |
| B-07 | Benchmarks populated | Std DCA + HODL daily rows & annual view | Std DCA $6.33 M, HODL $24.03 M final NAV | PASS |
| B-08 | Summary written to `bt_runs.summary` | NAV/ROI/CAGR, trades, % in market, fees | 29 trades, 74.09 % in market, fees itemised | PASS |

\* Rows at 0.985/1.008 are deferred exits that fired on a later day once ROC turned negative — i.e. the fill
ratio is the ratio on the fill day, not the day the exit condition was first met.

**Headline:** STH_CB final NAV **$32.74 M** (ROI 40 320 %, CAGR 66.2 %) vs HODL $24.03 M (CAGR 61.9 %) vs
Std DCA $6.33 M (CAGR 44.7 %), after $1.10 M management + $3.75 M performance fees and $0.22 M USDPC
conversion fees.

### Fill trail (non-contribution trades)

| Fill date | Action | Rule | Price | STH CB | Ratio | ROC5 | Position after |
|-----------|--------|------|-------|--------|-------|------|----------------|
| 2015-01-04 | BUY | Initial deploy (cap_hold from warm-up) | 274 | 373 | 0.735 | −12.3 % | cap_hold |
| 2015-08-20 | SELL | R3 Trend exit | 233 | 253 | 0.918 | −11.8 % | cash |
| 2015-10-18 | BUY | R3 Trend entry | 265 | 250 | 1.060 | +7.2 % | trend_hold |
| 2017-03-26 | SELL | R3 Trend exit | 974 | 989 | 0.985 | −10.9 % | cash |
| 2017-03-29 | BUY | R3 Trend entry | 1 038 | 994 | 1.044 | +5.1 % | trend_hold |
| 2017-07-17 | SELL | R3 Trend exit | 2 080 | 2 064 | 1.008 | −12.1 % | cash |
| 2017-07-19 | BUY | R3 Trend entry | 2 326 | 2 080 | 1.118 | +1.4 % | trend_hold |
| 2018-02-01 | SELL | R3 Trend exit | 9 530 | 10 958 | 0.870 | −15.5 % | cash |
| 2018-02-07 | BUY | R1 Capitulation buy | 7 944 | 10 554 | 0.753 | −8.3 % | cap_hold |
| 2018-02-24 | SELL | R3 Trend exit | 9 878 | 10 794 | 0.915 | −9.6 % | cash |
| 2018-03-30 | BUY | R1 Capitulation buy | 6 907 | 10 758 | 0.642 | −19.1 % | cap_hold |
| 2018-07-31 | SELL | R2 Capitulation exit | 7 878 | 7 886 | 0.999 | −3.5 % | cash |
| 2018-11-25 | BUY | R1 Capitulation buy | 3 841 | 6 014 | 0.639 | −16.0 % | cap_hold |
| 2019-09-25 | SELL | R3 Trend exit | 8 430 | 9 702 | 0.869 | −17.2 % | cash |
| 2020-01-18 | BUY | R3 Trend entry | 8 890 | 8 408 | 1.057 | +9.6 % | trend_hold |
| 2020-03-10 | SELL | R3 Trend exit | 7 951 | 8 648 | 0.919 | −12.0 % | cash |
| 2020-03-14 | BUY | R1 Capitulation buy | 5 425 | 7 982 | 0.680 | −31.3 % | cap_hold |
| 2021-05-18 | SELL | R3 Trend exit | 44 111 | 47 435 | 0.930 | −11.4 % | cash |
| 2021-06-23 | BUY | R1 Capitulation buy | 33 752 | 46 792 | 0.721 | −8.6 % | cap_hold |
| 2021-12-05 | SELL | R3 Trend exit | 49 195 | 53 162 | 0.925 | −14.2 % | cash |
| 2022-06-14 | BUY | R1 Capitulation buy | 22 207 | 33 751 | 0.658 | −26.5 % | cap_hold |
| 2023-08-19 | SELL | R3 Trend exit | 26 033 | 28 545 | 0.912 | −11.4 % | cash |
| 2023-10-21 | BUY | R3 Trend entry | 29 852 | 28 012 | 1.066 | +6.7 % | trend_hold |
| 2024-06-29 | SELL | R3 Trend exit | 60 894 | 64 373 | 0.946 | −0.7 % | cash |
| 2024-10-16 | BUY | R3 Trend entry | 67 541 | 63 063 | 1.071 | +9.3 % | trend_hold |
| 2025-02-27 | SELL | R3 Trend exit | 85 156 | 92 279 | 0.923 | −11.8 % | cash |
| 2025-05-09 | BUY | R3 Trend entry | 102 999 | 93 909 | 1.097 | +7.8 % | trend_hold |
| 2025-10-18 | SELL | R3 Trend exit | 106 942 | 113 224 | 0.945 | −7.1 % | cash |
| 2026-08-21 | BUY | R3 Trend entry | 76 584 | 68 196 | 1.123 | +21.6 % | trend_hold |

Observations for refinement discussion:
- The −5 % trend exit whipsaws in 2017 (two 2–3-day round-trips) and in 2024–25 (three exits that re-entered
  5–10 % higher). The capitulation side is clean.
- 2022-11 (FTX, ~$16k) produced no extra buy because the portfolio was already fully in `cap_hold` since June.
- Current state (2026-10-23): `trend_hold`, ratio 1.076.

---

## 4. Admin UI (manual)

| ID | Description | Expected | Status |
|----|-------------|----------|--------|
| UI-01 | Select "STH Cost Basis BTC Strategy (MVP)" | parameter block appears; note text changes; "Price vs STH Cost Basis" chart type becomes selectable | pending |
| UI-02 | Run with defaults, companion LTH PVR on | both runs execute in parallel; status line shows trades / % in market / NAV | pending |
| UI-03 | Comparison charts & tables | 4th series/column "LTH PVR DCA (production)" present | pending |
| UI-04 | Price vs STH Cost Basis chart | log axis, CB + 70/105/95 lines, green/orange shading, ▲/✕ markers on fills | pending |
| UI-05 | Switch back to LTH PVR | parameter block hides; chart type list resets; LTH PVR run behaves as before | pending |
| UI-06 | Companion run fails | STH_CB results still render; warning shown in `btReportsError` | pending |
