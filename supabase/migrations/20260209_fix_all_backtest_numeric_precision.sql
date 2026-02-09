-- Fix ALL unbounded numeric columns in back-test schema causing overflow on long-term tests
-- Problem: Multiple tables have unbounded NUMERIC columns that overflow with 16+ years of data
-- Solution: Add explicit precision to all numeric columns

-- Fix bt_results_daily (LTH PVR strategy results)
ALTER TABLE lth_pvr_bt.bt_results_daily 
  ALTER COLUMN platform_fees_paid_usdt TYPE numeric(38,8),
  ALTER COLUMN performance_fees_paid_usdt TYPE numeric(38,8),
  ALTER COLUMN exchange_fees_paid_btc TYPE numeric(38,8),
  ALTER COLUMN exchange_fees_paid_usdt TYPE numeric(38,8),
  ALTER COLUMN high_water_mark_usdt TYPE numeric(38,8);

-- Fix bt_params (strategy configuration)
ALTER TABLE lth_pvr_bt.bt_params 
  ALTER COLUMN platform_fee_pct TYPE numeric(10,6),
  ALTER COLUMN performance_fee_pct TYPE numeric(10,6);

-- Add comments
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.platform_fees_paid_usdt IS 'Cumulative BitWealth platform fees (0.75% of contributions) - 8 decimals';
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.performance_fees_paid_usdt IS 'Cumulative BitWealth performance fees (10% of gains above HWM) - 8 decimals';
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.exchange_fees_paid_btc IS 'Cumulative VALR BTC/USDT exchange fees in BTC - 8 decimals';
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.exchange_fees_paid_usdt IS 'Cumulative VALR USDT/ZAR exchange fees in USDT - 8 decimals';
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.high_water_mark_usdt IS 'High water mark for performance fee calculation - 8 decimals';

COMMENT ON COLUMN lth_pvr_bt.bt_params.platform_fee_pct IS 'Platform fee percentage (e.g., 0.0075 = 0.75%) - 6 decimals';
COMMENT ON COLUMN lth_pvr_bt.bt_params.performance_fee_pct IS 'Performance fee percentage (e.g., 0.10 = 10%) - 6 decimals';
