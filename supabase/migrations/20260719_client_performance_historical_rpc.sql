-- ============================================================================
-- Client Performance Forecast Illustration: exact historical annual back-test RPC
-- Date: 2026-07-19
--
-- Adds a client-illustration workflow that can request exact historical LTH PVR
-- annual results for the selected contribution/fee assumptions. The workflow is
-- asynchronous because the historical engine is the existing lth_pvr_bt back-test
-- executor. The RPC queues one run per requested lookback and immediately fires
-- ef_bt_execute via pg_net when the service-role secret is available.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ef_bt_execute already reads these fields; keep this additive in case the
-- back-test parameter table has not yet been widened in a given environment.
ALTER TABLE lth_pvr_bt.bt_params
  ADD COLUMN IF NOT EXISTS fee_plan text NOT NULL DEFAULT 'platform';

ALTER TABLE lth_pvr_bt.bt_params
  ADD COLUMN IF NOT EXISTS management_fee_pct numeric NOT NULL DEFAULT 0;

ALTER TABLE lth_pvr_bt.bt_params
  DROP CONSTRAINT IF EXISTS bt_params_fee_plan_check;
ALTER TABLE lth_pvr_bt.bt_params
  ADD CONSTRAINT bt_params_fee_plan_check CHECK (fee_plan IN ('platform','management'));

COMMENT ON COLUMN lth_pvr_bt.bt_params.fee_plan IS
  'Back-test fee plan: platform charges platform_fee_pct on contributions; management charges management_fee_pct p.a. on NAV.';
COMMENT ON COLUMN lth_pvr_bt.bt_params.management_fee_pct IS
  'Annual management fee rate for management-plan back-tests, e.g. 0.01 = 1% p.a.';

