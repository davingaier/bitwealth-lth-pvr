-- 20261105_security_ops.sql
-- ===========================================================================
-- Post-incident operational security (2026-11-05):
--   1. Real-time delivery of critical security alerts (trigger → ef_alert_digest {immediate:true}) instead of the
--      next-morning digest.
--   2. Quarterly key-rotation reminder (pg_cron → alert_events) so rotation is scheduled, not remembered.
--   3. Advisor cleanup (safe subset): trigger functions can never be meaningfully invoked via PostgREST, so revoke
--      EXECUTE from anon/authenticated on every trigger function (33 functions across public/lth_pvr/sth_cb/app).
-- ===========================================================================

-- 1. real-time security alerts ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.alert_events_notify_security()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','lth_pvr' AS $$
BEGIN
  IF NEW.severity = 'critical'
     AND NEW.component IN ('withdrawal_request','valr_credential_access','valr_sign','withdrawal_guard','security_rotation')
  THEN
    -- fire-and-forget; call_edge logs to lth_pvr.invoker_logs and never raises on HTTP errors
    BEGIN
      PERFORM lth_pvr.call_edge('ef_alert_digest', jsonb_build_object('immediate', true, 'alert_id', NEW.alert_id));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'alert_events_notify_security: % ', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.alert_events_notify_security() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_alert_events_notify_security ON public.alert_events;
CREATE TRIGGER trg_alert_events_notify_security
  AFTER INSERT ON public.alert_events
  FOR EACH ROW EXECUTE FUNCTION public.alert_events_notify_security();

-- 2. quarterly rotation reminder (1 Feb / 1 May / 1 Aug / 1 Nov, 06:00 UTC) ------------------------
SELECT cron.unschedule('security_rotation_reminder') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='security_rotation_reminder');
SELECT cron.schedule(
  'security_rotation_reminder',
  '0 6 1 2,5,8,11 *',
  $job$
    INSERT INTO public.alert_events(component, severity, org_id, message, context)
    VALUES ('security_rotation', 'error',
            (SELECT val::uuid FROM lth_pvr.settings WHERE key='org_id'),
            'Quarterly credential rotation due: Supabase secret keys (vault + Edge Function secrets), VALR master/withdraw keys, Resend, SMTP. See docs/SECURITY_RUNBOOK.md §Rotation.',
            jsonb_build_object('runbook', 'docs/SECURITY_RUNBOOK.md', 'last_incident', '2026-11-05'));
  $job$
);

-- 3. advisor cleanup: trigger functions must not be callable through PostgREST -----------------------
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace JOIN pg_type t ON t.oid = p.prorettype
    WHERE t.typname = 'trigger' AND ns.nspname IN ('public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','app','private')
      AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'revoked anon/authenticated EXECUTE on % trigger functions', n;
END $$;
