-- Fix numeric field overflow in bt_std_dca_balances for long-term back-tests
-- Problem: total_exchange_fees columns have unbounded NUMERIC type causing overflow
-- Solution: Set explicit precision: numeric(38,8) for cumulative fee columns

-- Add explicit precision to exchange fee columns
ALTER TABLE lth_pvr_bt.bt_std_dca_balances 
  ALTER COLUMN total_exchange_fees_btc TYPE numeric(38,8),
  ALTER COLUMN total_exchange_fees_usdt TYPE numeric(38,8);

COMMENT ON COLUMN lth_pvr_bt.bt_std_dca_balances.total_exchange_fees_btc IS 'Cumulative VALR BTC/USDT exchange fees paid in BTC (8 decimal precision)';
COMMENT ON COLUMN lth_pvr_bt.bt_std_dca_balances.total_exchange_fees_usdt IS 'Cumulative VALR USDT/ZAR exchange fees paid in USDT (8 decimal precision)';
