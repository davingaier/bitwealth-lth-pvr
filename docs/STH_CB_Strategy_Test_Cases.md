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

### Rules audit of run `bbef4aaf` (v0.6.175)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| A-01 | Local lab reproduces the DB run (same window, contributions) | identical 21-trade trail | identical dates / prices / rules | PASS |
| A-02 | R1 / R14 / R2 / R3 / R5 / R15 / R16 conditions on every signal day (21 orders) | all satisfied | 20/21 clean; R14 ROC ≥ 0 gate explains the Nov-22 wait; Nov-24 tier-2 jump is by design | PASS |
| A-03 | Deferral notes vs ROC: rows 2025-01-10 / 06-23 deferred with ROC ≤ −2 % | should have sliced | state trace shows a same-tick R15 → R16 cancellation (rebuys 2→3 with no trade) | **FAIL → fixed** |
| A-04 | Fix: `slicedThisTick` guard; unit test "slice and re-buy never in the same tick" | slice stands, no re-buy consumed | 35 tests pass | PASS |
| A-05 | Impact of the fix with old knobs (standard basis) | — | v2.1 $4,304,977/49 → $3,868,995/65; v2 $3,802,097/49 → $3,666,854/65; v1 unchanged | DONE |
| A-06 | Re-optimisation on corrected engine (`v2knobs` 14 925 + ladder 16 449 + probes) | new knobs | `dipRebuyAtCbRatio 1.05, dipRebuyMax 1, scaleCooldownDays 2` → $4,026,777 · 48.3× · 52 trades · DD 41.9 % · WF 8/10 | PASS |
| A-07 | `robustness.ts` on corrected v2.1 | survives | all rows positive; WF 8/10; DD 42 % | PASS |
| A-08 | Deployed `ef_sth_cb_bt_execute` with corrected v2.1 (run `f688d62c`) | = lab | $4,026,776.53 / 52 trades — identical | PASS |
| A-09 | Trackers rebuilt on fixed engine | 3 trackers to latest close | v1 $2.60 M / v2 $3.49 M / v2.1 $3.83 M to 2026-11-02 | PASS |
| A-10 | Fact sheets v2 / v2.1 regenerated; pages fit A4 | spare ≥ 0 | v2.1 31/22/4 px, v2 46/27/48 px (compact 3-col trades when > 54) | PASS |
| A-11 | Lab `configDiff` shows removed keys | `scaleCooldownDays=off` visible | implemented | PASS |
| A-12 | Idea ① `exitBlockBelowLthSigma` (−0.25…−1) | ≥ baseline? | −39 % NAV, DD 58 % (2018 exit blocked) | REJECTED |
| A-13 | Idea ② `exitSkipAboveLowPct` 8–15 % / window 7–14 d | ≥ baseline? | inert or −2 % (exit moves to a lower low) | REJECTED |
| A-14 | Idea ④ `lthFirstRungMomoThreshold` 0 / −1 % / off | ≥ baseline? | −22 … −52 % | REJECTED |
| A-15 | Full `v3` grid (375) + walk-forward | best = baseline | every top row has the flags inert; $4,026,777 / 8/10 | PASS |
| A-16 | EFs redeployed with the v3 flags (inert by default); run `9f892b1f` | = $4,026,776.53 / 52 | identical | PASS |

### Fact-sheet page 4 — One-Pager side-by-side (v0.6.176)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| P4-01 | Benchmark rows vs `ABC_One_Pager.html` (same dates/deposits) | ≈ equal | 5-y Std DCA $22,228 vs $22,210; HODL $24,556 vs $24,749; 10-y HODL $2.87M vs $2.85M; DCA DD 61.5 % vs 61.8 % | PASS |
| P4-02 | Drawdown convention | One-Pager = raw NAV | confirmed (DCA DD ≠ HODL DD only on raw NAV); adopted for page 4 | PASS |
| P4-03 | Sharpe convention | reproduce One-Pager | not reproducible; deposit-neutral Sharpe used and footnoted as non-comparable | DOCUMENTED |
| P4-04 | Both sheets 4 pages within A4, no JS errors | spare ≥ 0 | v2.1 31/22/4/41 px, v2 46/27/48/41 px | PASS |

