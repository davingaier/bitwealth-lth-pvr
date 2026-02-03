-- Fix ef_sync_valr_transactions pg_cron job
-- Issue: Job has been failing with "unrecognized configuration parameter app.settings.service_role_key"
-- Solution: Use vault.decrypted_secrets instead

-- Drop existing job
SELECT cron.unschedule(43);

-- Recreate with correct vault secret reference
SELECT cron.schedule(
  'sync-valr-transactions-every-30-min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_sync_valr_transactions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := jsonb_build_object()
  ) AS request_id;
  $$
);
