-- Migration: Add automated balance reconciliation
-- Purpose: Detect manual transfers/deposits/withdrawals by comparing VALR API balances with balances_daily
-- Created: 2026-01-05

-- 1. Create pg_cron job to run balance reconciliation hourly (outside trading window)
-- Schedule: Every hour at :30 minutes past the hour (avoids conflicts with trading pipeline)
SELECT cron.schedule(
  'balance-reconciliation-hourly',
  '30 * * * *', -- Every hour at :30
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_balance_reconciliation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object()
  ) AS request_id;
  $$
);

-- Verify job created
SELECT jobid, schedule, command, nodename, nodeport, database, username, active, jobname
FROM cron.job
WHERE jobname = 'balance-reconciliation-hourly';

-- Notes:
-- 1. Runs hourly at :30 (e.g., 00:30, 01:30, 02:30, etc.)
-- 2. Avoids conflict with trading pipeline (03:00-03:15 UTC)
-- 3. Edge function compares VALR API balances with balances_daily
-- 4. Automatically creates funding events for discrepancies
-- 5. Updates balances_daily to match VALR reality

-- To manually trigger reconciliation:
-- SELECT net.http_post(
--   url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_balance_reconciliation',
--   headers := jsonb_build_object(
--     'Content-Type', 'application/json',
--     'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
--   ),
--   body := jsonb_build_object()
-- ) AS request_id;

-- To disable job:
-- SELECT cron.unschedule('balance-reconciliation-hourly');

-- To check job execution history:
-- SELECT * FROM cron.job_run_details 
-- WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'balance-reconciliation-hourly')
-- ORDER BY start_time DESC 
-- LIMIT 10;
