-- Create public backtest requests table for lead capture and rate limiting
-- This table tracks all public back-test requests to enforce rate limits and capture leads

CREATE TABLE IF NOT EXISTS public.backtest_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    request_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Back-test parameters
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    upfront_usdt NUMERIC(15,2) NOT NULL,
    monthly_usdt NUMERIC(15,2) NOT NULL,
    
    -- Reference to actual back-test run
    bt_run_id UUID REFERENCES lth_pvr_bt.bt_runs(id),
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    error_message TEXT,
    
    -- Metadata
    ip_address TEXT,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_backtest_requests_email_date ON public.backtest_requests(email, request_date);
CREATE INDEX idx_backtest_requests_bt_run_id ON public.backtest_requests(bt_run_id);
CREATE INDEX idx_backtest_requests_status ON public.backtest_requests(status);
CREATE INDEX idx_backtest_requests_created_at ON public.backtest_requests(created_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE public.backtest_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Allow anonymous inserts (for public back-test submissions)
CREATE POLICY "Allow anonymous backtest submissions"
    ON public.backtest_requests
    FOR INSERT
    TO anon
    WITH CHECK (true);

-- Policy: Allow authenticated reads (for admin review)
CREATE POLICY "Allow authenticated reads"
    ON public.backtest_requests
    FOR SELECT
    TO authenticated
    USING (true);

-- Function to check rate limit (max 10 requests per email per day)
CREATE OR REPLACE FUNCTION public.check_backtest_rate_limit(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    -- Count requests from this email today
    SELECT COUNT(*)
    INTO v_count
    FROM public.backtest_requests
    WHERE email = p_email
      AND request_date = CURRENT_DATE;
    
    -- Return true if under limit (10 per day)
    RETURN v_count < 10;
END;
$$;

-- Function to get remaining requests for an email today
CREATE OR REPLACE FUNCTION public.get_remaining_backtest_requests(p_email TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM public.backtest_requests
    WHERE email = p_email
      AND request_date = CURRENT_DATE;
    
    RETURN GREATEST(0, 10 - v_count);
END;
$$;

-- RPC function to submit public back-test request
CREATE OR REPLACE FUNCTION public.run_public_backtest(
    p_email TEXT,
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
BEGIN
    -- Validate email format
    IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid email format'
        );
    END IF;
    
    -- Check rate limit
    IF NOT public.check_backtest_rate_limit(p_email) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Maximum 10 back-tests per day per email.',
            'remaining', 0
        );
    END IF;
    
    -- Validate date range
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
    
    -- Validate amounts
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
    
    -- Get org_id from environment (assuming single org for public back-tests)
    v_org_id := current_setting('app.org_id', true)::UUID;
    IF v_org_id IS NULL THEN
        -- Fallback: get first org (for public back-tests)
        SELECT id INTO v_org_id FROM public.organizations LIMIT 1;
    END IF;
    
    -- Create backtest request record
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
    
    -- Create back-test run record in lth_pvr_bt schema
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
    
    -- Link request to bt_run
    UPDATE public.backtest_requests
    SET bt_run_id = v_bt_run_id,
        status = 'running'
    WHERE id = v_request_id;
    
    -- Create back-test parameters
    INSERT INTO lth_pvr_bt.bt_params (
        bt_run_id,
        upfront_usdt,
        monthly_usdt,
        performance_fee_pct,
        platform_fee_pct
    ) VALUES (
        v_bt_run_id,
        p_upfront_usdt,
        p_monthly_usdt,
        0.10,  -- 10% performance fee
        0.0075 -- 0.75% platform fee
    );
    
    -- Get remaining requests
    v_remaining := public.get_remaining_backtest_requests(p_email);
    
    -- Return success with IDs for polling
    RETURN json_build_object(
        'success', true,
        'request_id', v_request_id,
        'bt_run_id', v_bt_run_id,
        'remaining', v_remaining,
        'message', 'Back-test queued successfully'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Internal error: ' || SQLERRM
        );
END;
$$;

-- Function to get back-test results (for polling)
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
                'final_roi_pct', MAX(roi_pct),
                'btc_balance', MAX(btc_balance),
                'usdt_balance', MAX(usdt_balance)
            )
            FROM lth_pvr_bt.bt_results_daily
            WHERE bt_run_id = br.bt_run_id
        ),
        'std_dca_summary', (
            SELECT json_build_object(
                'final_nav', MAX(nav_total),
                'final_roi_pct', MAX(roi_pct),
                'btc_balance', MAX(btc_balance),
                'usdt_balance', MAX(usdt_balance)
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

COMMENT ON TABLE public.backtest_requests IS 'Public back-test requests for lead capture and rate limiting';
COMMENT ON FUNCTION public.run_public_backtest IS 'Submit public back-test request with email gating and rate limiting (10 per day)';
COMMENT ON FUNCTION public.get_backtest_results IS 'Get back-test results by request ID for polling';