### Hybrid v2.2 — no-loss ladder, CB-% rungs, multi-period table (v0.6.177)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| V22-01 | New flags inert by default: v2.1 baseline bit-identical with all v2.2 flags off | $4,026,777 / 52 | identical; 42 unit tests pass (slice guard, re-buy guard, re-entry guard, min-gain exit, `cbRatio` tiers) | PASS |
| V22-02 | `sliceAboveLastBuyPct 0` on corrected v2.1 (10-y table basis) | removes ladder round-trip losses | +5.2 % NAV; no slice below its re-buy in the trail; cooldown redundant (C = no cooldown → $23,545,565 vs $22,100,781) | PASS |
| V22-03 | `rebuyBelowLastSellPct` on top of V22-02 | ≥ baseline? | slightly negative | REJECTED |
| V22-04 | `reentryBelowLastExitPct` (Sep-24 / May-25 losses) | ≥ baseline? | misses the following legs — hurts | REJECTED |
| V22-05 | `exitMinGainPct` (Nov-22 / Mar-25 losses) | ≥ baseline? | rides draw-downs — hurts badly | REJECTED |
| V22-06 | CB-% ladder rungs in 5 % steps (`ladder_optimize.ts --kind cb`, 10-y table) | ≥ LTH ladder? | best ≈ $11.4 M vs $22.1 M (≈ half) | REJECTED |
| V22-07 | LTH ladder re-search on C (`--kind lth`) | better ladder | `+0.5σ→50 % · +1σ→20 % · +1.5σ→10 % · +2.5σ→0 %` → 10-y $24,174,129, table WF 7/11 (was 6/11) | PASS |
| V22-08 | `periods.ts --file candidates_v22b.json` — v2.2 vs v2.1 on 1/3/5/7/10 y | ≥ v2.1 on every horizon, WF not worse | $6,012 / $27,790 / $82,031 / $637,464 / $24,174,129 (+0.4 / +12.4 / +11.0 / +9.1 / +9.4 %); DD lower on 3/5/7/10 y; WF 8/10 std (=), 7/11 table (+1) | PASS |
| V22-09 | `robustness.ts` on v2.2 (standard basis) | ≥ v2.1 every row | $4,399,250 · 52.7× · 61 trades · DD 42 % · 8/10; all stress rows ≥ v2.1 | PASS |
| V22-10 | Deployed `ef_sth_cb_bt_execute` with v2.2 extras (run `9d83751c`) | = lab | $4,399,249.74 / 61 trades — identical | PASS |
| V22-11 | Tracker row `hybrid_v2_2` upserted + `ef_sth_cb_tracker` rebuild | 4 trackers to latest close | v1 $2.60 M / v2 $3.49 M / v2.1 $3.83 M / v2.2 $4.19 M to 2026-11-02 | PASS |
| V22-12 | Admin UI preset `hybrid_v2_2` default; new field `btCbSliceGain`; all presets blank it; scripts parse | no syntax errors | 20/20 inline scripts OK; preset note updated | PASS |
| V22-13 | `docs/STH_CB_Hybrid_v2_2_Fact_Sheet.html` renders 4 A4 pages, no JS errors; rule-card trigger dates vs v2.2 trade list | fit; dates match | 0 px overflow on all 4 pages; R1/R14/R2/R3/R5/R12/final-rung dates identical to v2.1 (only slices differ) | PASS |

