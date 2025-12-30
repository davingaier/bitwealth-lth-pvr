-- Migration: Add smart cron jobs to call ef_resume_pipeline after CI bands fetch
-- Created: 2025-12-30
-- Purpose: Automatically resume pipeline when CI bands are available

-- 1. Create cron job to resume pipeline shortly after CI bands fetch (05:05 UTC)
SELECT cron.schedule(
  'lth_pvr_resume_pipeline_morning',
  '5 5 * * *',  -- 05:05 UTC (5 minutes after CI bands fetch at 05:00)
  $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.get_secret('service_jwt')
      ),
      body := jsonb_build_object()
    );
  $$
);

-- 2. Create cron job to check and resume pipeline every 30 minutes (guard/recovery)
-- This catches cases where CI bands are fetched by the 30-min guard job
SELECT cron.schedule(
  'lth_pvr_resume_pipeline_guard',
  '*/30 * * * *',  -- Every 30 minutes (same frequency as CI bands guard)
  $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.get_secret('service_jwt')
      ),
      body := jsonb_build_object()
    );
  $$
);

-- 3. Disable old individual pipeline step cron jobs (now handled by ef_resume_pipeline)
-- Keep them in database but disable them
UPDATE cron.job SET active = false 
WHERE jobname IN (
  'lthpvr_generate_decisions',    -- Job 9
  'lthpvr_create_intents',        -- Job 10
  'lthpvr_execute_orders',        -- Job 11
  'lthpvr_post_ledger'            -- Job 13
);
-- Note: Keep lthpvr_poll_orders (Job 12) active as it runs every 10 minutes for order status updates

COMMENT ON EXTENSION pg_cron IS 
'Pipeline automation strategy:
- CI bands fetched at 05:00 UTC (Job 18) and every 30 min guard (Job 19)
- ef_resume_pipeline called at 05:05 UTC and every 30 min
- ef_resume_pipeline checks pipeline status and only runs needed steps (idempotent)
- Old individual step jobs disabled, now orchestrated via ef_resume_pipeline
- Polling continues every 10 min for order status updates';
