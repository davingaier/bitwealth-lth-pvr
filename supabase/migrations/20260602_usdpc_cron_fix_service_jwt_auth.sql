-- 20260602_usdpc_cron_fix_service_jwt_auth.sql
-- The two USDPC cron jobs (ef_fetch_usdpc_price_daily @02:30,
-- ef_revalue_usdpc_nav_daily @17:30) were originally scheduled using
-- current_setting('app.settings.service_role_key') for the bearer token. That
-- GUC does not exist on this database, so every cron run failed with
-- "unrecognized configuration parameter" and the price feed silently stopped
-- updating after the manual 2026-05-30 seed (no row for 05-31, 06-01...).
--
-- All other working crons authenticate via vault.decrypted_secrets 'service_jwt'.
-- This migration reschedules both jobs with that pattern.

SELECT cron.schedule(
  'ef_fetch_usdpc_price_daily',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_fetch_usdpc_price',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_jwt')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'ef_revalue_usdpc_nav_daily',
  '30 17 * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_revalue_usdpc_nav',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_jwt')
    ),
    body := '{}'::jsonb
  );
  $$
);
