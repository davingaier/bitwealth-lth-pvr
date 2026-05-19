-- 2026-05-19  Day 7 follow-on: add HODL benchmark series to public.get_backtest_results
--
-- Also corrects two pre-existing latent bugs in earlier migrations of this same function:
--   1. JOIN used `bt.id` which does not exist on lth_pvr_bt.bt_runs (PK is `bt_run_id`).
--   2. Summary aggregations referenced columns that do not exist (`nav_total`, `roi_pct`,
--      `cagr_pct`, `contrib_cum`). The actual column names on bt_results_daily and
--      bt_std_dca_balances are `nav_usd`, `total_roi_percent`, `cagr_percent`,
--      `contrib_gross_usdt_cum`, `contrib_net_usdt_cum`.
--
-- The HODL benchmark is already persisted by ef_bt_execute into lth_pvr_bt.bt_hodl_balances
-- (single lump-sum purchase of upfront + sum of scheduled monthly contributions on day 1).

CREATE OR REPLACE FUNCTION public.get_backtest_results(p_request_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'request_id', br.id,
        'status', br.status,
        'error_message', br.error_message,
        'bt_run_id', br.bt_run_id,
        'email', br.email,
        'start_date', br.start_date,
        'end_date', br.end_date,
        'upfront_usdt', br.upfront_usdt,
        'monthly_usdt', br.monthly_usdt,
        'run_status', bt.status,
        'lth_pvr_summary', (
            SELECT json_build_object(
                'final_nav', last.nav_usd,
                'total_roi', last.total_roi_percent,
                'cagr', last.cagr_percent,
                'final_roi_pct', last.total_roi_percent,
                'btc_balance', last.btc_balance,
                'usdt_balance', last.usdt_balance,
                'contrib_net', last.contrib_net_usdt_cum,
                'contrib_gross', last.contrib_gross_usdt_cum,
                'total_platform_fees', agg.total_platform_fees,
                'total_performance_fees', agg.total_performance_fees,
                'total_exchange_fees_usdt', agg.total_exchange_fees_usdt,
                'total_exchange_fees_btc', agg.total_exchange_fees_btc
            )
            FROM (
                SELECT *
                FROM lth_pvr_bt.bt_results_daily
                WHERE bt_run_id = br.bt_run_id
                ORDER BY trade_date DESC
                LIMIT 1
            ) last
            CROSS JOIN (
                SELECT
                    SUM(platform_fees_paid_usdt) AS total_platform_fees,
                    SUM(performance_fees_paid_usdt) AS total_performance_fees,
                    SUM(exchange_fees_paid_usdt) AS total_exchange_fees_usdt,
                    SUM(exchange_fees_paid_btc) AS total_exchange_fees_btc
                FROM lth_pvr_bt.bt_results_daily
                WHERE bt_run_id = br.bt_run_id
            ) agg
        ),
        'std_dca_summary', (
            SELECT json_build_object(
                'final_nav', last.nav_usd,
                'total_roi', last.total_roi_percent,
                'cagr', last.cagr_percent,
                'final_roi_pct', last.total_roi_percent,
                'btc_balance', last.btc_balance,
                'usdt_balance', last.usdt_balance,
                'contrib_net', last.contrib_net_usdt_cum,
                'contrib_gross', last.contrib_gross_usdt_cum,
                'total_exchange_fees_usdt', last.total_exchange_fees_usdt,
                'total_exchange_fees_btc', last.total_exchange_fees_btc
            )
            FROM (
                SELECT *
                FROM lth_pvr_bt.bt_std_dca_balances
                WHERE bt_run_id = br.bt_run_id
                ORDER BY trade_date DESC
                LIMIT 1
            ) last
        ),
        'hodl_summary', (
            SELECT json_build_object(
                'final_nav', last.nav_usd,
                'total_roi', last.total_roi_percent,
                'cagr', last.cagr_percent,
                'final_roi_pct', last.total_roi_percent,
                'btc_balance', last.btc_balance,
                'usdt_balance', last.usdt_balance,
                'contrib_net', last.contrib_net_usdt_cum,
                'contrib_gross', last.contrib_gross_usdt_cum,
                'total_exchange_fees_usdt', last.total_exchange_fees_usdt,
                'total_exchange_fees_btc', last.total_exchange_fees_btc
            )
            FROM (
                SELECT *
                FROM lth_pvr_bt.bt_hodl_balances
                WHERE bt_run_id = br.bt_run_id
                ORDER BY trade_date DESC
                LIMIT 1
            ) last
        ),
        'daily_results', (
            SELECT json_agg(
                json_build_object(
                    'date', lth.trade_date,
                    'lth_pvr_nav', lth.nav_usd,
                    'lth_pvr_roi', lth.total_roi_percent,
                    'std_dca_nav', std.nav_usd,
                    'std_dca_roi', std.total_roi_percent,
                    'hodl_nav', hodl.nav_usd,
                    'hodl_roi', hodl.total_roi_percent
                ) ORDER BY lth.trade_date
            )
            FROM lth_pvr_bt.bt_results_daily lth
            LEFT JOIN lth_pvr_bt.bt_std_dca_balances std
                ON lth.bt_run_id = std.bt_run_id
                AND lth.trade_date = std.trade_date
            LEFT JOIN lth_pvr_bt.bt_hodl_balances hodl
                ON lth.bt_run_id = hodl.bt_run_id
                AND lth.trade_date = hodl.trade_date
            WHERE lth.bt_run_id = br.bt_run_id
        )
    )
    INTO v_result
    FROM public.backtest_requests br
    LEFT JOIN lth_pvr_bt.bt_runs bt ON br.bt_run_id = bt.bt_run_id
    WHERE br.id = p_request_id;

    RETURN COALESCE(v_result, json_build_object('error', 'Request not found'));
END;
$$;

COMMENT ON FUNCTION public.get_backtest_results IS
  'Get complete back-test results for LTH PVR, Std DCA, and HODL benchmarks (ROI, CAGR, contributions, fees, daily series). Column names corrected 2026-05-19.';
