-- Test get_backtest_results function to see if it's working
-- Run this in Supabase SQL Editor to verify the function

-- First, get a recent request_id
SELECT id, email, status, created_at 
FROM public.backtest_requests 
ORDER BY created_at DESC 
LIMIT 5;

-- Then test the function with one of those IDs (replace with actual UUID)
-- SELECT public.get_backtest_results('YOUR-REQUEST-UUID-HERE');

-- Also check if the function exists and has correct signature
SELECT 
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
    AND p.proname = 'get_backtest_results';
