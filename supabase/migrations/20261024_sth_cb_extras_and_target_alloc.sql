-- ============================================================================
-- STH_CB — experimental knobs without further schema churn
-- ----------------------------------------------------------------------------
-- bt_params.extras            : jsonb bag for any SthCbConfig refinement flag
--                                (trendExitConfirmDays, exitRocLength, capBuyTiers,
--                                sellTiers, cbSlopeDays, distributeAtSigma,
--                                disableTrendExit, trendReentryRatio). Adding a new
--                                idea = a new key here + logic in the shared module.
-- bt_results_daily.target_alloc: BTC allocation the engine targeted after the
--                                day's execution (1 = all-in; < 1 with scaling tiers).
-- The RPCs return SETOF the tables, so they pick the new columns up automatically.
-- ============================================================================

ALTER TABLE sth_cb_bt.bt_params
  ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sth_cb_bt.bt_results_daily
  ADD COLUMN IF NOT EXISTS target_alloc numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN sth_cb_bt.bt_params.extras IS
  'Experimental SthCbConfig flags (camelCase keys) merged over the column-based config by _shared/sth_cb_simulator.ts::simParamsFromBtParams';
COMMENT ON COLUMN sth_cb_bt.bt_results_daily.target_alloc IS
  'Target BTC allocation (0..1) after execution on this date';
