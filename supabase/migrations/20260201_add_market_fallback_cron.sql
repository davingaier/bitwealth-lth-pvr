-- Add cron jobs for polling-only architecture with MARKET fallback
-- ef_poll_orders: Every 1 minute during trading window (03:15-17:00 UTC)
-- ef_market_fallback: Every 1 minute during trading window (03:15-17:00 UTC)

-- Remove old 10-minute polling job if it exists
SELECT cron.unschedule('poll-orders-10min');

-- Schedule ef_poll_orders to run every 1 minute during trading window
SELECT cron.schedule(
  'poll-orders-1min',
  '*/1 3-16 * * *', -- Every 1 minute from 03:00-16:59 UTC
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Schedule ef_market_fallback to run every 1 minute during trading window
SELECT cron.schedule(
  'market-fallback-1min',
  '*/1 3-16 * * *', -- Every 1 minute from 03:00-16:59 UTC
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_market_fallback',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verify schedules
SELECT * FROM cron.job WHERE jobname IN ('poll-orders-1min', 'market-fallback-1min');
