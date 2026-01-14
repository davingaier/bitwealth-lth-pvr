-- Diagnostic query to check why back-test is timing out
-- Run this in Supabase SQL Editor

-- 1. Check recent back-test requests and their status
SELECT 
    br.id AS request_id,
    br.email,
    br.created_at,
    br.status AS request_status,
    br.error_message,
    br.bt_run_id,
    bt.status AS bt_run_status,
    bt.created_at AS bt_created_at,
    bt.updated_at AS bt_updated_at,
    EXTRACT(EPOCH FROM (NOW() - br.created_at))/60 AS minutes_since_request
FROM public.backtest_requests br
LEFT JOIN lth_pvr_bt.bt_runs bt ON br.bt_run_id = bt.id
WHERE br.created_at > NOW() - INTERVAL '1 hour'
ORDER BY br.created_at DESC
LIMIT 10;

-- 2. Check if edge function logs show any errors
-- (This would be in Supabase Dashboard > Edge Functions > ef_bt_execute > Logs)

-- 3. Check if there are any stuck "pending" or "running" back-tests
SELECT 
    id,
    org_id,
    run_label,
    status,
    created_at,
    updated_at,
    EXTRACT(EPOCH FROM (NOW() - created_at))/60 AS minutes_running
FROM lth_pvr_bt.bt_runs
WHERE status IN ('pending', 'running')
    AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- 4. Check if CI bands data is available for the date range
SELECT 
    trade_date,
    price_at_m100,
    price_at_p100
FROM lth_pvr.ci_bands_daily
WHERE trade_date BETWEEN '2020-01-01' AND '2025-12-31'
ORDER BY trade_date DESC
LIMIT 5;

-- 5. If a specific request is stuck, you can manually update it:
-- UPDATE public.backtest_requests 
-- SET status = 'failed', error_message = 'Manual timeout recovery'
-- WHERE id = 'YOUR_REQUEST_UUID_HERE';
