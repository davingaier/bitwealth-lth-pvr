-- Fix resume pipeline guard to only run during trading hours
-- This prevents duplicate intent creation outside trading window

UPDATE cron.job
SET schedule = '*/30 3-16 * * *',
    command = '
    SELECT net.http_post(
      url := ''https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline'',
      headers := jsonb_build_object(
        ''Content-Type'', ''application/json'',
        ''Authorization'', ''Bearer '' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''service_jwt'')
      ),
      body := jsonb_build_object()
    );
  '
WHERE jobid = 28 AND jobname = 'lth_pvr_resume_pipeline_guard';

-- Verify the change
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobid = 28;
