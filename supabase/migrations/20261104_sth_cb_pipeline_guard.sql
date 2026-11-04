-- 20261104_sth_cb_pipeline_guard.sql
-- ===========================================================================
-- STH CB pipeline guard (mirrors lth_pvr.ensure_rb_bands_today): every 30 minutes 03:00–16:00 UTC, if there are live
-- STH CB clients and today's decisions do not exist yet:
--   • tracker row for yesterday missing  → re-run ef_fetch_onchain_pvr (which chains tracker → decisions → orders)
--   • tracker ready                      → run ef_sth_cb_generate_decisions directly
-- Each action is logged in sth_cb.pipeline_guard_log.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS sth_cb.pipeline_guard_log (
  id         bigserial PRIMARY KEY,
  run_at     timestamptz NOT NULL DEFAULT now(),
  trade_date date        NOT NULL,
  action     text        NOT NULL,
  detail     jsonb
);
GRANT ALL ON sth_cb.pipeline_guard_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE sth_cb.pipeline_guard_log_id_seq TO service_role;

CREATE OR REPLACE FUNCTION sth_cb.ensure_pipeline_today()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'sth_cb', 'lth_pvr', 'public'
AS $$
DECLARE
  v_org    uuid := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  v        jsonb;
  v_action text := 'none';
BEGIN
  v := sth_cb.get_pipeline_status(v_org, NULL);
  IF COALESCE((v->>'live_customers')::int, 0) = 0 THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'no live STH CB clients');
  END IF;
  IF COALESCE((v->'steps'->>'decisions')::boolean, false) THEN
    RETURN jsonb_build_object('action', 'none', 'reason', 'decisions already written');
  END IF;
  IF NOT COALESCE((v->'steps'->>'tracker')::boolean, false) THEN
    PERFORM lth_pvr.call_edge('ef_fetch_onchain_pvr', '{}'::jsonb);
    v_action := 'fetch_onchain';
  ELSIF COALESCE((v->>'can_run')::boolean, false) THEN
    PERFORM lth_pvr.call_edge('ef_sth_cb_generate_decisions', '{}'::jsonb);
    v_action := 'generate_decisions';
  END IF;
  IF v_action <> 'none' THEN
    INSERT INTO sth_cb.pipeline_guard_log (trade_date, action, detail) VALUES ((v->>'trade_date')::date, v_action, v);
  END IF;
  RETURN jsonb_build_object('action', v_action, 'reason', v->>'reason');
END $$;

SELECT cron.unschedule('sth_cb_pipeline_guard') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sth_cb_pipeline_guard');
SELECT cron.schedule('sth_cb_pipeline_guard', '*/30 3-16 * * *', $$SELECT sth_cb.ensure_pipeline_today();$$);
