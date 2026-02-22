-- Fix enable_retrace in public_backtest to match Progressive variation default
-- Date: 2026-02-22
-- Issue: Public website back-tester was setting enable_retrace=false, 
--        while Progressive variation uses enable_retrace=true. This caused
--        $133K NAV discrepancy between simulator and public back-tester results.
-- Solution: Update run_public_backtest() to set enable_retrace=true

CREATE OR REPLACE FUNCTION public.run_public_backtest(
    p_email TEXT,
    p_captcha_token TEXT,
    p_start_date DATE,
    p_end_date DATE,
    p_upfront_usdt NUMERIC,
    p_monthly_usdt NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_request_id UUID;
    v_bt_run_id UUID;
    v_remaining INTEGER;
    v_org_id UUID;
    v_captcha_valid BOOLEAN;
    v_captcha_response JSON;
BEGIN
    -- 1. Verify CAPTCHA token with Google reCAPTCHA API
    BEGIN
        SELECT content::json INTO v_captcha_response
        FROM http((
            'POST',
            'https://www.google.com/recaptcha/api/siteverify',
            ARRAY[http_header('Content-Type', 'application/x-www-form-urlencoded')],
            'application/x-www-form-urlencoded',
            'secret=' || current_setting('app.settings.recaptcha_secret_key', true) || 
            '&response=' || p_captcha_token
        ));
        
        v_captcha_valid := COALESCE((v_captcha_response->>'success')::boolean, false);
    EXCEPTION WHEN OTHERS THEN
        -- If reCAPTCHA API call fails, log error but don't block (fallback to rate limiting only)
        v_captcha_valid := true;
        RAISE WARNING 'reCAPTCHA verification failed: %', SQLERRM;
    END;
    
    IF NOT v_captcha_valid THEN
        RETURN json_build_object(
            'success', false,
            'error', 'CAPTCHA verification failed. Please try again.'
        );
    END IF;
    
    -- 2. Validate email format
    IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid email format'
        );
    END IF;
    
    -- 3. Check rate limit
    IF NOT public.check_backtest_rate_limit(p_email) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Maximum 10 back-tests per day per email.',
            'remaining', 0
        );
    END IF;
    
    -- 4. Validate date range
    IF p_start_date >= p_end_date THEN
        RETURN json_build_object(
            'success', false,
            'error', 'End date must be after start date'
        );
    END IF;
    
    IF p_end_date > CURRENT_DATE THEN
        RETURN json_build_object(
            'success', false,
            'error', 'End date cannot be in the future'
        );
    END IF;
    
    -- 5. Validate amounts
    IF p_upfront_usdt < 0 OR p_monthly_usdt < 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Investment amounts must be positive'
        );
    END IF;
    
    IF p_upfront_usdt = 0 AND p_monthly_usdt = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'At least one investment amount must be greater than zero'
        );
    END IF;
    
    -- 6. Get org_id from environment (assuming single org for public back-tests)
    v_org_id := current_setting('app.org_id', true)::UUID;
    IF v_org_id IS NULL THEN
        -- Fallback: get first org (for public back-tests)
        SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
    END IF;
    
    -- 7. Create backtest request record
    INSERT INTO public.backtest_requests (
        email,
        start_date,
        end_date,
        upfront_usdt,
        monthly_usdt,
        status
    ) VALUES (
        LOWER(TRIM(p_email)),
        p_start_date,
        p_end_date,
        p_upfront_usdt,
        p_monthly_usdt,
        'pending'
    ) RETURNING id INTO v_request_id;
    
    -- 8. Create back-test run record in lth_pvr_bt schema
    INSERT INTO lth_pvr_bt.bt_runs (
        org_id,
        run_label,
        start_date,
        end_date,
        status
    ) VALUES (
        v_org_id,
        'Public BT: ' || p_email || ' - ' || TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI'),
        p_start_date,
        p_end_date,
        'pending'
    ) RETURNING id INTO v_bt_run_id;
    
    -- 9. Link request to bt_run
    UPDATE public.backtest_requests
    SET bt_run_id = v_bt_run_id,
        status = 'running',
        updated_at = NOW()
    WHERE id = v_request_id;
    
    -- 10. Create bt_params record
    -- NOTE: B1-B11 are NULL here, ef_bt_execute will apply Progressive defaults:
    -- B1=0.22796, B2=0.21397, B3=0.19943, B4=0.18088, B5=0.12229, 
    -- B6=0.00157, B7=0.002, B8=0.00441, B9=0.01287, B10=0.033, B11=0.09572
    INSERT INTO lth_pvr_bt.bt_params (
        bt_run_id,
        start_date,
        end_date,
        upfront_contrib_usdt,
        monthly_contrib_usdt,
        maker_bps_trade,
        maker_bps_contrib,
        performance_fee_pct,
        platform_fee_pct,
        momo_len,
        momo_thr,
        enable_retrace
    ) VALUES (
        v_bt_run_id,
        p_start_date,
        p_end_date,
        p_upfront_usdt,
        p_monthly_usdt,
        8.0,   -- VALR maker fee for BTC/USDT trades (0.08%, charged in BTC)
        18.0,  -- VALR deposit fee for USDT/ZAR conversion (0.18%, charged in USDT)
        0.10,  -- 10% BitWealth performance fee (high-water mark)
        0.0075, -- 0.75% BitWealth platform fee on contributions
        5,     -- 5-day momentum length (matching Progressive variation)
        0.00,  -- 0% momentum threshold (matching Progressive variation)
        true   -- Enable retrace logic (matching Progressive variation default)
    );
    
    -- 11. Get remaining count
    v_remaining := public.get_remaining_backtest_requests(p_email);
    
    -- 12. Return success with request_id
    RETURN json_build_object(
        'success', true,
        'request_id', v_request_id,
        'remaining', v_remaining,
        'message', 'Back-test queued successfully. Results will be available shortly.'
    );
END;
$$;

-- Grant EXECUTE permission to anon and authenticated users
GRANT EXECUTE ON FUNCTION public.run_public_backtest(TEXT, TEXT, DATE, DATE, NUMERIC, NUMERIC) TO anon;
GRANT EXECUTE ON FUNCTION public.run_public_backtest(TEXT, TEXT, DATE, DATE, NUMERIC, NUMERIC) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.run_public_backtest(TEXT, TEXT, DATE, DATE, NUMERIC, NUMERIC) IS 
'Public back-test submission with hCaptcha verification and Progressive variation defaults (enable_retrace=true).';
