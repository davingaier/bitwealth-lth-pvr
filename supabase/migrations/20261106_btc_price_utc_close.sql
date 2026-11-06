-- 20261106_btc_price_utc_close.sql
-- 2026-11-06: lth_pvr.onchain_pvr_daily.btc_price becomes the UTC daily CLOSE (Binance BTCUSDT from 2017-08-17,
-- RB price/price h1 23:00Z bar before). RB's d1 price/price is a daily AVERAGE (≈ Binance VWAP ±0.3 %) and had
-- been silently smoothing every signal and back-test. The average is preserved in btc_price_avg_usd for audit.
-- All consumers (sth_cb.cost_basis_daily view, get_sth_cost_basis_series, v_backtest_prices_sth_cb, bands, tracker)
-- read btc_price and therefore switch together. History is rebuilt by ef_fetch_onchain_pvr {backfill:true}.
ALTER TABLE lth_pvr.onchain_pvr_daily ADD COLUMN IF NOT EXISTS btc_price_avg_usd numeric;
COMMENT ON COLUMN lth_pvr.onchain_pvr_daily.btc_price IS 'BTC UTC daily close (Binance BTCUSDT; RB h1 23:00 bar pre-2017-08-17). Before 2026-11-06 this held the RB daily average.';
COMMENT ON COLUMN lth_pvr.onchain_pvr_daily.btc_price_avg_usd IS 'Research Bitcoin price/price @ d1 = daily average price (≈ VWAP). Audit/comparison only.';

-- Snapshot of the pre-switch series for before/after comparison (small: ~5.8k rows)
CREATE TABLE IF NOT EXISTS lth_pvr.onchain_pvr_daily_avg_snapshot_20261106 AS
  SELECT * FROM lth_pvr.onchain_pvr_daily;
