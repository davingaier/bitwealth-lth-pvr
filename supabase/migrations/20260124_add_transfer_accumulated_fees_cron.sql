-- Migration: Add pg_cron job for monthly accumulated fees transfer
-- Created: 2026-01-24
-- Purpose: Schedule ef_transfer_accumulated_fees to run on 1st of month at 02:00 UTC
--          (BEFORE ef_fee_monthly_close at 03:00 UTC so invoices reflect transferred fees)

-- Add monthly transfer job (1st of month at 02:00 UTC)
SELECT cron.schedule(
  'transfer-accumulated-fees',               -- Job name
  '0 2 1 * *',                               -- Cron expression: minute hour day month weekday
  $$
  SELECT
    net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_transfer_accumulated_fees',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := jsonb_build_object(
        'org_id', 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
      )
    ) AS request_id;
  $$
);

-- Verify job was created
SELECT * FROM cron.job WHERE jobname = 'transfer-accumulated-fees';

-- Note: This job runs BEFORE ef_fee_monthly_close (03:00 UTC) to ensure
--       monthly invoices reflect transferred platform fees.
-- 
-- Cron expression breakdown:
--   0 2 1 * *
--   | | | | |
--   | | | | +-- Day of week (any)
--   | | | +---- Month (any)
--   | | +------ Day of month (1st)
--   | +-------- Hour (02:00 UTC)
--   +---------- Minute (00)
-- 
-- Schedule: 1st of every month at 02:00 UTC
-- Execution order:
--   02:00 UTC - ef_transfer_accumulated_fees (monthly batch transfer)
--   03:00 UTC - ef_fee_monthly_close (generate invoices)
