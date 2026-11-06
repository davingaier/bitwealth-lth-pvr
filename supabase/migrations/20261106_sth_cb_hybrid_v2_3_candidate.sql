-- 2026-11-06 · STH_CB Hybrid v2.3 CANDIDATE tracker row
--
-- Why: on 2026-02-05/11/12/17/18/19/23/24/27 the UTC close was ≤ 75 % of the STH cost basis (low 68 %) but v2.2 never
-- bought — its capitulation confirmation (capBuyRocThreshold 0) is measured on the 2-day momentum ROC, which was
-- negative on every one of those down-days and positive only on the bounce days when price was already back above
-- 75 %. The eventual entry was the R5 ladder at $81,447 on 2026-05-06.
--
-- Fix under test: `capBuyRocLength: 4` (idea 19) — the R1 gate uses a 4-day ROC; everything else is v2.2.
-- Lab (UTC closes, $1k lump 2017-01-01 → 2026-11-05, next-day fills, full fees): $2,474,438 / 32.6× HODL / DD 36 % /
-- 66 trades / WF 7/10 vs v2.2 $2,312,985 / 30.5× / 40 % / 73 / 7/10; wins from every start year 2017–2024.
-- Not promoted: hybrid_v2_2 stays the live default and the website source of truth until Davin validates.
--
-- Rows are copied from hybrid_v2_2 so every fee / contribution parameter stays identical; only `extras` differs.

INSERT INTO sth_cb.tracker_config (org_id, tracker_key, label, start_date, upfront_usdt, monthly_usdt, fee_plan,
  management_fee_pct, performance_fee_pct, platform_fee_pct, maker_bps_trade, maker_bps_contrib, usdpc_enabled,
  usdpc_apy_percent, usdpc_conversion_fee_percent, execution_lag_days, extras, is_active)
SELECT org_id, 'hybrid_v2_3', 'STH CB Hybrid v2.3 candidate (4-day capitulation gate)', start_date, upfront_usdt, monthly_usdt, fee_plan,
  management_fee_pct, performance_fee_pct, platform_fee_pct, maker_bps_trade, maker_bps_contrib, usdpc_enabled,
  usdpc_apy_percent, usdpc_conversion_fee_percent, execution_lag_days,
  COALESCE(extras, '{}'::jsonb) || '{"capBuyRocLength": 4}'::jsonb, true
FROM sth_cb.tracker_config
WHERE tracker_key = 'hybrid_v2_2'
ON CONFLICT (org_id, tracker_key) DO UPDATE
  SET extras = EXCLUDED.extras, label = EXCLUDED.label, is_active = true, updated_at = now();
