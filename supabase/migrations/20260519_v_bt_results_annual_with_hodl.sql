-- 2026-05-19  Add HODL annual aggregates to v_bt_results_annual.
-- The Admin UI Back-Tester reads this view to render its comparison tables.
-- Adds hodl_nav_usd / hodl_roi_percent / hodl_cagr_percent columns sourced from
-- lth_pvr_bt.bt_hodl_balances (already populated by ef_bt_execute).

CREATE OR REPLACE VIEW lth_pvr_bt.v_bt_results_annual AS
WITH adv_raw AS (
  SELECT bt_run_id,
         trade_date,
         date_part('year', trade_date)::integer AS trading_year,
         last_value(price_usd) OVER w AS btc_price,
         last_value(contrib_gross_usdt_cum) OVER w AS total_investment,
         last_value(btc_balance) OVER w AS btc_holdings,
         last_value(usdt_balance) OVER w AS usd_holdings,
         last_value(nav_usd) OVER w AS nav_usd,
         last_value(total_roi_percent) OVER w AS roi_percent,
         last_value(cagr_percent) OVER w AS cagr_percent
  FROM lth_pvr_bt.bt_results_daily
  WINDOW w AS (PARTITION BY bt_run_id, date_part('year', trade_date)
               ORDER BY trade_date
               ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
),
adv_yearly AS (
  SELECT DISTINCT ON (bt_run_id, trading_year)
         bt_run_id, trading_year,
         btc_price, total_investment, btc_holdings, usd_holdings,
         nav_usd, roi_percent, cagr_percent
  FROM adv_raw
  ORDER BY bt_run_id, trading_year, trade_date DESC
),
std_raw AS (
  SELECT bt_run_id,
         trade_date,
         date_part('year', trade_date)::integer AS trading_year,
         last_value(nav_usd) OVER w AS nav_usd,
         last_value(total_roi_percent) OVER w AS roi_percent,
         last_value(cagr_percent) OVER w AS cagr_percent
  FROM lth_pvr_bt.bt_std_dca_balances
  WINDOW w AS (PARTITION BY bt_run_id, date_part('year', trade_date)
               ORDER BY trade_date
               ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
),
std_yearly AS (
  SELECT DISTINCT ON (bt_run_id, trading_year)
         bt_run_id, trading_year, nav_usd, roi_percent, cagr_percent
  FROM std_raw
  ORDER BY bt_run_id, trading_year, trade_date DESC
),
hodl_raw AS (
  SELECT bt_run_id,
         trade_date,
         date_part('year', trade_date)::integer AS trading_year,
         last_value(nav_usd) OVER w AS nav_usd,
         last_value(total_roi_percent) OVER w AS roi_percent,
         last_value(cagr_percent) OVER w AS cagr_percent
  FROM lth_pvr_bt.bt_hodl_balances
  WINDOW w AS (PARTITION BY bt_run_id, date_part('year', trade_date)
               ORDER BY trade_date
               ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
),
hodl_yearly AS (
  SELECT DISTINCT ON (bt_run_id, trading_year)
         bt_run_id, trading_year, nav_usd, roi_percent, cagr_percent
  FROM hodl_raw
  ORDER BY bt_run_id, trading_year, trade_date DESC
)
SELECT a.bt_run_id,
       a.trading_year,
       a.btc_price,
       a.total_investment,
       a.btc_holdings,
       a.usd_holdings,
       a.nav_usd,
       a.roi_percent,
       a.cagr_percent,
       s.nav_usd  AS std_nav_usd,
       s.roi_percent  AS std_roi_percent,
       s.cagr_percent AS std_cagr_percent,
       h.nav_usd      AS hodl_nav_usd,
       h.roi_percent  AS hodl_roi_percent,
       h.cagr_percent AS hodl_cagr_percent
FROM adv_yearly a
LEFT JOIN std_yearly s
  ON s.bt_run_id = a.bt_run_id AND s.trading_year = a.trading_year
LEFT JOIN hodl_yearly h
  ON h.bt_run_id = a.bt_run_id AND h.trading_year = a.trading_year
ORDER BY a.bt_run_id, a.trading_year;
