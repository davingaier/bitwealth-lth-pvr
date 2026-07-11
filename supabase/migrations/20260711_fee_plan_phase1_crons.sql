-- ============================================================================
-- Fee-Plan Choice — Phase 1: cron jobs
-- Date: 2026-07-11
--   apply_pending_fee_plans_monthly : 00:01 on the 1st — flips
--       customer_strategies.fee_plan to the row now in force (plan switches
--       take effect at the start of the next calendar month).
--   monthly-management-fees         : 00:07 on the 1st — charges/accrues the
--       management fee for the previous month (after performance fees at 00:05).
-- Auth uses the vault 'service_jwt' secret (same pattern as monthly-performance-fees).
-- ============================================================================

SELECT cron.unschedule('apply_pending_fee_plans_monthly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='apply_pending_fee_plans_monthly');
SELECT cron.unschedule('monthly-management-fees')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='monthly-management-fees');

SELECT cron.schedule('apply_pending_fee_plans_monthly', '1 0 1 * *',
  $$SELECT public.apply_pending_fee_plans();$$);

SELECT cron.schedule('monthly-management-fees', '7 0 1 * *', $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_calculate_management_fees',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_jwt' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
  $$);
