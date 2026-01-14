-- Fix get_backtest_results to return contrib_gross field that UI expects
-- Issue: SQL function returns 'contrib_net', but UI looks for 'contrib_gross'
-- This causes Total Contributions to display $0 for both LTH PVR and Standard DCA

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
                'final_nav', MAX(nav_total),
                'total_roi', MAX(roi_pct),
                'cagr', MAX(cagr_pct),
                'final_roi_pct', MAX(roi_pct),
                'btc_balance', MAX(btc_balance),
                'usdt_balance', MAX(usdt_balance),
                'contrib_net', MAX(contrib_cum),
                'contrib_gross', MAX(contrib_cum),  -- Added: UI expects contrib_gross
                'total_platform_fees', SUM(platform_fees_paid_usdt),
                'total_performance_fees', SUM(performance_fees_paid_usdt),
                'total_exchange_fees_usdt', SUM(exchange_fees_paid_usdt),
                'total_exchange_fees_btc', SUM(exchange_fees_paid_btc)
            )
            FROM lth_pvr_bt.bt_results_daily
            WHERE bt_run_id = br.bt_run_id
        ),
        'std_dca_summary', (
            SELECT json_build_object(
                'final_nav', MAX(nav_total),
                'total_roi', MAX(roi_pct),
                'cagr', MAX(cagr_pct),
                'final_roi_pct', MAX(roi_pct),
                'btc_balance', MAX(btc_balance),
                'usdt_balance', MAX(usdt_balance),
                'contrib_net', MAX(contrib_cum),
                'contrib_gross', MAX(contrib_cum),  -- Added: UI expects contrib_gross
                'total_exchange_fees_usdt', SUM(exchange_fees_paid_usdt),
                'total_exchange_fees_btc', SUM(exchange_fees_paid_btc)
            )
            FROM lth_pvr_bt.bt_std_dca_balances
            WHERE bt_run_id = br.bt_run_id
        ),
        'daily_results', (
            SELECT json_agg(
                json_build_object(
                    'date', trade_date,
                    'lth_pvr_nav', lth.nav_total,
                    'lth_pvr_roi', lth.roi_pct,
                    'std_dca_nav', std.nav_total,
                    'std_dca_roi', std.roi_pct
                ) ORDER BY trade_date
            )
            FROM lth_pvr_bt.bt_results_daily lth
            LEFT JOIN lth_pvr_bt.bt_std_dca_balances std 
                ON lth.bt_run_id = std.bt_run_id 
                AND lth.trade_date = std.trade_date
            WHERE lth.bt_run_id = br.bt_run_id
        )
    )
    INTO v_result
    FROM public.backtest_requests br
    LEFT JOIN lth_pvr_bt.bt_runs bt ON br.bt_run_id = bt.id
    WHERE br.id = p_request_id;
    
    RETURN COALESCE(v_result, json_build_object('error', 'Request not found'));
END;
$$;

COMMENT ON FUNCTION public.get_backtest_results IS 'Get complete back-test results including ROI, CAGR, contributions (gross), fees, and daily data';
