-- 20261103_public_sth_cb_backtest.sql
--
-- Public website back-tester + marketing chart for the STH Cost Basis Strategy
-- (Hybrid v2.2). Mirrors the LTH PVR public plumbing on the sth_cb_bt schema:
--
--   public.backtest_requests.strategy_code          'lth_pvr' (default) | 'sth_cb'
--   public.create_public_sth_cb_backtest_run(...)   rate-limited run creator (service_role only;
--                                                   called by ef_submit_public_backtest after reCAPTCHA)
--   public.get_sth_cb_backtest_results(uuid)        anonymous poller (same shape as get_backtest_results,
--                                                   keys strategy_* instead of lth_pvr_*)
--   public.get_marketing_chart(text)                generic anonymous reader (lth_pvr_5yr | sth_cb_5yr)
--
-- The strategy configuration is NOT duplicated here: the run copies `extras` from
-- sth_cb.tracker_config (tracker_key 'hybrid_v2_2'), so the public tool, the daily
-- tracker and the Admin UI preset share one source of truth. Fee model = 1 % p.a.
-- management (NAV × 1 % / 12 monthly) + 10 % performance (high-water mark), VALR
-- 8 bps trade / 18 bps conversion, USDPC optional (from the form).

-- ── 1. backtest_requests: allow runs that live in sth_cb_bt ─────────────────────
ALTER TABLE public.backtest_requests DROP CONSTRAINT IF EXISTS backtest_requests_bt_run_id_fkey;
ALTER TABLE public.backtest_requests
  ADD COLUMN IF NOT EXISTS strategy_code text NOT NULL DEFAULT 'lth_pvr';
ALTER TABLE public.backtest_requests DROP CONSTRAINT IF EXISTS backtest_requests_strategy_code_check;
ALTER TABLE public.backtest_requests
  ADD CONSTRAINT backtest_requests_strategy_code_check CHECK (strategy_code IN ('lth_pvr', 'sth_cb'));
CREATE INDEX IF NOT EXISTS idx_backtest_requests_strategy_status
  ON public.backtest_requests (strategy_code, status);

COMMENT ON COLUMN public.backtest_requests.strategy_code IS
  'Which engine ran this request: lth_pvr → lth_pvr_bt.* / ef_bt_execute; sth_cb → sth_cb_bt.* / ef_sth_cb_bt_execute. '
  'bt_run_id points into the matching schema (FK dropped 2026-11-03).';