CREATE TABLE IF NOT EXISTS public.client_performance_illustration_versions (
  version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path text NOT NULL UNIQUE,
  version_label text NOT NULL,
  notes text,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_perf_illustration_current
  ON public.client_performance_illustration_versions (is_current)
  WHERE is_current;

COMMENT ON TABLE public.client_performance_illustration_versions IS
  'Registry of client performance illustration HTML files so Admin UI can link current and prior versions.';

INSERT INTO public.client_performance_illustration_versions (file_path, version_label, notes, is_current)
VALUES (
  'docs/LTH_PVR_Client_Performance_Forecast_Illustration.html',
  'v1 - historical plus forecast illustration',
  'Initial standalone client illustration page with exact historical workflow support.',
  true
)
ON CONFLICT (file_path) DO UPDATE
SET version_label = EXCLUDED.version_label,
    notes = EXCLUDED.notes,
    is_current = EXCLUDED.is_current;

CREATE TABLE IF NOT EXISTS public.client_historical_annual_requests (
  request_group_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  requested_by uuid NULL,
  source_page_path text NOT NULL DEFAULT 'docs/LTH_PVR_Client_Performance_Forecast_Illustration.html',
  upfront_usdt numeric NOT NULL,
  monthly_usdt numeric NOT NULL,
  end_date date NOT NULL,
  lookback_years integer[] NOT NULL,
  management_fee_rate numeric NOT NULL DEFAULT 0.01,
  performance_fee_rate numeric NOT NULL DEFAULT 0.10,
  exchange_conversion_fee_rate numeric NOT NULL DEFAULT 0.0018,
  exchange_trade_fee_rate numeric NOT NULL DEFAULT 0.0008,
  usdpc_enabled boolean NOT NULL DEFAULT true,
  usdpc_apy_percent numeric NOT NULL DEFAULT 10,
  usdpc_conversion_fee_percent numeric NOT NULL DEFAULT 0.1,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','partial','failed')),
  completed_at timestamptz NULL,
  error_message text NULL
);

CREATE INDEX IF NOT EXISTS idx_client_hist_req_created_at
  ON public.client_historical_annual_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_hist_req_status
  ON public.client_historical_annual_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.client_historical_annual_request_runs (
  request_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_group_id uuid NOT NULL REFERENCES public.client_historical_annual_requests(request_group_id) ON DELETE CASCADE,
  lookback_years integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  backtest_request_id uuid NULL REFERENCES public.backtest_requests(id),
  bt_run_id uuid NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','fired','running','complete','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  fired_at timestamptz NULL,
  completed_at timestamptz NULL,
  http_request_id bigint NULL,
  error_message text NULL,
  UNIQUE (request_group_id, lookback_years)
);

CREATE INDEX IF NOT EXISTS idx_client_hist_runs_group
  ON public.client_historical_annual_request_runs (request_group_id, lookback_years);
CREATE INDEX IF NOT EXISTS idx_client_hist_runs_bt_run
  ON public.client_historical_annual_request_runs (bt_run_id);

COMMENT ON TABLE public.client_historical_annual_requests IS
  'Groups exact historical annual back-test runs requested by the client performance illustration page.';
COMMENT ON TABLE public.client_historical_annual_request_runs IS
  'One exact historical back-test run per lookback period, with requested/fired/completed timestamps for Admin UI visibility.';

CREATE OR REPLACE FUNCTION public._refresh_client_historical_annual_request(p_request_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, lth_pvr_bt
AS $function$
DECLARE
  v_group_status text;
BEGIN
  UPDATE public.client_historical_annual_request_runs r
  SET status = CASE
        WHEN bt.status = 'ok' THEN 'complete'
        WHEN bt.status = 'error' THEN 'failed'
        WHEN r.fired_at IS NOT NULL THEN 'running'
        ELSE r.status
      END,
      completed_at = CASE WHEN bt.status = 'ok' THEN COALESCE(r.completed_at, now()) ELSE r.completed_at END,
      error_message = CASE WHEN bt.status = 'error' THEN COALESCE(bt.error, br.error_message, r.error_message) ELSE r.error_message END
  FROM lth_pvr_bt.bt_runs bt
  LEFT JOIN public.backtest_requests br ON br.bt_run_id = bt.bt_run_id
  WHERE r.request_group_id = p_request_group_id
    AND r.bt_run_id = bt.bt_run_id;

  SELECT CASE
      WHEN COUNT(*) = 0 THEN 'queued'
      WHEN BOOL_AND(status = 'complete') THEN 'complete'
      WHEN BOOL_OR(status = 'failed') AND BOOL_OR(status = 'complete') THEN 'partial'
      WHEN BOOL_AND(status = 'failed') THEN 'failed'
      WHEN BOOL_OR(status IN ('fired','running','queued')) THEN 'running'
      ELSE 'queued'
    END
  INTO v_group_status
  FROM public.client_historical_annual_request_runs
  WHERE request_group_id = p_request_group_id;

  UPDATE public.client_historical_annual_requests
  SET status = v_group_status,
      updated_at = now(),
      completed_at = CASE WHEN v_group_status IN ('complete','failed','partial') THEN COALESCE(completed_at, now()) ELSE completed_at END,
      error_message = CASE WHEN v_group_status IN ('failed','partial') THEN (
        SELECT string_agg(error_message, '; ' ORDER BY lookback_years)
        FROM public.client_historical_annual_request_runs
        WHERE request_group_id = p_request_group_id AND error_message IS NOT NULL
      ) ELSE error_message END
  WHERE request_group_id = p_request_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_lth_pvr_historical_annual_results(
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
SET search_path TO public, lth_pvr_bt, lth_pvr
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

  SELECT request_group_id
    INTO v_existing
  FROM public.client_historical_annual_requests
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

    INSERT INTO public.client_historical_annual_requests (
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

    v_service_key := COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1),
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      current_setting('app.settings.service_role_key', true)
    );

    FOR v_year IN SELECT DISTINCT y FROM unnest(p_lookback_years) y ORDER BY y LOOP
      v_start_date := (p_end_date - make_interval(years => v_year) + interval '1 day')::date;

      INSERT INTO public.backtest_requests (email, start_date, end_date, upfront_usdt, monthly_usdt, status)
      VALUES (v_email, v_start_date, p_end_date, p_upfront_usdt, p_monthly_usdt, 'running')
      RETURNING id INTO v_request_id;

      INSERT INTO lth_pvr_bt.bt_runs (org_id, status)
      VALUES (v_org_id, 'running')
      RETURNING bt_run_id INTO v_bt_run_id;

      UPDATE public.backtest_requests
      SET bt_run_id = v_bt_run_id,
          updated_at = now()
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

      v_http_request_id := NULL;
      IF v_service_key IS NOT NULL AND length(v_service_key) > 20 THEN
        SELECT net.http_post(
          url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_bt_execute',
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_service_key),
          body := jsonb_build_object('bt_run_id', v_bt_run_id, 'band_source', 'rb')
        ) INTO v_http_request_id;
      END IF;

      INSERT INTO public.client_historical_annual_request_runs (
        request_group_id, lookback_years, start_date, end_date,
        backtest_request_id, bt_run_id, status, fired_at, http_request_id
      ) VALUES (
        v_group_id, v_year, v_start_date, p_end_date,
        v_request_id, v_bt_run_id,
        CASE WHEN v_http_request_id IS NULL THEN 'queued' ELSE 'fired' END,
        CASE WHEN v_http_request_id IS NULL THEN NULL ELSE now() END,
        v_http_request_id
      );
    END LOOP;
  END IF;

  PERFORM public._refresh_client_historical_annual_request(v_group_id);

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
        FROM public.client_historical_annual_request_runs r
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
        FROM public.client_historical_annual_request_runs x
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
        FROM public.client_historical_annual_request_runs x
        JOIN lth_pvr_bt.v_bt_results_annual a ON a.bt_run_id = x.bt_run_id
        WHERE x.request_group_id = g.request_group_id
          AND x.status = 'complete'
      ), '[]'::jsonb)
    )
    FROM public.client_historical_annual_requests g
    WHERE g.request_group_id = v_group_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_lth_pvr_client_illustration_admin_status(p_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, lth_pvr_bt
AS $function$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'current_version', (
      SELECT to_jsonb(v)
      FROM public.client_performance_illustration_versions v
      WHERE v.is_current
      ORDER BY v.created_at DESC
      LIMIT 1
    ),
    'versions', COALESCE((
      SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC)
      FROM public.client_performance_illustration_versions v
    ), '[]'::jsonb),
    'requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'request_group_id', g.request_group_id,
        'created_at', g.created_at,
        'updated_at', g.updated_at,
        'completed_at', g.completed_at,
        'status', g.status,
        'source_page_path', g.source_page_path,
        'upfront_usdt', g.upfront_usdt,
        'monthly_usdt', g.monthly_usdt,
        'end_date', g.end_date,
        'lookback_years', g.lookback_years,
        'runs', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'lookback_years', r.lookback_years,
            'start_date', r.start_date,
            'end_date', r.end_date,
            'status', r.status,
            'requested_at', r.requested_at,
            'fired_at', r.fired_at,
            'completed_at', r.completed_at,
            'bt_run_id', r.bt_run_id,
            'backtest_request_id', r.backtest_request_id,
            'http_request_id', r.http_request_id,
            'error_message', r.error_message
          ) ORDER BY r.lookback_years)
          FROM public.client_historical_annual_request_runs r
          WHERE r.request_group_id = g.request_group_id
        ), '[]'::jsonb)
      ) ORDER BY g.created_at DESC)
      FROM (
        SELECT *
        FROM public.client_historical_annual_requests
        ORDER BY created_at DESC
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
      ) g
    ), '[]'::jsonb)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.request_lth_pvr_historical_annual_results(
  numeric, numeric, date, integer[], numeric, numeric, numeric, numeric, boolean, numeric, numeric, text
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_lth_pvr_client_illustration_admin_status(integer)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public._refresh_client_historical_annual_request(uuid)
  TO service_role;

COMMENT ON FUNCTION public.request_lth_pvr_historical_annual_results IS
  'Queues/fires exact historical annual LTH PVR back-test runs for the client performance illustration page and returns status/results when complete.';
COMMENT ON FUNCTION public.get_lth_pvr_client_illustration_admin_status IS
  'Admin UI status payload for client performance illustration versions and exact historical back-test requests.';
