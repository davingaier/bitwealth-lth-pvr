-- USDPC yield-stablecoin feature — Phase 3c: daily NAV revaluation cron.
--
-- ef_revalue_usdpc_nav marks USDPC-enabled customers to market every day so a
-- long-idle client's NAV reflects USDPC yield / price appreciation even with no
-- trades. Runs at 17:30 UTC, after the 03:00-17:00 trading window closes, so it
-- never races the live pipeline's own balances_daily write.
--
-- NOTE: apply only AFTER ef_revalue_usdpc_nav has been deployed.
-- (The post-sell USDT->USDPC sweep is driven by ef_resume_pipeline, not cron.)

SELECT cron.schedule(
  'ef_revalue_usdpc_nav_daily',
  '30 17 * * *', -- 17:30 UTC daily, after trading window close
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_revalue_usdpc_nav',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
