-- ============================================================================
-- TA_BOT — admin read RPCs for ui/ta-bot.html
-- ta_bot.* is not exposed to PostgREST; the browser reaches it only through these
-- SECURITY DEFINER functions, each guarded by public.is_org_admin(p_org_id).
-- All return a single jsonb value (bypasses the 1000-row PostgREST cap).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ta_bot_assert_admin(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'not an admin of org %', p_org_id USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ta_bot_assert_admin(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- candles
CREATE OR REPLACE FUNCTION public.ta_bot_candles(
  p_org_id uuid, p_exchange text, p_symbol text, p_timeframe text, p_limit int DEFAULT 1500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ta_bot AS $$
BEGIN
  PERFORM public.ta_bot_assert_admin(p_org_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'time', extract(epoch FROM open_time)::bigint,
             'open', open, 'high', high, 'low', low, 'close', close, 'volume', volume)
           ORDER BY open_time)
    FROM (
      SELECT * FROM ta_bot.candles
      WHERE exchange = p_exchange AND symbol = p_symbol AND timeframe = p_timeframe AND confirmed
      ORDER BY open_time DESC LIMIT LEAST(GREATEST(p_limit, 1), 5000)
    ) c), '[]'::jsonb);
END $$;

-- ---------------------------------------------------------------- latest analysis (run + zones + levels)
CREATE OR REPLACE FUNCTION public.ta_bot_latest_analysis(p_org_id uuid, p_exchange text, p_symbol text, p_style text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ta_bot AS $$
DECLARE v_run ta_bot.analysis_runs%ROWTYPE;
BEGIN
  PERFORM public.ta_bot_assert_admin(p_org_id);
  SELECT * INTO v_run FROM ta_bot.analysis_runs
   WHERE exchange = p_exchange AND symbol = p_symbol AND style = p_style AND status = 'ok'
   ORDER BY started_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'run', jsonb_build_object(
      'run_id', v_run.run_id, 'started_at', v_run.started_at, 'finished_at', v_run.finished_at,
      'candles_through', v_run.candles_through, 'timeframes', to_jsonb(v_run.timeframes),
      'tool_codes', to_jsonb(v_run.tool_codes), 'meta', v_run.meta),
    'zones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'zone_id', zone_id, 'price_low', price_low, 'price_high', price_high, 'bias', bias,
        'score', score, 'prob_baseline', prob_baseline, 'prob_final', prob_final,
        'tool_codes', to_jsonb(tool_codes), 'rationale', rationale, 'expires_at', expires_at)
        ORDER BY score DESC)
      FROM ta_bot.confluence_zones WHERE run_id = v_run.run_id), '[]'::jsonb),
    'levels', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'level_id', level_id, 'timeframe', timeframe, 'tool_code', tool_code, 'level_type', level_type,
        'price_low', price_low, 'price_high', price_high, 'strength', strength, 'meta', meta)
        ORDER BY price_low)
      FROM ta_bot.levels WHERE run_id = v_run.run_id), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------- instruments (tracked + search)
CREATE OR REPLACE FUNCTION public.ta_bot_instruments(p_org_id uuid, p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ta_bot AS $$
BEGIN
  PERFORM public.ta_bot_assert_admin(p_org_id);
  RETURN jsonb_build_object(
    'tracked', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('exchange', exchange, 'symbol', symbol, 'tv_symbol', tv_symbol,
                                          'tick_size', tick_size, 'status', status) ORDER BY symbol)
      FROM ta_bot.instruments WHERE tracked), '[]'::jsonb),
    'matches', CASE WHEN p_search IS NULL OR length(p_search) < 2 THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('exchange', exchange, 'symbol', symbol, 'tv_symbol', tv_symbol,
                                          'tracked', tracked, 'status', status) ORDER BY symbol)
      FROM (SELECT * FROM ta_bot.instruments
             WHERE status = 'Trading' AND (symbol ILIKE upper(p_search) || '%' OR tv_symbol ILIKE '%' || p_search || '%')
             ORDER BY symbol LIMIT 30) m), '[]'::jsonb) END);
END $$;

CREATE OR REPLACE FUNCTION public.ta_bot_set_tracked(p_org_id uuid, p_exchange text, p_symbol text, p_tracked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ta_bot AS $$
DECLARE v_n int;
BEGIN
  PERFORM public.ta_bot_assert_admin(p_org_id);
  UPDATE ta_bot.instruments SET tracked = p_tracked, updated_at = now()
   WHERE exchange = p_exchange AND symbol = p_symbol;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_n);
END $$;

-- ---------------------------------------------------------------- worker + tools status
CREATE OR REPLACE FUNCTION public.ta_bot_status(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ta_bot AS $$
BEGIN
  PERFORM public.ta_bot_assert_admin(p_org_id);
  RETURN jsonb_build_object(
    'workers', COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY last_seen_at DESC) FROM ta_bot.worker_heartbeat w), '[]'::jsonb),
    'tools', COALESCE((SELECT jsonb_agg(jsonb_build_object('tool_code', tool_code, 'name', name, 'version', version,
                        'enabled', enabled, 'weight', weight, 'params', params) ORDER BY tool_code) FROM ta_bot.tools), '[]'::jsonb),
    'recent_runs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'style', style, 'status', status,
                        'started_at', started_at, 'zones', (meta->>'zoneCount')::int) ORDER BY started_at DESC)
      FROM (SELECT * FROM ta_bot.analysis_runs ORDER BY started_at DESC LIMIT 20) r), '[]'::jsonb),
    'coverage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('symbol', symbol, 'timeframe', timeframe, 'n', n, 'last_ts', last_ts) ORDER BY symbol, timeframe)
      FROM (SELECT symbol, timeframe, count(*) n, max(open_time) last_ts FROM ta_bot.candles WHERE confirmed GROUP BY 1,2) c), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------- grants
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.ta_bot_candles(uuid,text,text,text,int)',
    'public.ta_bot_latest_analysis(uuid,text,text,text)',
    'public.ta_bot_instruments(uuid,text)',
    'public.ta_bot_set_tracked(uuid,text,text,boolean)',
    'public.ta_bot_status(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
