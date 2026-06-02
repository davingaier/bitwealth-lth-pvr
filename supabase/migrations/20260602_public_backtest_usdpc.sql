-- Migration: 20260602_public_backtest_usdpc.sql
--
-- Adds optional USDPC yield-stablecoin parameters to the public back-tester so
-- the marketing site can demonstrate the idle-cash yield advantage of the
-- LTH PVR strategy. The three new params are appended with defaults so existing
-- 5-arg callers continue to work; ef_submit_public_backtest passes them through
-- and ef_bt_execute reads usdpc_enabled / usdpc_apy_percent /
-- usdpc_conversion_fee_percent from bt_params.
--
-- Defaults: USDPC OFF (legacy behaviour). When enabled, 10% APY / 0.1% taker fee.

-- Drop the old 5-arg signature first (the new one has a different argument list).
DROP FUNCTION IF EXISTS public.create_public_backtest_run(TEXT, DATE, DATE, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.create_public_backtest_run(
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
        enable_retrace,
        usdpc_enabled, usdpc_apy_percent, usdpc_conversion_fee_percent
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
        true,   -- enable_retrace = true (Progressive variation)
        COALESCE(p_usdpc_enabled, false),
        COALESCE(p_usdpc_apy_percent, 10),
        COALESCE(p_usdpc_conversion_fee_percent, 0.1)
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
GRANT EXECUTE ON FUNCTION public.create_public_backtest_run(TEXT, DATE, DATE, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC)
    TO service_role;

-- Revoke direct anon/authenticated access – this function must only be called
-- through the edge function (which does reCAPTCHA first).
REVOKE EXECUTE ON FUNCTION public.create_public_backtest_run(TEXT, DATE, DATE, NUMERIC, NUMERIC, BOOLEAN, NUMERIC, NUMERIC)
    FROM anon, authenticated;
