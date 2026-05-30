-- USDPC yield-stablecoin feature — Phase 2: daily price-feed cron.
--
-- Runs ef_fetch_usdpc_price once per day at 02:30 UTC, BEFORE the CI/RB bands
-- fetch (03:00) and the pipeline resume (05:05), so a fresh USDPC/USDT price is
-- available to value holdings and size pre-buy conversions.
--
-- NOTE: apply this only AFTER ef_fetch_usdpc_price has been deployed, otherwise
-- the scheduled invocation will 404.

SELECT cron.schedule(
  'ef_fetch_usdpc_price_daily',
  '30 2 * * *', -- 02:30 UTC daily
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_fetch_usdpc_price',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
