CREATE OR REPLACE FUNCTION lth_pvr.request_lth_pvr_historical_annual_results(
  p_upfront_usdt numeric,
  p_monthly_usdt numeric,
  p_end_date date DEFAULT CURRENT_DATE,
  p_lookback_years integer[] DEFAULT ARRAY[1,3,5,7,10],
  p_management_fee_rate numeric DEFAULT 0.01,
  p_performance_fee_rate numeric DEFAULT 0.10,
  p_exchange_conversion_fee_rate numeric DEFAULT 0.0018,
  p_exchange_trade_fee_rate numeric DEFAULT 0.0008,
  p_usdpc_enabled boolean DEFAULT true,
  p_usdpc_apy_percent numeric DEFAULT 10,
  p_usdpc_conversion_fee_percent numeric DEFAULT 0.1,
  p_source_page_path text DEFAULT 'docs/LTH_PVR_Client_Performance_Forecast_Illustration.html'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO lth_pvr, public, lth_pvr_bt
AS $function$
DECLARE
  v_group_id uuid;
  v_existing uuid;
  v_year integer;
  v_start_date date;
  v_bt_run_id uuid;
  v_request_id uuid;
  v_org_id uuid;
  v_service_key text;
  v_http_request_id bigint;
  v_run record;
  v_email text := 'client-illustration@bitwealth.system';
  v_allowed_years integer[] := ARRAY[1,3,5,7,10];
BEGIN
  IF p_upfront_usdt IS NULL OR p_upfront_usdt < 0 OR p_upfront_usdt > 100000000 THEN
    RAISE EXCEPTION 'p_upfront_usdt must be between 0 and 100,000,000';
  END IF;
  IF p_monthly_usdt IS NULL OR p_monthly_usdt < 0 OR p_monthly_usdt > 10000000 THEN
    RAISE EXCEPTION 'p_monthly_usdt must be between 0 and 10,000,000';
  END IF;
  IF p_upfront_usdt = 0 AND p_monthly_usdt = 0 THEN
    RAISE EXCEPTION 'At least one contribution amount must be greater than zero';
  END IF;
  IF p_end_date IS NULL OR p_end_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'p_end_date must not be in the future';
  END IF;
  IF p_lookback_years IS NULL OR array_length(p_lookback_years, 1) IS NULL THEN
    RAISE EXCEPTION 'p_lookback_years must contain at least one lookback year';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_lookback_years) y WHERE y <> ALL(v_allowed_years)) THEN
    RAISE EXCEPTION 'p_lookback_years may only contain 1, 3, 5, 7, and 10';
  END IF;

  v_service_key := COALESCE(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_jwt' LIMIT 1),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
    current_setting('app.settings.service_role_key', true)
  );

  SELECT request_group_id INTO v_existing
  FROM lth_pvr.client_historical_annual_requests
  WHERE upfront_usdt = p_upfront_usdt
    AND monthly_usdt = p_monthly_usdt
    AND end_date = p_end_date
    AND lookback_years = (SELECT array_agg(DISTINCT y ORDER BY y) FROM unnest(p_lookback_years) y)
    AND management_fee_rate = p_management_fee_rate
    AND performance_fee_rate = p_performance_fee_rate
    AND exchange_conversion_fee_rate = p_exchange_conversion_fee_rate
    AND exchange_trade_fee_rate = p_exchange_trade_fee_rate
    AND usdpc_enabled = COALESCE(p_usdpc_enabled, true)
    AND usdpc_apy_percent = COALESCE(p_usdpc_apy_percent, 10)
    AND usdpc_conversion_fee_percent = COALESCE(p_usdpc_conversion_fee_percent, 0.1)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    v_group_id := v_existing;
  ELSE
    BEGIN
      v_org_id := current_setting('app.org_id', true)::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_org_id := NULL;
    END;
    IF v_org_id IS NULL THEN
      SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
    END IF;

    INSERT INTO lth_pvr.client_historical_annual_requests (
      requested_by, source_page_path, upfront_usdt, monthly_usdt, end_date, lookback_years,
      management_fee_rate, performance_fee_rate, exchange_conversion_fee_rate, exchange_trade_fee_rate,
      usdpc_enabled, usdpc_apy_percent, usdpc_conversion_fee_percent, status
    ) VALUES (
      auth.uid(), COALESCE(p_source_page_path, 'docs/LTH_PVR_Client_Performance_Forecast_Illustration.html'),
      p_upfront_usdt, p_monthly_usdt, p_end_date,
      (SELECT array_agg(DISTINCT y ORDER BY y) FROM unnest(p_lookback_years) y),
      p_management_fee_rate, p_performance_fee_rate, p_exchange_conversion_fee_rate, p_exchange_trade_fee_rate,
      COALESCE(p_usdpc_enabled, true), COALESCE(p_usdpc_apy_percent, 10), COALESCE(p_usdpc_conversion_fee_percent, 0.1),
      'queued'
    ) RETURNING request_group_id INTO v_group_id;

    FOR v_year IN SELECT DISTINCT y FROM unnest(p_lookback_years) y ORDER BY y LOOP
      v_start_date := (p_end_date - make_interval(years => v_year) + interval '1 day')::date;

      INSERT INTO public.backtest_requests (email, start_date, end_date, upfront_usdt, monthly_usdt, status)
      VALUES (v_email, v_start_date, p_end_date, p_upfront_usdt, p_monthly_usdt, 'running')
      RETURNING id INTO v_request_id;

      INSERT INTO lth_pvr_bt.bt_runs (org_id, status)
      VALUES (v_org_id, 'running')
      RETURNING bt_run_id INTO v_bt_run_id;

      UPDATE public.backtest_requests
      SET bt_run_id = v_bt_run_id, updated_at = now()
      WHERE id = v_request_id;

      INSERT INTO lth_pvr_bt.bt_params (
        bt_run_id, start_date, end_date,
        upfront_contrib_usdt, monthly_contrib_usdt,
        maker_bps_trade, maker_bps_contrib,
        performance_fee_pct, platform_fee_pct, fee_plan, management_fee_pct,
        momo_len, momo_thr, enable_retrace,
        usdpc_enabled, usdpc_apy_percent, usdpc_conversion_fee_percent
      ) VALUES (
        v_bt_run_id, v_start_date, p_end_date,
        p_upfront_usdt, p_monthly_usdt,
        p_exchange_trade_fee_rate * 10000,
        p_exchange_conversion_fee_rate * 10000,
        p_performance_fee_rate, 0, 'management', p_management_fee_rate,
        5, 0.00, true,
        COALESCE(p_usdpc_enabled, true), COALESCE(p_usdpc_apy_percent, 10), COALESCE(p_usdpc_conversion_fee_percent, 0.1)
      );

      INSERT INTO lth_pvr.client_historical_annual_request_runs (
        request_group_id, lookback_years, start_date, end_date,
        backtest_request_id, bt_run_id, status
      ) VALUES (
        v_group_id, v_year, v_start_date, p_end_date,
        v_request_id, v_bt_run_id, 'queued'
      );
    END LOOP;
  END IF;

  IF v_service_key IS NOT NULL AND length(v_service_key) > 20 THEN
    FOR v_run IN
      SELECT request_run_id, bt_run_id
      FROM lth_pvr.client_historical_annual_request_runs
      WHERE request_group_id = v_group_id
        AND bt_run_id IS NOT NULL
        AND fired_at IS NULL
        AND status IN ('queued','fired','running')
      ORDER BY lookback_years
    LOOP
      SELECT net.http_post(
        url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_bt_execute',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_service_key),
        body := jsonb_build_object('bt_run_id', v_run.bt_run_id, 'band_source', 'rb')
      ) INTO v_http_request_id;

      UPDATE lth_pvr.client_historical_annual_request_runs
      SET status = 'fired', fired_at = now(), http_request_id = v_http_request_id
      WHERE request_run_id = v_run.request_run_id;
    END LOOP;
  END IF;

  PERFORM lth_pvr._refresh_client_historical_annual_request(v_group_id);

  RETURN (
    SELECT jsonb_build_object(
      'request_group_id', g.request_group_id,
      'status', g.status,
      'created_at', g.created_at,
      'updated_at', g.updated_at,
      'completed_at', g.completed_at,
      'source_page_path', g.source_page_path,
      'runs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'lookback_years', r.lookback_years,
          'start_date', r.start_date,
          'end_date', r.end_date,
          'status', r.status,
          'requested_at', r.requested_at,
          'fired_at', r.fired_at,
          'completed_at', r.completed_at,
          'backtest_request_id', r.backtest_request_id,
          'bt_run_id', r.bt_run_id,
          'http_request_id', r.http_request_id,
          'error_message', r.error_message
        ) ORDER BY r.lookback_years)
        FROM lth_pvr.client_historical_annual_request_runs r
        WHERE r.request_group_id = g.request_group_id
      ), '[]'::jsonb),
      'summary_rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'lookback_years', x.lookback_years,
          'period_start', x.start_date,
          'period_end', x.end_date,
          'total_investment', a.total_investment,
          'lth_pvr_nav', a.nav_usd,
          'lth_pvr_roi', a.roi_percent,
          'lth_pvr_cagr', a.cagr_percent,
          'std_dca_nav', a.std_nav_usd,
          'std_dca_roi', a.std_roi_percent,
          'std_dca_cagr', a.std_cagr_percent,
          'hodl_nav', a.hodl_nav_usd,
          'hodl_roi', a.hodl_roi_percent,
          'hodl_cagr', a.hodl_cagr_percent
        ) ORDER BY x.lookback_years)
        FROM lth_pvr.client_historical_annual_request_runs x
        JOIN LATERAL (
          SELECT va.*
          FROM lth_pvr_bt.v_bt_results_annual va
          WHERE va.bt_run_id = x.bt_run_id
          ORDER BY va.trading_year DESC
          LIMIT 1
        ) a ON true
        WHERE x.request_group_id = g.request_group_id
          AND x.status = 'complete'
      ), '[]'::jsonb),
      'annual_rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'lookback_years', x.lookback_years,
          'trading_year', a.trading_year,
          'total_investment', a.total_investment,
          'lth_pvr_nav', a.nav_usd,
          'lth_pvr_roi', a.roi_percent,
          'lth_pvr_cagr', a.cagr_percent,
          'std_dca_nav', a.std_nav_usd,
          'std_dca_roi', a.std_roi_percent,
          'std_dca_cagr', a.std_cagr_percent,
          'hodl_nav', a.hodl_nav_usd,
          'hodl_roi', a.hodl_roi_percent,
          'hodl_cagr', a.hodl_cagr_percent
        ) ORDER BY x.lookback_years, a.trading_year)
        FROM lth_pvr.client_historical_annual_request_runs x
        JOIN lth_pvr_bt.v_bt_results_annual a ON a.bt_run_id = x.bt_run_id
        WHERE x.request_group_id = g.request_group_id
          AND x.status = 'complete'
      ), '[]'::jsonb)
    )
    FROM lth_pvr.client_historical_annual_requests g
    WHERE g.request_group_id = v_group_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION lth_pvr.request_lth_pvr_historical_annual_results(
  numeric, numeric, date, integer[], numeric, numeric, numeric, numeric, boolean, numeric, numeric, text
) TO anon, authenticated, service_role;