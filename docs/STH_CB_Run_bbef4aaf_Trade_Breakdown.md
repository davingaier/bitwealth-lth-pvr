# STH_CB back-test `bbef4aaf-36ea-4256-b3fb-54412c680d11` — rules audit & trade breakdown

**Run:** Hybrid v2.1 preset · 2022-11-01 → 2026-11-02 · $2 400 upfront + $200 / month · next-day fills · full BitWealth fees · USDPC on.
**Result as executed:** NAV $47,062 · ROI 285.8 % · 21 trades · 1.02× HODL · 1.88× Std DCA · max DD 27.9 %.
**Warm-up state on 2022-11-01:** CAPITULATION HOLD since 2022-06-21 (R1 at $21 000), 133 days held → the day-1 "Initial deploy" is that hold being carried in.

> **How to read the dates.** Every rule is evaluated on the **daily close** ("Signal close"); the order is executed at the **next** daily close ("Fill").
> On TradingView, look at the *signal-close* candle for the condition and the *fill* candle for the price actually paid. "ROC2" is the 2-day rate of change
> on the signal close; "CB" is the Research Bitcoin STH cost basis; LTH bands are BitWealth's LTH PVR σ bands on the signal date.

## 1. Audit verdict

| Rule | Followed? | Evidence |
|---|---|---|
| R1 capitulation buy (≤ 75 % CB, ROC2 ≥ 0) | ✅ | 2026-02-13: 74 % of CB, ROC +0.1 % |
| R14 LTH −0.5σ buy (price ≤ band, ROC2 ≥ 0) | ✅ | Nov-22 waited 11-09 → 11-14 while ROC < 0, bought on 11-15 (ROC +1.5 %); Sep-23, Oct-23, Jun-26 all ≤ band |
| R2 capitulation exit (≥ 95 % CB, ROC2 ≤ −2 %, hold ≥ 15 d) | ✅ | 2022-11-07 (99 %, −2.6 %), 2023-10-11 (97 %, −2.2 %), 2026-05-08 (101 %, −2.1 %) |
| R3 trend exit (≤ 97 % CB, ROC2 ≤ −2 %, CB 21-d slope ≤ 0, hold ≥ 15 d) | ✅ | Aug-23 deferred 6 days "CB rising" then 7 days "momentum", fired 09-01; Aug-24 crash deferred (CB rising) until 08-12; Mar-25, Oct-25 ✓ |
| R5 trend re-entry at 102 % after a trend exit | ✅ | 2024-09-24 (102 %), 2025-05-01 (103 %) |
| R15 ladder: slice at +1/1.5/2/2.5σ **only once ROC2 ≤ −2 %** | ✅ for the slices that happened | Nov-24: tier 1 was armed 11-11 but ROC stayed > −2 % for 14 days; by 11-25 price was above +1.5σ → went straight to 20 % (by design) |
| R16 dip re-buy (−10 % from post-slice peak **or** ≤ 110 % CB, max 3, 5-d cooldown) | ✅ when it traded | 2024-12-22: −10.1 % from $106 759 peak; 2025-05-30: 109.5 % of CB, cooldown exactly 5 d |
| **R15 ↔ R16 interaction** | ❌ **BUG** | On 2025-01-08, 2025-06-12 and 2025-06-18 a slice fired and was **reversed inside the same daily decision** (R16 saw the fresh slice, the ≤ 110 % CB trigger was true, and the cooldown had been evaluated *before* the slice). No order was placed, but a re-buy was consumed, the cooldown and tier level were reset. See ③ in the table. |

**Fix (deployed with this review):** R16 can no longer act in the same tick as a slice (`slicedThisTick` guard in `_shared/sth_cb_strategy_logic.ts`; unit test added).
With the rules followed exactly, the old knobs (`dipRebuyAtCbRatio 1.10, dipRebuyMax 3, cooldown 5`) oscillate against the +1σ rung whenever price sits at 105–110 % of CB —
the bug had been masking that by exhausting `dipRebuyMax`. Re-optimised on the corrected engine: **`dipRebuyAtCbRatio 1.05 · dipRebuyMax 1 · scaleCooldownDays 2`**
(standard basis $4 026 777 · 48.3× HODL · 52 trades · DD 41.9 % · WF 8/10; old v2.1 on the corrected engine = $3 868 995 / 65 trades).

## 2. Optimisation opportunities visible in this trail (not bugs — rule design) — **all three tested the same day and rejected**