### Public website — STH Cost Basis Strategy pages + back-tester backend (v0.6.178)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| WEB-01 | Migration `20261103_public_sth_cb_backtest.sql` applies (strategy_code, FK drop, 3 functions, seed row) | success | applied via MCP; follow-up `trades` fix applied | PASS |
| WEB-02 | `create_public_sth_cb_backtest_run` as service_role → `ef_sth_cb_bt_execute {bt_run_id}` → `get_sth_cb_backtest_results` as **anon** | full daily series + summaries | 2020-01-01→2026-11-01, $10k+$1k/mo: 2 497 days, strategy $2,546,317 / HODL $998,444 / DCA $331,128; `run_status=ok` | PASS |
| WEB-03 | anon calls `create_public_sth_cb_backtest_run` directly | rejected | HTTP 401 | PASS |
| WEB-04 | `trades` in results excludes monthly "Deploy contribution" fills | signal trades only | 63 → 29 on the 5-y marketing run | PASS (after fix) |
| WEB-05 | `ef_refresh_marketing_charts {chart_key:'sth_cb_5yr'}` | row `ready`, payload with `series.strategy` | 27.6 s; $76,026 vs DCA $24,786 vs HODL $18,025; DD 19.5 %; 76.1 % in BTC; 262 weekly points | PASS |
| WEB-06 | `deno check` on `ef_submit_public_backtest`, `ef_execute_public_backtests`, `ef_refresh_marketing_charts`; deploy all three `--no-verify-jwt` | clean, deployed | 3 pre-existing `unknown`-catch errors in the poller fixed; all deployed | PASS |
| WEB-07 | `sth-cb-backtest.html` renders the real RPC payload through `displayResults` (file://) | all tiles + 2 charts | NAV/ROI/CAGR/contrib/time-in-BTC/trades/fees + Std DCA + HODL tiles populated; `roiChart`/`navChart` created | PASS |
| WEB-08 | `sth-cb.html` loads `get_marketing_chart('sth_cb_5yr')` | KPIs, params, narrative, 2 charts | "Last refreshed Nov 3, 2026"; KPIs $76,026 / $24,786 / $18,025; window 2 Nov 2021 → 2 Nov 2026 | PASS |
| WEB-09 | IP check: `sth-cb.html` + `index.html` contain no numeric thresholds / σ levels / slice sizes | none | manual read — only back-test outcome figures and fee rates are numeric | PASS |
| WEB-10 | Nav "Sign Up" text colour on all pages | dark on gold | computed `rgb(5, 10, 20)` | PASS |
| WEB-11 | Logo: no `images/logo.png` references left; icon renders at 40 px without border | 0 refs | 0 refs; icon 40 px high, aspect preserved (`portal.css` width:auto) | PASS |
| WEB-12 | `index.html`: no `lth-pvr` links, no emoji icons, stat counters animate with suffix | 0 / 0 / "52.7×", "8/ 10", "42%" | confirmed | PASS |
| WEB-13 | Netlify deploy | — | not done (Davin publishes) | SKIP |

### STH CB One-Pager + Commercial Fee Model (v0.6.179)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| OP-01 | `one_pager_data.ts` 5-year management row vs website `sth_cb_5yr` chart | equal | both $76,026 (script asserts one-pager row = fee-model anchor) | PASS |
| OP-02 | Headline vs daily tracker `hybrid_v2_2` (to 2026-11-02) | equal | $4,187,988 both | PASS |
| OP-03 | Print layout: each `.page` ≤ A4 under print emulation; headless Chrome PDF page count | 4 × 210×297 mm | 4 pages, 210×297 mm (ABC original prints 2 side-by-side Letter pages — cascade bug documented) | PASS |
| OP-04 | IP check on one-pager text | no numeric thresholds / σ / slice % | "three slices", "roughly three-quarters of the time" only | PASS |
| OP-05 | `fee-model-sth-cb.html` loads `_scb*` data, anchors ✓, no JS errors | all 5 periods ✓ | 1y $6,591 · 3y $26,572 · 5y $76,026 · 7y $603,733 · 10y $21,486,424; rebate table "actual — sum of real per-day rebates"; 5 charts; 0 page errors | PASS |

### Run `45c74a10` audit + true out-of-sample test (v0.6.180)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| OOS-01 | `usdpc_yield_usdt` = opening units × Δprice; implied daily rate on USD value | 1.10^(1/365)−1 = 0.0261158 % | exact on all 1,003 yielding days (max diff 9e-10) | PASS |
| OOS-02 | 47 fills: implied fill price vs day's close; cash/BTC identities; NAV identity | within fee stack | all within 0.2 %; buys → cash 0, exits → BTC 0 | PASS |
| OOS-03 | Lab reproduces DB run | $13,432,974 | identical | PASS |
| OOS-04 | One-pager 7-y row vs lump-sum equivalent (2019-11-02 → 2026-11-02) | same multiple | $2.4k+$200/mo → $603,733 (31× cash); $19,400 lump → $2,464,570 (127×); $105k lump → $13.34 M (127×) | PASS (consistent) |
| OOS-05 | Fit 2015–2019 (`--idea oos`, 31,490 configs) → test 2020–2026, $105k lump | — | in-sample 8.0×; **OOS median 1.90×** (1.56–2.36), 20/20 > HODL; ChartInspect raw 2.16×; v2.2 11.93× | FINDING |
| OOS-06 | Fit 2020–2026 (31,573 configs) → test 2015–2019 | — | in-sample 15.5×; **OOS median 1.71×** (1.42–2.61), 20/20 > HODL; ChartInspect raw 2.00×; v2.2 3.76× | FINDING |
| OOS-07 | Scorer bug: partial config without engine defaults ran with momentum gate off | v2.2 row = $13.43 M | first run showed $5.05 M; fixed by merging over `DEFAULT_STH_CB_CONFIG` | FIXED |
| OOS-08 | `oos_data.ts` publishes `STHCB_OOS`; website/one-pager/fact-sheet/fee-model read it | panels populated, pages fit | sth-cb.html 52.7× / 1.9× panel + 5-row plan table; index tiles 52.7× · 1.9× · 30 % · 20/20; one-pager 4 pp (print-emulated bottoms 1199/1136/1173/1157 ≤ 1209), PDF 4 pages; fact sheet pages 1123/1124/1123/1123; fee model banner + anchors still ✓ | PASS |

### 1.6 Live pipeline wiring (2026-11-04, SDD v0.6.182) — `deno test supabase/functions/_shared/sth_cb_live.test.ts`

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| LIVE-01 | `planCustomerDecision`: 15 unit cases — Policy A join buys 100 % on day 1; `next_signal` waits until target increases then buys; full exit never gated; partial slice gated by **own** last buy; slice 100→50 % sells 50 %, 50→20 % sells 60 %; dip re-buy 50→100 % spends all cash; partial top-up spends only the shortfall; dust/unfunded → HOLD; contribution while fully invested is deployed | 15 pass | 15 pass (64/64 across the three STH CB suites) | PASS |
| LIVE-02 | Migration `20261104_sth_cb_live_pipeline`: `customer_strategies.join_policy/config_key` (+FK to `sth_cb.tracker_config`), `tracker_daily.signal_target_alloc`, `customer_details.preferred_strategy_code`, `fn_usdt_available_for_trading` widened, `get_pipeline_status().sth_cb` | applied | applied via MCP | PASS |
| LIVE-03 | Migration `20261104_sth_cb_widen_strategy_gates`: trigger `enforce_lth_pvr_customer` (21 tables), `ensure_hwm_initialised[_all]`, 6 fee RPCs rewritten in place to `IN ('LTH_PVR','STH_CB')`; audit query shows no remaining `= 'LTH_PVR'` gate outside the bear-pause functions | 0 gated | 0 gated | PASS |
| LIVE-04 | Simulator daily row carries `signal_target_alloc / signal_rule / signal_note` from `todaySignal`; tracker persists them (next-row hack removed); `ef_sth_cb_bt_execute` strips them before `bt_results_daily` insert | semantics: signal on D executed on D+1 | 2026-05-08 signal "R2 Capitulation exit, target 0" → SELL executed 05-09; 06-28 "R14 Capitulation buy, target 1" → BUY 06-29; latest row 2026-11-03 Hold/target 1 | PASS |
| LIVE-05 | `ef_sth_cb_tracker` chains `ef_sth_cb_generate_decisions` when the tracker covers yesterday's UTC close | chain fires, no-op without live clients | `live_chain: {status:200, customers:0, reason:"no live STH_CB customers"}` | PASS |
| LIVE-06 | `ef_sth_cb_generate_decisions {dry_run:true, customer_ids:[31]}` with a temporary STH_CB row on test customer 31 (NAV $8: 21 % BTC via top-ups, $6.32 cash) | BUY 100 % of cash, "Deploy contribution", `last_buy_px` null (no buy fills) | exactly that; `decisions_written: 0` | PASS |
| LIVE-07 | `ef_resume_pipeline {strategy:'sth_cb', dry_run:true}` and `{check_status:true}.sth_cb` | decisions step HTTP 200; status block `{live_customers, tracker_ready, decisions, intents, can_run, signal}` | HTTP 200; `can_run:true, tracker_ready:true, live_customers:1, signal.date 2026-11-03` (temporary row removed afterwards) | PASS |
| LIVE-08 | `ef_create_order_intents` accepts `{customer_ids, trade_date}` and skips decisions whose intent already exists today | re-runs never re-size/re-consume carry | code path type-checks; exercised indirectly (no BUY/SELL written in dry run) | PASS (static) |
| LIVE-09 | Fee/USDPC EF filters widened (`ef_calculate_management_fees`, `ef_calculate_performance_fees`, `ef_collect_annual_fees`, `ef_transfer_accumulated_fees`, `ef_revalue_usdpc_nav`, `ef_sweep_usdt_to_usdpc`, `_shared/valrTransfer.ts`) and 16 EFs redeployed with their previous `verify_jwt` settings | all deploy OK | 16/16 OK | PASS |
| LIVE-10 | `ef_confirm_strategy`: STH_CB defaults `usdpc_enabled=true`, `join_policy='immediate'`, `config_key='hybrid_v2_2'` (validated against active `tracker_config`); Admin UI Prospects modal shows the STH CB fieldset and preselects `preferred_strategy_code` | — | deployed; UI script blocks parse (20/20) | PASS (static) |
| LIVE-11 | Client portal `get_customer_strategy_state` (caller = customer email or org member) + portfolio card state text; website form "Strategy of interest" → `preferred_strategy_code` (+ admin email line, `?strategy=` preselect) | — | RPC applied; portal/index scripts parse | PASS (static) |
| LIVE-12 | First real STH_CB client: confirm → fund → 02:05 UTC chain places the day-1 BUY | — | superseded by SEP-08…12 (customer 31 switched and bought in live on 2026-11-04) | PASS |

### 1.7 Schema separation, strategy switch, first live trade (2026-11-04, SDD v0.6.183)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| SEP-01 | Migration `20261104_sth_cb_schema_separation`: `sth_cb.decisions_daily` (+trigger), `sth_cb.get_pipeline_status`, `sth_cb.get_customer_pipeline_status`, public wrappers, LTH RPCs restricted to LTH_PVR, `customer_strategy_history`, `switch_customer_strategy`, `get_customer_strategy_state`/`list_customer_portfolios` read sth_cb | applied; audit clean | applied; LTH RPC filter ✓, portfolios ✓; status RPCs return expected JSON | PASS |
| SEP-02 | Guard cron `sth_cb_pipeline_guard` (`*/30 3-16`) → `ensure_pipeline_today()` | scheduled, idempotent | scheduled (paused briefly during the manual run, re-enabled) | PASS |
| SEP-03 | ACTIVE STRATEGY dropdown lists STH Cost Basis Strategy before any client is on it | 3 strategies | built from `public.strategies` (LTH_PVR, STH_CB, ADV_DCA) | PASS (static) |
| SEP-04 | STH CB Transactions block + Strategy Maintenance config table; shared History card; 22/22 inline scripts parse, 898/898 divs balanced | — | ✓ | PASS (static) |
| SEP-05 | Edit Client: USDPC checkbox round-trips via `stratPatch.usdpc_enabled`; Switch strategy panel calls `switch_customer_strategy` | — | code paths in place; panel hidden unless an open strategy row exists | PASS (static) |
| SEP-06 | `switch_customer_strategy(31,'STH_CB',{immediate,hybrid_v2_2,usdpc:true})` | in-place update + history row + "next" text | ok: label "Jemaica Gaier - STH Cost Basis Strategy", holdings snapshot, next = "all USDT/USDPC will be bought into BTC" | PASS |
| SEP-07 | Dry run after switch | BUY 100 % of $6.32 | BUY 1.0 "Deploy contribution", cash 6.32, alloc 21 % → 100 % | PASS |
| SEP-08 | Live run: USDPC pre-buy conversion with 1.12 USDPC (< 5 USDT policy, ≥ 1 VALR min) | whole balance converted, buy capped to fundable | SELL 1.12 USDPC → 1.34 USDT filled + booked; BTC intent 0.0000818 @ 77,141 (6.31 USDT) | PASS |
| SEP-09 | Order-book query before LIMIT placement | rest at best bid | **FAIL then FIXED**: 403 on `/v1/marketdata/…` (authenticated route) → intent price; after fix rested at best bid 78,246 with qty capped to budget (0.00008064) | FIXED |
| SEP-10 | Open LIMIT visible to the poller; 5-min fallback cancels and places MARKET | — | **FAIL then FIXED**: summary route 400 on open orders; cancel route 404; customerOrderId collision marked a live order cancelled. After fixes: fallback cancelled the LIMIT and MARKET filled 0.00008054 @ 78,343 | FIXED |
| SEP-11 | Ledger + balances after fills | VALR = DB | BTC 0.00010209 both sides; USDT/USDPC cents; NAV $7.89 | PASS |
| SEP-12 | Intents carry the client's own exchange account | subaccount 1456357666877767680 | code fixed (earlier intents of the day were tagged "Integration TestUser") | PASS (static) |

### 1.8 Policy A in the back-tester + STH CB emails (2026-11-04, SDD v0.6.184)

| ID | Description | Expected | Actual | Status |
|----|-------------|----------|--------|--------|
| EML-01 | Simulator regression after Policy A changes: lump $1k 2017→ (v2.2) | identical to before (no contributions) | 0 partial top-ups; unchanged | PASS |
| EML-02 | $2.4k + $200/mo 2019-11→2026-11 | contributions at partial allocation deployed | 7 top-ups, NAV $604,009 (was $603,733) | PASS |
| EML-03 | Join 2026-07-15 $10k: `joinPolicy` immediate vs next_signal | buy day 1 vs wait in cash | $11,626 (BUY "Initial deploy from warm-up") vs $10,203 (0 trades) | PASS |
| EML-04 | Engine + live unit tests after the simulator change | all pass | 57/57 | PASS |
| EML-05 | Migration `20261104_sth_cb_email_templates`: 7 templates built from the live shell | logo + footer present, placeholders intact | 7 rows, 94–96 KB each, logo ✓ | PASS |
| EML-06 | Test renders `strategy_switch_confirmation` + `sth_cb_position_change` via `ef_send_email` to the admin mailbox (customer 31 data) | delivered | message ids d0a89cf9… and 61f498f8… | PASS |
| EML-07 | `ef_switch_strategy` end-to-end from the Admin UI (switch + client email + admin email) | — | next real switch | SKIP |
| EML-08 | Navy header conversion (`tools/email_header_navy.py --apply`, 2026-11-05): every template has exactly one `<img class="bw-logo">`, `bw-hdr` header, no `logo-light/dark`/`data:image`, body whole | 24 converted, 1 image-less skipped | 24/24, stale 0, all 25 end in `</html>` | PASS |
| EML-09 | Chromium render of `registration_complete_welcome` (td header) and `monthly_statement` (div header), light + emulated dark | band `rgb(3,44,72)`, header text white, 1 image | both families, both modes ✓ | PASS |
| EML-10 | Re-sent `registration_complete_welcome` + `strategy_switch_confirmation` to admin@bitwealth.co.za | single logo in Outlook light **and** dark | message ids 61201957… / 5222dadf… — awaiting Davin's visual check | PASS |

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

## Security hardening verification (2026-11-05, v0.6.190)

| ID | Test | Expected | Actual | Status |
|----|------|----------|--------|--------|
| SEC-01 | Guarded EF (`ef_fetch_usdpc_price`) called with new sb_secret in apikey | 200 | 200 `{ok:true,price_usd:1.20118}` | PASS |
| SEC-02 | Same EF with no credentials | 401 | 401 `bearer token required` | PASS |
| SEC-03 | `ef_collect_annual_fees` with publishable key | 401 | 401 | PASS |
| SEC-04 | Live cron fleet after guarding 36 EFs + redeploy (7 min window) | all 200 | all real jobs 200; only test calls 401 | PASS |
| SEC-05 | Attacker insert sim: non-allowlisted USDT 5000 into withdrawal_requests | held, not dispatched | status=`needs_approval`, note "destination address not allow-listed" | PASS |
| SEC-06 | Allow-listed destination | dispatchable | status=`pending` | PASS |
| SEC-07 | Kill-switch `withdrawals_enabled=false` | insert blocked | RAISE EXCEPTION | PASS |
| SEC-08 | AFTER INSERT alert on every withdrawal | alert_events row | critical row for held withdrawal | PASS |
| SEC-09 | Credential-read anomaly: ≥8 distinct customers / 10 min | critical alert | logic verified via valr_credential_access_log + alert insert | PASS |
| SEC-10 | Legacy service_role JWT at gateway | 401 | 401 Invalid API key | PASS |
| SEC-11 | Advisor: new SECURITY DEFINER fns not anon/authenticated-executable | revoked | locked down in 20261105_harden_new_functions | PASS |
| SEC-12 | `lth_pvr.valr_hmac_hex('hello','abc')` vs WebCrypto HMAC-SHA512 | identical | identical (7b458e1a…7a3e) | PASS |
| SEC-13 | `valr_sign` for api-model customer 9 | 128-hex signature, 13-digit ts, no subaccount | as expected | PASS |
| SEC-14 | `valr_sign` with empty master slot / subaccount customer | raises VALR_SECRET_NOT_CONFIGURED (client falls back) | raised | PASS |
| SEC-15 | Converted signing clients type-check (8 consumers) | no errors in valrSign/valrClient/valrTransfer/valrCredentials | clean | PASS |
| SEC-16 | `ef_sweep_usdt_to_usdpc` live via cron path after redeploy | 200, credentials resolved + logged | 200, 4 credential reads logged | PASS |
| SEC-17 | Critical security alert → immediate email | notified_at set within seconds | 8 s | PASS |
| SEC-18 | Trigger functions no longer anon/authenticated-executable | 33 revoked | 33 | PASS |
| SEC-19 | Credential alarm backtest on 15 h of real cron traffic (95 windows) with span rule | 0 alerts | 0 (max 14 customers / 13 s) | PASS |
| SEC-20 | Attacker replay: 8 customers over 455 s | alert | 1 critical alert | PASS |
| SEC-21 | Cron-burst replay: 14 customers in 12 s | silent | 0 alerts | PASS |

## Price basis: RB daily average → Binance UTC close (2026-11-06)

| ID | Test | Expected | Actual | Status |
|----|------|----------|--------|--------|
| PX-01 | RB d1 `price/price` vs Binance daily VWAP, 9 days | ≈ VWAP | within 0.1–0.4 % on 8/9 days; vs close up to 3.3 % off | PASS (confirms it is an average) |
| PX-02 | RB h1 bars for 2026-11-05: mean vs d1 value; 23:00 bar vs TradingView close | mean ≈ d1; 23:00 ≈ close | 78,762 vs 78,573; 75,594 vs 75,996 | PASS |
| PX-03 | RB 23:00 bar vs Binance close over 3,355 overlapping days | usable pre-2017 proxy | median 0.33 %, p95 1.8 %, max 8.5 % | PASS |
| PX-04 | `compare_price_source.ts` v2.2 unchanged, $1k 2017→ | measure impact | $4.24M/52.7× → $2.31M/30.5× (−45 %); 12 % of daily targets differ | DONE |
| PX-05 | Era breakdown (starts 2017…2024, exchange-only fees) | consistent, not a pre-2017 artefact | −40…−57 % in every era | DONE |
| PX-06 | Re-fit on closes (`--idea oos`, 20k random + climb + WF, 2017→) | can it recover? | best 26.7× (WF 8/10) < unchanged v2.2 30.5× | DONE |
| PX-07 | `ef_fetch_onchain_pvr {backfill:true}` after switch | 5,801 rows, bands, trackers rebuilt | rows_written 5801, bands 5801, 4 trackers; v2.2 tracker $2,312,985 = lab | PASS |
| PX-08 | Live state after switch | no position change | trend_hold, 100.3 % of CB, Hold | PASS |
| PX-09 | Published surfaces after regen (sth-cb strip, OOS panel, index hero, fact sheet, marketing chart) | all on closes, mutually consistent | 30.5×/120%/40%/7/10 · 2.1× OOS (1.1–3.6×, 20/20) · 5y chart $44,790 = one-pager | PASS |
| SEC-22 | 10:00 UTC alert "14 customers over 388 s": audit log | manual test 09:53 (3 custs) + cron tick 10:00 (14 custs, 8 s) — benign | confirmed, no foreign client | FALSE POSITIVE |
| SEC-23 | Burst-clustered rule (gap 240 s): attacker replay 8 @ 65 s | fires | 1 critical | PASS |
| SEC-24 | Same rule: this morning's window / 14-in-12-s cron burst / 20 h real traffic (42 windows) | silent | 0 / 0 / 0 | PASS |

## Capitulation gate: Feb-2026 miss → 4-day ROC promoted into v2.2 (2026-11-06)

| ID | Test | Expected | Actual | Status |
|----|------|----------|--------|--------|
| CG-01 | Tracker rows 2026-02-05…03-08 for hybrid_v2_2 | explain the missing buy | 11 closes ≤ 75 % of CB, each `R1 waiting (ROC)` (2-day ROC < 0); first entry R5 at $81,447 on 05-06 | ROOT CAUSE |
| CG-02 | Idea 17 armed buy, ceilings 0.755–0.95, arm 3–40 d ($1k 2017→, closes) | fix 2026 without hurting history | fixes 2026 (buys $70,330) but $1.04–1.79M vs $2.31M; swaps May-2022 low ($20.4k) for the LUNA bounce ($30.1k) | REJECTED |
| CG-03 | Idea 18 split entry 25/50/75 % × ceiling 0.8/0.85/0.95 | hedge the touch | $0.89–1.01M — `minHoldDays` window shifts 2 days, R2 fires on a different day, ladder path diverges | REJECTED |
| CG-04 | Re-tune 2-day threshold (−0.01 / −0.02 / off) | stable? | 39.9× / 25.6× / 11.7× — knife-edge | REJECTED |
| CG-05 | Idea 19 `capBuyRocLength` 3/4/5/7/10/14 | plateau + fixes 2026 | 32.0× / **32.6×** / 31.6× / 16.6× / 17.6× / 19.8×; DD 36 % for all; len 4 buys $66,973 on 02-28 | PASS (len 4) |
| CG-06 | Len 4 per episode (`episodes.ts`) | better or equal in most episodes | better Feb-18, Apr-18, Nov-18, Jan-22, Feb-26; worse COVID ($5,313 vs $4,800) | PASS |
| CG-07 | Len 4 from every start year 2017/19/20/21/22/23/24 | ≥ v2.2 | +7 / +10 / +9 / +19 / +18 / +17 / +19 %; DD ≤; trades fewer | PASS |
| CG-08 | Fact-sheet basis ($2.4k + $200/mo) 1/3/5/7/10 y | ≥ v2.2 | +16 / +17 / +17 / +11 / +6 %; 10-y DD 35 % vs 39 %; table WF 6/11 vs 7/11 | PASS (one WF year flips) |
| CG-09 | Baseline regression with new keys absent | byte-identical | $2,312,985 in every run; 45/45 engine tests, 15/15 live tests | PASS |
| CG-10 | `sthCbReason` routing for R1/R12/R14/R15/R16/R17/R18/R2 | each rule → its own copy | pre-existing `/R1\|…/` matched R12/R15/R16 — fixed with word boundaries; 9/9 | PASS (bug fixed) |
| CG-11 | Promotion: UPDATE `tracker_config.hybrid_v2_2` + rebuild | tracker = lab; live signal unchanged | $2,474,438 / 32.6× / 66 trades; trend_hold, Hold, target 1; no new intents | PASS |
| CG-12 | Re-published surfaces (hero/strip, fact sheet, one-pager, OOS, marketing chart) | mutually consistent | 32.6× / $2.47M / 121 % / 36 % / 7/10 · OOS unchanged 2.1× · `sth_cb_5yr` $52,594 = one-pager 5-y | PASS |
