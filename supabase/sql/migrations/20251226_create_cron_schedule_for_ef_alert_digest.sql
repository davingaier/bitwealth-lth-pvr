create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'lth_pvr_alert_digest_daily',
  '0 5 * * *',   -- 05:00 UTC (07:00 SAST if you want, adjust as needed)
$$
select net.http_post(
  url     := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_alert_digest',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxbm14cG9vYWJtZWR2dGFja2ppIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDA1Njc5OSwiZXhwIjoyMDY5NjMyNzk5fQ.lsOEAg7IUkVRLj3IOQOlZS5N_SxiYXoPpufd7OkW_Hw'
  ),
  body    := jsonb_build_object(
    'org_id', 'b0a77009-03b9-4a41-ae1d-34f157d44a8b'::uuid
  )
);
$$
);