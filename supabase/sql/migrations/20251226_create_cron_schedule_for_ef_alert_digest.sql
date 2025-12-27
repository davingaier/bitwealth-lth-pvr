-- Make sure pg_net exists
create extension if not exists pg_net with schema extensions;

-- Drop old job if needed (idempotent)
select cron.unschedule('lth_pvr_alert_digest_daily')
where exists (
  select 1
  from cron.job
  where jobname = 'lth_pvr_alert_digest_daily'
);

-- Schedule ef_alert_digest daily at 05:00 UTC (07:00 SAST)
select
  cron.schedule(
    'lth_pvr_alert_digest_daily',
    '0 5 * * *',        -- 05:00 UTC = 07:00 SAST
    $$
    select net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_alert_digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxbm14cG9vYWJtZWR2dGFja2ppIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMzU1NTM4NiwiZXhwIjoyMDE5MTMxMzg2fQ.yUMfDe9GSL1o5jG-9EHPl0P1yT0LdqsOHPqTpyJilLY'
      ),
      body := jsonb_build_object(
        'org_id', 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'::uuid
      )
    );
    $$
  );
