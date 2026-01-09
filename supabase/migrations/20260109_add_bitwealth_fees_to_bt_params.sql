-- Add BitWealth fee columns to back-test parameters
-- Migration: 20260109_add_bitwealth_fees_to_bt_params.sql
-- Purpose: Track BitWealth's 10% performance fee (high-water mark) and 0.75% platform fee separately from VALR exchange fees

-- Add columns to bt_params
ALTER TABLE lth_pvr_bt.bt_params
ADD COLUMN performance_fee_pct NUMERIC DEFAULT 0.10 CHECK (performance_fee_pct >= 0 AND performance_fee_pct <= 1),
ADD COLUMN platform_fee_pct NUMERIC DEFAULT 0.0075 CHECK (platform_fee_pct >= 0 AND platform_fee_pct <= 1);

COMMENT ON COLUMN lth_pvr_bt.bt_params.performance_fee_pct IS 'BitWealth performance fee on monthly profits with high-water mark (default 10% = 0.10)';
COMMENT ON COLUMN lth_pvr_bt.bt_params.platform_fee_pct IS 'BitWealth platform fee on all contributions/deposits (default 0.75% = 0.0075)';

-- Add fee tracking columns to bt_results_daily
ALTER TABLE lth_pvr_bt.bt_results_daily
ADD COLUMN platform_fees_paid_usdt NUMERIC DEFAULT 0,
ADD COLUMN performance_fees_paid_usdt NUMERIC DEFAULT 0,
ADD COLUMN exchange_fees_paid_btc NUMERIC DEFAULT 0,
ADD COLUMN exchange_fees_paid_usdt NUMERIC DEFAULT 0,
ADD COLUMN high_water_mark_usdt NUMERIC DEFAULT 0;

COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.platform_fees_paid_usdt IS 'BitWealth platform fees paid on this date (0.75% of contributions)';
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.performance_fees_paid_usdt IS 'BitWealth performance fees paid on this date (10% of profit above high-water mark)';
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.exchange_fees_paid_btc IS 'VALR exchange fees paid in BTC for BTC/USDT trades';
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.exchange_fees_paid_usdt IS 'VALR exchange fees paid in USDT for USDT/ZAR conversions';
COMMENT ON COLUMN lth_pvr_bt.bt_results_daily.high_water_mark_usdt IS 'Highest NAV achieved to date (for performance fee calculation)';

-- Add summary columns to bt_std_dca_balances
ALTER TABLE lth_pvr_bt.bt_std_dca_balances
ADD COLUMN total_exchange_fees_btc NUMERIC DEFAULT 0,
ADD COLUMN total_exchange_fees_usdt NUMERIC DEFAULT 0,
ADD COLUMN total_platform_fees_usdt NUMERIC DEFAULT 0;

COMMENT ON COLUMN lth_pvr_bt.bt_std_dca_balances.total_exchange_fees_btc IS 'Cumulative VALR exchange fees paid in BTC';
COMMENT ON COLUMN lth_pvr_bt.bt_std_dca_balances.total_exchange_fees_usdt IS 'Cumulative VALR exchange fees paid in USDT';
COMMENT ON COLUMN lth_pvr_bt.bt_std_dca_balances.total_platform_fees_usdt IS 'Cumulative BitWealth platform fees paid (0.75% of contributions)';