① **Exit into the buy zone (Sep-23, Oct-23).** Both the trend exit (2023-09-01) and the cap exit (2023-10-11) fired while price was *already at or below the LTH −0.5σ band* — the level at which R14 buys. Result: sold, re-bought 2–3 days later ≈ $70 higher, two round-trips of fees for nothing. Candidate rule: **suppress R2 / R3 while price ≤ LTH −0.5σ** (or require price > −0.5σ for the exit to count).
② **Late trend exit after a V-bottom (Aug-24).** The 21-day CB-slope filter correctly kept the position through the 5-Aug crash ($53k), but the slope only turned ≤ 0 on 12-Aug — after the bounce — so the exit happened at $59.9k and the re-entry 6 weeks later at $63.7k. Candidates: a shorter slope window when ROC2 is strongly negative, or skip the exit if price has already recovered above the −0.5σ band *and* ROC2 turned positive within the deferral.
③ **Same-tick slice/re-buy** — fixed (above).
④ **Ladder jumps straight to tier 2.** Twice (Nov-24, May-25) the first slice was at +1.5σ because momentum never turned negative while price was between +1σ and +1.5σ. That is the gate working as designed; a lighter gate (e.g. ROC2 ≤ −1 %) for the *first* rung only is a testable variant.
**Test results (lab, 375-config grid + walk-forward on the corrected engine):** ① −39 % NAV / DD 58 % (in 2018 the band blocks the Jul exit and the hold rides to .2k); ② inert or −2 % (the Aug-24 exit just moves to 6-Sep at .9k); ④ −22 … −52 %. The corrected v2.1 stands.
⑤ **No re-buy possible Aug–Oct 2025.** With the fix and `dipRebuyMax 1`, Part B shows a single re-buy on 2025-06-23 (104 % of CB) and then a 10 % holding into the Oct-25 exit — compare the two tables for the difference.

## 3. Part A — every order as executed (what the Admin UI run did)

