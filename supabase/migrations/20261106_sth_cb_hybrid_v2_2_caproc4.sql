-- 2026-11-06 · STH_CB Hybrid v2.2 promoted in place: + capBuyRocLength 4 (idea 19)
--
-- Why: on 11 days between 2026-02-05 and 03-08 the UTC close was ≤ 75 % of the STH cost basis (low 68 %) but v2.2 never
-- bought — its capitulation confirmation (capBuyRocThreshold 0) was measured on the 2-day momentum ROC, which was negative
-- on every one of those down-days and positive only on bounce days when price was already back above 75 %. The eventual
-- entry was the R5 ladder at $81,447 on 2026-05-06, followed by a losing R3 exit at $76,752.
--
-- Fix: the R1 gate reads a 4-day ROC (`capBuyRocLength: 4`); everything else unchanged. Lab + tracker, UTC closes,
-- $1k lump 2017-01-01 → 2026-11-05, next-day fills, full fees: $2,474,438 / 32.6× HODL / DD 36 % / 66 trades / WF 7/10
-- (before: $2,312,985 / 30.5× / 40 % / 73 / 7/10); better from every start year 2017–2024 and every fact-sheet horizon.
-- Alternatives tested and rejected: armed buy (ideas 17), split entry (idea 18), re-tuning the 2-day threshold (knife-edge).
--
-- Davin's decision: replace v2.2 in place rather than add a v2.3 key, so `customer_strategies.config_key = 'hybrid_v2_2'`,
-- the public back-tester (`create_public_sth_cb_backtest_run` copies these extras) and the tracker all pick it up with
-- no further change. The interim `hybrid_v2_3` candidate row (created earlier today) is removed.

UPDATE sth_cb.tracker_config
   SET extras = extras || '{"capBuyRocLength": 4}'::jsonb,
       label  = 'STH CB Hybrid v2.2 (no-loss ladder + 4-day capitulation gate, 2026-11-06)',
       updated_at = now()
 WHERE tracker_key = 'hybrid_v2_2';

DELETE FROM sth_cb.tracker_daily  WHERE tracker_key = 'hybrid_v2_3';
DELETE FROM sth_cb.tracker_config WHERE tracker_key = 'hybrid_v2_3';

-- Rebuild the tracker afterwards: POST ef_sth_cb_tracker {"tracker_key":"hybrid_v2_2"} (service key) — expected
-- final NAV $2,474,438 on 2026-11-05, position trend_hold (unchanged from before → no client position changes).
