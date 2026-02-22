-- Compare first 10 BUY trades between simulator and back-tester
-- Back-tester BUY orders
SELECT 
  close_date,
  action,
  ROUND(btc_amount::numeric, 8) as btc_bought,
  ROUND(usdt_amount::numeric, 2) as usdt_spent,
  ROUND(btc_balance_after::numeric, 8) as btc_balance,
  ROUND(exchange_fee-btc::numeric, 8) as fee_btc
FROM lth_pvr_bt.bt_results_daily
WHERE bt_run_id = '4cf2c315-fa9d-4807-90a8-428c09df83f9'
  AND action = 'BUY'
ORDER BY close_date
LIMIT 10;

-- Total exchange fees in back-tester
SELECT 
  ROUND(SUM(exchange_fee_btc)::numeric, 8) as total_fee_btc,
  ROUND(SUM(exchange_fee_usdt)::numeric, 2) as total_fee_usdt
FROM lth_pvr_bt.bt_results_daily
WHERE bt_run_id = '4cf2c315-fa9d-4807-90a8-428c09df83f9';

-- Final balances in back-tester
SELECT 
  close_date,
  ROUND(btc_balance_after::numeric, 8) as final_btc,
  ROUND(usdt_balance_after::numeric, 2) as final_usdt,
  ROUND(nav_usd::numeric, 2) as final_nav
FROM lth_pvr_bt.bt_results_daily
WHERE bt_run_id = '4cf2c315-fa9d-4807-90a8-428c09df83f9'
ORDER BY close_date DESC
LIMIT 1;