-- ── 2. Run creator (service_role only) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_public_sth_cb_backtest_run(
    p_email                         TEXT,
    p_start_date                    DATE,
    p_end_date                      DATE,
    p_upfront_usdt                  NUMERIC,
    p_monthly_usdt                  NUMERIC,
    p_usdpc_enabled                 BOOLEAN DEFAULT false,
    p_usdpc_apy_percent             NUMERIC DEFAULT 10,
    p_usdpc_conversion_fee_percent  NUMERIC DEFAULT 0.1
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, sth_cb, sth_cb_bt
AS $$
DECLARE
    v_request_id UUID;
    v_bt_run_id  UUID;
    v_remaining  INTEGER;
    v_org_id     UUID;
    v_extras     JSONB;
BEGIN
    IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN json_build_object('success', false, 'error', 'Invalid email format');
    END IF;

    IF NOT public.check_backtest_rate_limit(LOWER(TRIM(p_email))) THEN
        RETURN json_build_object(
            'success',   false,
            'error',     'Rate limit exceeded. Maximum 10 back-tests per day per email.',
            'remaining', 0
        );
    END IF;

    IF p_start_date >= p_end_date THEN
        RETURN json_build_object('success', false, 'error', 'End date must be after start date');
    END IF;
    IF p_end_date > CURRENT_DATE THEN
        RETURN json_build_object('success', false, 'error', 'End date cannot be in the future');
    END IF;
    IF p_upfront_usdt < 0 OR p_monthly_usdt < 0 THEN
        RETURN json_build_object('success', false, 'error', 'Investment amounts must be positive');
    END IF;
    IF p_upfront_usdt = 0 AND p_monthly_usdt = 0 THEN
        RETURN json_build_object('success', false, 'error', 'At least one investment amount must be greater than zero');
    END IF;

    BEGIN
        v_org_id := current_setting('app.org_id', true)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_org_id := NULL;
    END;
    IF v_org_id IS NULL THEN
        SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at LIMIT 1;
    END IF;

    -- Live strategy definition (Hybrid v2.2) — shared with the daily tracker.
    SELECT extras INTO v_extras
    FROM sth_cb.tracker_config
    WHERE org_id = v_org_id AND tracker_key = 'hybrid_v2_2' AND COALESCE(is_active, true)
    LIMIT 1;
    IF v_extras IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Strategy configuration unavailable. Please try again later.');
    END IF;

    INSERT INTO public.backtest_requests (
        email, start_date, end_date, upfront_usdt, monthly_usdt, status, strategy_code
    ) VALUES (
        LOWER(TRIM(p_email)), p_start_date, p_end_date, p_upfront_usdt, p_monthly_usdt, 'pending', 'sth_cb'
    ) RETURNING id INTO v_request_id;

    INSERT INTO sth_cb_bt.bt_runs (org_id, status, label)
    VALUES (v_org_id, 'running', 'public website · ' || LOWER(TRIM(p_email)))
    RETURNING bt_run_id INTO v_bt_run_id;

    UPDATE public.backtest_requests
    SET bt_run_id = v_bt_run_id, status = 'running', updated_at = NOW()
    WHERE id = v_request_id;

    -- Base columns keep their defaults (satisfying chk_sth_cb_ratios); the full
    -- Hybrid v2.2 config in `extras` overrides them in the engine.
    INSERT INTO sth_cb_bt.bt_params (
        bt_run_id, start_date, end_date,
        upfront_contrib_usdt, monthly_contrib_usdt,
        maker_bps_trade, maker_bps_contrib,
        fee_plan, management_fee_pct, performance_fee_pct, platform_fee_pct,
        usdpc_enabled, usdpc_apy_percent, usdpc_conversion_fee_percent,
        execution_lag_days, extras
    ) VALUES (
        v_bt_run_id, p_start_date, p_end_date,
        p_upfront_usdt, p_monthly_usdt,
        8.0, 18.0,
        'management', 0.01, 0.10, 0,
        COALESCE(p_usdpc_enabled, false),
        COALESCE(p_usdpc_apy_percent, 10),
        COALESCE(p_usdpc_conversion_fee_percent, 0.1),
        1, v_extras
    );

    v_remaining := public.get_remaining_backtest_requests(LOWER(TRIM(p_email)));

    RETURN json_build_object(
        'success',    true,
        'request_id', v_request_id,
        'bt_run_id',  v_bt_run_id,
        'remaining',  v_remaining,
        'message',    'Back-test queued successfully. Results will be available shortly.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_public_sth_cb_backtest_run(TEXT, DATE, DATE, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_sth_cb_backtest_run(TEXT, DATE, DATE, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC) TO service_role;

-- ── 3. Anonymous results poller ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sth_cb_backtest_results(p_request_id UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, sth_cb_bt
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'request_id',    br.id,
        'status',        br.status,
        'error_message', br.error_message,
        'bt_run_id',     br.bt_run_id,
        'strategy_code', br.strategy_code,
        'start_date',    br.start_date,
        'end_date',      br.end_date,
        'upfront_usdt',  br.upfront_usdt,
        'monthly_usdt',  br.monthly_usdt,
        'run_status',    bt.status,
        'strategy_summary', (
            SELECT json_build_object(
                'final_nav',               last.nav_usd,
                'total_roi',               last.total_roi_percent,
                'cagr',                    last.cagr_percent,
                'btc_balance',             last.btc_balance,
                'usdt_balance',            last.usdt_balance,
                'contrib_net',             last.contrib_net_usdt_cum,
                'contrib_gross',           last.contrib_gross_usdt_cum,
                'total_management_fees',   agg.total_platform_fees,
                'total_performance_fees',  agg.total_performance_fees,
                'total_exchange_fees_usdt', agg.total_exchange_fees_usdt,
                'total_exchange_fees_btc', agg.total_exchange_fees_btc,
                'total_usdpc_yield',       agg.total_usdpc_yield,
                'pct_time_in_market',      agg.pct_in_market,
                'trades',                  agg.trades
            )
            FROM (
                SELECT * FROM sth_cb_bt.bt_results_daily
                WHERE bt_run_id = br.bt_run_id ORDER BY close_date DESC LIMIT 1
            ) last
            CROSS JOIN (
                SELECT SUM(platform_fees_paid_usdt)    AS total_platform_fees,
                       SUM(performance_fees_paid_usdt) AS total_performance_fees,
                       SUM(exchange_fees_paid_usdt)    AS total_exchange_fees_usdt,
                       SUM(exchange_fees_paid_btc)     AS total_exchange_fees_btc,
                       SUM(usdpc_yield_usdt)           AS total_usdpc_yield,
                       ROUND(100.0 * AVG(CASE WHEN btc_balance > 0 THEN 1 ELSE 0 END), 1) AS pct_in_market,
                       COUNT(*) FILTER (WHERE action IN ('BUY', 'SELL') AND COALESCE(rule, '') <> 'Deploy contribution') AS trades
                FROM sth_cb_bt.bt_results_daily WHERE bt_run_id = br.bt_run_id
            ) agg
        ),
        'std_dca_summary', (
            SELECT json_build_object(
                'final_nav', last.nav_usd, 'total_roi', last.total_roi_percent, 'cagr', last.cagr_percent,
                'btc_balance', last.btc_balance, 'usdt_balance', last.usdt_balance,
                'contrib_net', last.contrib_net_usdt_cum, 'contrib_gross', last.contrib_gross_usdt_cum,
                'total_exchange_fees_usdt', last.total_exchange_fees_usdt, 'total_exchange_fees_btc', last.total_exchange_fees_btc
            )
            FROM (SELECT * FROM sth_cb_bt.bt_std_dca_balances WHERE bt_run_id = br.bt_run_id ORDER BY close_date DESC LIMIT 1) last
        ),
        'hodl_summary', (
            SELECT json_build_object(
                'final_nav', last.nav_usd, 'total_roi', last.total_roi_percent, 'cagr', last.cagr_percent,
                'btc_balance', last.btc_balance, 'usdt_balance', last.usdt_balance,
                'contrib_net', last.contrib_net_usdt_cum, 'contrib_gross', last.contrib_gross_usdt_cum,
                'total_exchange_fees_usdt', last.total_exchange_fees_usdt, 'total_exchange_fees_btc', last.total_exchange_fees_btc
            )
            FROM (SELECT * FROM sth_cb_bt.bt_hodl_balances WHERE bt_run_id = br.bt_run_id ORDER BY close_date DESC LIMIT 1) last
        ),
        'daily_results', (
            SELECT json_agg(
                json_build_object(
                    'date',         s.close_date,
                    'strategy_nav', s.nav_usd,
                    'strategy_roi', s.total_roi_percent,
                    'in_market',    s.btc_balance > 0,
                    'std_dca_nav',  std.nav_usd,
                    'std_dca_roi',  std.total_roi_percent,
                    'hodl_nav',     hodl.nav_usd,
                    'hodl_roi',     hodl.total_roi_percent
                ) ORDER BY s.close_date
            )
            FROM sth_cb_bt.bt_results_daily s
            LEFT JOIN sth_cb_bt.bt_std_dca_balances std ON std.bt_run_id = s.bt_run_id AND std.close_date = s.close_date
            LEFT JOIN sth_cb_bt.bt_hodl_balances   hodl ON hodl.bt_run_id = s.bt_run_id AND hodl.close_date = s.close_date
            WHERE s.bt_run_id = br.bt_run_id
        )
    )
    INTO v_result
    FROM public.backtest_requests br
    LEFT JOIN sth_cb_bt.bt_runs bt ON bt.bt_run_id = br.bt_run_id
    WHERE br.id = p_request_id AND br.strategy_code = 'sth_cb';

    RETURN COALESCE(v_result, json_build_object('error', 'Request not found'));
END;
$$;

COMMENT ON FUNCTION public.get_sth_cb_backtest_results(UUID) IS
  'Public poller for STH Cost Basis back-tests (website/sth-cb-backtest.html): strategy / Std DCA / HODL summaries + daily series.';
REVOKE ALL ON FUNCTION public.get_sth_cb_backtest_results(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sth_cb_backtest_results(UUID) TO anon, authenticated, service_role;

-- ── 4. Generic marketing-chart reader + seed row ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_marketing_chart(p_chart_key TEXT)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'chart_key',    m.chart_key,
    'status',       m.status,
    'generated_at', m.generated_at,
    'window_start', m.window_start,
    'window_end',   m.window_end,
    'params',       m.params,
    'payload',      m.payload
  )
  FROM public.marketing_chart_data m
  WHERE m.chart_key = p_chart_key
    AND m.chart_key IN ('lth_pvr_5yr', 'sth_cb_5yr')
    AND m.status = 'ready';
$$;

COMMENT ON FUNCTION public.get_marketing_chart(TEXT) IS
  'Anonymous reader for cached marketing back-test payloads (allow-listed chart keys only).';
REVOKE ALL ON FUNCTION public.get_marketing_chart(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_marketing_chart(TEXT) TO anon, authenticated, service_role;

INSERT INTO public.marketing_chart_data (chart_key, status)
VALUES ('sth_cb_5yr', 'pending')
ON CONFLICT (chart_key) DO NOTHING;
