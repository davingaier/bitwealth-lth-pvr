-- Migration: 20260316_create_public_backtest_run_no_http.sql
--
-- ROOT CAUSE FIX: run_public_backtest() called the http() PostgreSQL extension to
-- verify reCAPTCHA tokens (blocking Google's API from inside the DB).  Each call
-- held a database connection open until Google responded, exhausting the connection
-- pool and causing 504 Gateway Timeout for ALL admin and public requests.
--
-- SOLUTION: Strip all HTTP work out of the SQL layer.  The new function
-- create_public_backtest_run() only does DB writes.  reCAPTCHA verification is
-- moved to ef_submit_public_backtest (Deno edge function) which has no statement
-- timeout and uses its own network stack.

CREATE OR REPLACE FUNCTION public.create_public_backtest_run(
    p_email          TEXT,
    p_start_date     DATE,
    p_end_date       DATE,
    p_upfront_usdt   NUMERIC,
    p_monthly_usdt   NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_request_id UUID;
    v_bt_run_id  UUID;
    v_remaining  INTEGER;
    v_org_id     UUID;
BEGIN
    -- 1. Validate email format
    IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN json_build_object('success', false, 'error', 'Invalid email format');
    END IF;

    -- 2. Rate limit check
    IF NOT public.check_backtest_rate_limit(p_email) THEN
        RETURN json_build_object(
            'success',   false,
            'error',     'Rate limit exceeded. Maximum 10 back-tests per day per email.',
            'remaining', 0
        );
    END IF;

    -- 3. Validate date range
    IF p_start_date >= p_end_date THEN
        RETURN json_build_object('success', false, 'error', 'End date must be after start date');
    END IF;
    IF p_end_date > CURRENT_DATE THEN
        RETURN json_build_object('success', false, 'error', 'End date cannot be in the future');
    END IF;

    -- 4. Validate amounts
    IF p_upfront_usdt < 0 OR p_monthly_usdt < 0 THEN
        RETURN json_build_object('success', false, 'error', 'Investment amounts must be positive');
    END IF;
    IF p_upfront_usdt = 0 AND p_monthly_usdt = 0 THEN
        RETURN json_build_object('success', false, 'error', 'At least one investment amount must be greater than zero');
    END IF;

    -- 5. Resolve org_id
    BEGIN
        v_org_id := current_setting('app.org_id', true)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_org_id := NULL;
    END;
    IF v_org_id IS NULL THEN
        SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
    END IF;

    -- 6. Create backtest_request record
    INSERT INTO public.backtest_requests (
        email, start_date, end_date, upfront_usdt, monthly_usdt, status
    ) VALUES (
        LOWER(TRIM(p_email)), p_start_date, p_end_date, p_upfront_usdt, p_monthly_usdt, 'pending'
    ) RETURNING id INTO v_request_id;

    -- 7. Create bt_run
    INSERT INTO lth_pvr_bt.bt_runs (org_id, status)
    VALUES (v_org_id, 'running')
    RETURNING bt_run_id INTO v_bt_run_id;

    -- 8. Link request → bt_run and mark running
    UPDATE public.backtest_requests
    SET bt_run_id  = v_bt_run_id,
        status     = 'running',
        updated_at = NOW()
    WHERE id = v_request_id;

    -- 9. Create bt_params with Progressive variation defaults
    --    B1-B11 are NULL; ef_bt_execute applies them from the Progressive variation.
    INSERT INTO lth_pvr_bt.bt_params (
        bt_run_id,
        start_date, end_date,
        upfront_contrib_usdt, monthly_contrib_usdt,
        maker_bps_trade, maker_bps_contrib,
        performance_fee_pct, platform_fee_pct,
        momo_len, momo_thr,
        enable_retrace
    ) VALUES (
        v_bt_run_id,
        p_start_date, p_end_date,
        p_upfront_usdt, p_monthly_usdt,
        8.0,    -- VALR maker fee 0.08% on BTC/USDT trades (charged in BTC)
        18.0,   -- VALR deposit fee 0.18% on USDT/ZAR conversion (charged in USDT)
        0.10,   -- 10% BitWealth performance fee (high-water mark)
        0.0075, -- 0.75% BitWealth platform fee on contributions
        5,      -- 5-day momentum length (Progressive variation)
        0.00,   -- 0% momentum threshold (Progressive variation)
        true    -- enable_retrace = true (Progressive variation)
    );

    -- 10. Remaining allowance
    v_remaining := public.get_remaining_backtest_requests(p_email);

    RETURN json_build_object(
        'success',    true,
        'request_id', v_request_id,
        'remaining',  v_remaining,
        'message',    'Back-test queued successfully. Results will be available shortly.'
    );
END;
$$;

-- Grant to service_role (edge function runs as service_role, not anon)
GRANT EXECUTE ON FUNCTION public.create_public_backtest_run(TEXT, DATE, DATE, NUMERIC, NUMERIC)
    TO service_role;

-- Revoke direct anon/authenticated access – this function must only be called
-- through the edge function (which does reCAPTCHA first).
REVOKE EXECUTE ON FUNCTION public.create_public_backtest_run(TEXT, DATE, DATE, NUMERIC, NUMERIC)
    FROM anon, authenticated;