| # | Signal close | Fill (next close) | Action | Rule | Trigger on signal day | BTC share before → after | Size of order | BTC | USDT | Fill price | NAV after | Audit note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2022-10-31 | 2022-11-01 | ▲ BUY | Initial deploy (cap hold carried in from warm-up) | $20,490 = 97% of CB $21,157 | 0% → 100% | deploy 100% of cash | 0.12647 | $2,595 | $20,504 | $2,593 |  |
| 2 | 2022-11-07 | 2022-11-08 | ▼ SELL | R2 Capitulation exit | $20,771 = 99% of CB $20,903 · ROC2 -2.6% | 100% → 0% | sell 100% of BTC held | 0.12647 | $2,449 | $19,379 | $2,447 |  |
| 3 | 2022-11-15 | 2022-11-16 | ▲ BUY | R14 LTH −0.5σ capitulation buy | $16,831 = 86% of CB $19,652 · ROC2 +1.5% · LTH −0.5σ $27,311 | 0% → 100% | deploy 100% of cash | 0.14673 | $2,449 | $16,678 | $2,447 |  |
| 4 | 2023-09-01 | 2023-09-02 | ▼ SELL | R3 Trend exit | $25,877 = 92% of CB $28,186 · ROC2 -5.4% | 100% → 0% | sell 100% of BTC held | 0.21482 | $5,542 | $25,820 | $5,537 | ① sold on a trend exit while price was already BELOW the LTH −0.5σ buy band → re-bought 2 days later |
| 5 | 2023-09-03 | 2023-09-04 | ▲ BUY | R14 LTH −0.5σ capitulation buy | $25,919 = 92% of CB $28,167 · ROC2 +0.2% · LTH −0.5σ $26,689 | 0% → 100% | deploy 100% of cash | 0.21358 | $5,534 | $25,891 | $5,530 | ① re-buy 2 days after the exit (round-trip cost ≈ 0.3 % + fees) |
| 6 | 2023-10-11 | 2023-10-12 | ▼ SELL | R2 Capitulation exit | $27,020 = 97% of CB $27,822 · ROC2 -2.2% | 100% → 0% | sell 100% of BTC held | 0.22071 | $5,903 | $26,766 | $5,897 | ① cap-exit fired with price $13 under the LTH −0.5σ band → re-bought 3 days later |
| 7 | 2023-10-14 | 2023-10-15 | ▲ BUY | R14 LTH −0.5σ capitulation buy | $26,883 = 97% of CB $27,796 · ROC2 +0.4% · LTH −0.5σ $27,055 | 0% → 100% | deploy 100% of cash | 0.21858 | $5,896 | $26,951 | $5,891 | ① re-buy 3 days after the exit |
| 8 | 2024-08-12 | 2024-08-13 | ▼ SELL | R3 Trend exit | $58,991 = 91% of CB $64,622 · ROC2 -2.9% | 100% → 0% | sell 100% of BTC held | 0.23491 | $14,064 | $59,917 | $14,050 | ② held through the 5-Aug crash (CB-slope filter) then exited after the bounce; re-entered 6 weeks later 6 % higher |
| 9 | 2024-09-24 | 2024-09-25 | ▲ BUY | R5 Trend re-entry (102 % ladder) | $63,632 = 102% of CB $62,338 · ROC2 +1.0% | 0% → 100% | deploy 100% of cash | 0.22572 | $14,383 | $63,670 | $14,371 |  |
| 10 | 2024-11-25 | 2024-11-26 | ▼ SELL | R15 Scale-out slice at +1.5σ → 20 % BTC | $96,363 = 127% of CB $75,704 · ROC2 -2.0% · LTH +1.5σ $94,040 | 100% → 20% | sell 80% of BTC held | 0.18511 | $17,207 | $93,033 | $21,495 |  |
| 11 | 2024-12-22 | 2024-12-23 | ▲ BUY | R16 Dip re-buy → 100 % BTC | $95,966 = 112% of CB $85,638 · ROC2 -0.3% | 21% → 100% | deploy 100% of cash | 0.17906 | $16,978 | $94,738 | $21,348 |  |
| 12 | 2025-01-27 | 2025-01-28 | ▼ SELL | R15 Scale-out slice at +1.5σ → 20 % BTC | $100,295 = 110% of CB $90,947 · ROC2 -4.2% · LTH +1.5σ $97,532 | 100% → 20% | sell 80% of BTC held | 0.18066 | $18,461 | $102,272 | $23,062 | ③ BUG: a +1σ slice due on 2025-01-09 ($93.2k) was silently cancelled by a same-tick re-buy (and consumed re-buy #3) |
| 13 | 2025-03-04 | 2025-03-05 | ▼ SELL | R3 Trend exit | $84,818 = 92% of CB $91,978 · ROC2 -4.0% | 17% → 0% | sell 100% of BTC held | 0.04516 | $4,013 | $88,926 | $22,784 |  |
| 14 | 2025-05-01 | 2025-05-02 | ▲ BUY | R5 Trend re-entry (102 % ladder) | $95,950 = 103% of CB $93,362 · ROC2 +1.1% | 0% → 100% | deploy 100% of cash | 0.24175 | $23,465 | $96,988 | $23,446 |  |
| 15 | 2025-05-24 | 2025-05-25 | ▼ SELL | R15 Scale-out slice at +1.5σ → 20 % BTC | $108,428 = 114% of CB $95,119 · ROC2 -2.4% · LTH +1.5σ $100,238 | 100% → 20% | sell 80% of BTC held | 0.19340 | $20,812 | $107,699 | $25,998 |  |
| 16 | 2025-05-30 | 2025-05-31 | ▲ BUY | R16 Dip re-buy → 100 % BTC | $105,224 = 110% of CB $96,092 · ROC2 -2.8% | 20% → 100% | deploy 100% of cash | 0.19958 | $20,803 | $104,153 | $25,822 |  |
| 17 | 2025-07-16 | 2025-07-17 | ▼ SELL | R15 Scale-out slice at +2σ → 10 % BTC | $118,467 = 115% of CB $103,001 · ROC2 -2.0% · LTH +2σ $116,824 | 100% → 10% | sell 90% of BTC held | 0.22299 | $26,444 | $118,684 | $29,358 | ③ BUG: slices due 2025-06-13 / 06-19 / 06-23 were cancelled the same way; re-buys exhausted → stayed at 10 % until the Oct exit |
| 18 | 2025-10-30 | 2025-10-31 | ▼ SELL | R3 Trend exit | $108,984 = 96% of CB $113,033 · ROC2 -4.5% | 9% → 0% | sell 100% of BTC held | 0.02478 | $2,712 | $109,545 | $29,999 | ③ consequence: no re-buy possible Aug–Oct 2025 (max 3 already consumed by phantoms) |
| 19 | 2026-02-13 | 2026-02-14 | ▲ BUY | R1 Capitulation buy | $67,497 = 74% of CB $90,770 · ROC2 +0.1% | 0% → 100% | deploy 100% of cash | 0.45146 | $31,365 | $69,418 | $31,340 |  |
| 20 | 2026-05-08 | 2026-05-09 | ▼ SELL | R2 Capitulation exit | $79,872 = 101% of CB $79,051 · ROC2 -2.1% | 100% → 0% | sell 100% of BTC held | 0.45373 | $36,485 | $80,476 | $36,449 |  |
| 21 | 2026-06-28 | 2026-06-29 | ▲ BUY | R14 LTH −0.5σ capitulation buy | $59,854 = 85% of CB $70,019 · ROC2 +0.3% · LTH −0.5σ $60,535 | 0% → 100% | deploy 100% of cash | 0.61490 | $36,868 | $59,911 | $36,839 |  |

**Totals:** 21 orders (11 buys, 10 sells) · 4 partial scale-outs · 2 dip re-buys · final NAV $47,062.

## 4. Part B — same window under the corrected engine + corrected knobs

Config: Hybrid v2.1 ladder 30/20/10/0 % · `dipRebuyAtCbRatio 1.05 · dipRebuyMax 1 · scaleCooldownDays 2` · everything else unchanged. Series to 2026-10-24 (lab cache).

| # | Signal close | Fill (next close) | Action | Rule | Trigger on signal day | BTC share before → after | Size of order | BTC | USDT | Fill price | NAV after |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2022-10-31 | 2022-11-01 | ▲ BUY | Initial deploy (cap hold carried in from warm-up) | $20,490 = 97% of CB $21,157 | 0% → 100% | deploy 100% of cash | 0.12647 | $2,595 | $20,504 | $2,593 |
| 2 | 2022-11-07 | 2022-11-08 | ▼ SELL | R2 Capitulation exit | $20,771 = 99% of CB $20,903 · ROC2 -2.6% | 100% → 0% | sell 100% of BTC held | 0.12647 | $2,449 | $19,379 | $2,447 |
| 3 | 2022-11-15 | 2022-11-16 | ▲ BUY | R14 LTH −0.5σ capitulation buy | $16,831 = 86% of CB $19,652 · ROC2 +1.5% · LTH −0.5σ $27,311 | 0% → 100% | deploy 100% of cash | 0.14673 | $2,449 | $16,678 | $2,447 |
| 4 | 2023-09-01 | 2023-09-02 | ▼ SELL | R3 Trend exit | $25,877 = 92% of CB $28,186 · ROC2 -5.4% | 100% → 0% | sell 100% of BTC held | 0.21482 | $5,542 | $25,820 | $5,537 |
| 5 | 2023-09-03 | 2023-09-04 | ▲ BUY | R14 LTH −0.5σ capitulation buy | $25,919 = 92% of CB $28,167 · ROC2 +0.2% · LTH −0.5σ $26,689 | 0% → 100% | deploy 100% of cash | 0.21358 | $5,534 | $25,891 | $5,530 |
| 6 | 2023-10-11 | 2023-10-12 | ▼ SELL | R2 Capitulation exit | $27,020 = 97% of CB $27,822 · ROC2 -2.2% | 100% → 0% | sell 100% of BTC held | 0.22071 | $5,903 | $26,766 | $5,897 |
| 7 | 2023-10-14 | 2023-10-15 | ▲ BUY | R14 LTH −0.5σ capitulation buy | $26,883 = 97% of CB $27,796 · ROC2 +0.4% · LTH −0.5σ $27,055 | 0% → 100% | deploy 100% of cash | 0.21858 | $5,896 | $26,951 | $5,891 |
| 8 | 2024-08-12 | 2024-08-13 | ▼ SELL | R3 Trend exit | $58,991 = 91% of CB $64,622 · ROC2 -2.9% | 100% → 0% | sell 100% of BTC held | 0.23491 | $14,064 | $59,917 | $14,050 |
| 9 | 2024-09-24 | 2024-09-25 | ▲ BUY | R5 Trend re-entry (102 % ladder) | $63,632 = 102% of CB $62,338 · ROC2 +1.0% | 0% → 100% | deploy 100% of cash | 0.22572 | $14,383 | $63,670 | $14,371 |
| 10 | 2024-11-25 | 2024-11-26 | ▼ SELL | R15 Scale-out slice at +1.5σ → 20 % BTC | $96,363 = 127% of CB $75,704 · ROC2 -2.0% · LTH +1.5σ $94,040 | 100% → 20% | sell 80% of BTC held | 0.18511 | $17,207 | $93,033 | $21,495 |
| 11 | 2024-12-22 | 2024-12-23 | ▲ BUY | R16 Dip re-buy → 100 % BTC | $95,966 = 112% of CB $85,638 · ROC2 -0.3% | 21% → 100% | deploy 100% of cash | 0.17906 | $16,978 | $94,738 | $21,348 |
| 12 | 2024-12-27 | 2024-12-28 | ▼ SELL | R15 Scale-out slice at +1σ → 30 % BTC | $95,349 = 110% of CB $86,694 · ROC2 -3.1% · LTH +1σ $81,446 | 100% → 30% | sell 70% of BTC held | 0.15774 | $14,913 | $94,619 | $21,295 |
| 13 | 2025-01-27 | 2025-01-28 | ▼ SELL | R15 Scale-out slice at +1.5σ → 20 % BTC | $100,295 = 110% of CB $90,947 · ROC2 -4.2% · LTH +1.5σ $97,532 | 31% → 20% | sell 36% of BTC held | 0.02464 | $2,518 | $102,272 | $21,965 |
| 14 | 2025-03-04 | 2025-03-05 | ▼ SELL | R3 Trend exit | $84,818 = 92% of CB $91,978 · ROC2 -4.0% | 17% → 0% | sell 100% of BTC held | 0.04296 | $3,817 | $88,926 | $21,830 |
| 15 | 2025-05-01 | 2025-05-02 | ▲ BUY | R5 Trend re-entry (102 % ladder) | $95,950 = 103% of CB $93,362 · ROC2 +1.1% | 0% → 100% | deploy 100% of cash | 0.23177 | $22,497 | $96,988 | $22,479 |
| 16 | 2025-05-24 | 2025-05-25 | ▼ SELL | R15 Scale-out slice at +1.5σ → 20 % BTC | $108,428 = 114% of CB $95,119 · ROC2 -2.4% · LTH +1.5σ $100,238 | 100% → 20% | sell 80% of BTC held | 0.18542 | $19,954 | $107,699 | $24,926 |
| 17 | 2025-06-22 | 2025-06-23 | ▲ BUY | R16 Dip re-buy → 100 % BTC | $101,069 = 103% of CB $98,172 · ROC2 -3.3% | 19% → 100% | deploy 100% of cash | 0.19508 | $19,954 | $102,207 | $24,676 |
| 18 | 2025-07-16 | 2025-07-17 | ▼ SELL | R15 Scale-out slice at +2σ → 10 % BTC | $118,467 = 115% of CB $103,001 · ROC2 -2.0% · LTH +2σ $116,824 | 100% → 10% | sell 90% of BTC held | 0.21778 | $25,827 | $118,684 | $28,673 |
| 19 | 2025-10-30 | 2025-10-31 | ▼ SELL | R3 Trend exit | $108,984 = 96% of CB $113,033 · ROC2 -4.5% | 9% → 0% | sell 100% of BTC held | 0.02420 | $2,649 | $109,545 | $29,311 |
| 20 | 2026-02-13 | 2026-02-14 | ▲ BUY | R1 Capitulation buy | $67,497 = 74% of CB $90,770 · ROC2 +0.1% | 0% → 100% | deploy 100% of cash | 0.44135 | $30,662 | $69,418 | $30,638 |
| 21 | 2026-05-08 | 2026-05-09 | ▼ SELL | R2 Capitulation exit | $79,872 = 101% of CB $79,051 · ROC2 -2.1% | 100% → 0% | sell 100% of BTC held | 0.44375 | $35,683 | $80,476 | $35,647 |
| 22 | 2026-06-28 | 2026-06-29 | ▲ BUY | R14 LTH −0.5σ capitulation buy | $59,854 = 85% of CB $70,019 · ROC2 +0.3% · LTH −0.5σ $60,535 | 0% → 100% | deploy 100% of cash | 0.60142 | $36,060 | $59,911 | $36,032 |

**Totals:** 22 orders · final NAV $47,577 · 1.01× HODL · max DD -27.9 % · 22 trades.

## 5. Files

- `docs/STH_CB_Run_bbef4aaf_Trade_Breakdown.csv` — Part A as CSV (one row per order, all signal-day inputs) for spreadsheet / TradingView work.
- `docs/STH_CB_Run_bbef4aaf_Trade_Breakdown_corrected.csv` — Part B as CSV.

_Generated 2026-11-03 by `tools/_tmp_breakdown.ts` from `sth_cb_bt.bt_results_daily` / `bt_ledger` and the lab series cache._
