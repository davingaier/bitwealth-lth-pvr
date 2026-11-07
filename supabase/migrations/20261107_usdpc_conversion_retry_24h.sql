-- 2026-11-07 · USDPC conversion retry: run around the clock and poll orders outside the normal polling hours
--
-- Davin: keep retrying customer 49's remaining 57k USDPC past 16:00 UTC until it is all converted. The retry function
-- is a no-op when nothing is pending, so a 24 h schedule costs nothing. The six lth_poll_orders_* jobs only run
-- 03–16 UTC, so outside those hours this job also calls ef_poll_orders when there are open exchange orders — otherwise a
-- maker LIMIT placed by an evening fill would sit without its 5-minute MARKET fallback and its fill would not be
-- booked until the morning.

CREATE OR REPLACE FUNCTION lth_pvr.retry_pending_usdpc_conversions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'lth_pvr', 'public'
AS $$
DECLARE
  v_n     int;
  v_open  int;
  v_hour  int := extract(hour FROM now() AT TIME ZONE 'UTC')::int;
  v_acts  text[] := '{}';
BEGIN
  SELECT count(*) INTO v_n
    FROM lth_pvr.order_intents
   WHERE trade_date >= CURRENT_DATE - 1
     AND status = 'pending'
     AND (reason = 'usdpc_prebuy_convert' OR (pair = 'USDPC/USDT' AND side = 'SELL') OR (pair = 'BTC/USDT' AND side = 'BUY'));
  IF v_n > 0 THEN
    PERFORM lth_pvr.call_edge('ef_execute_orders', '{}'::jsonb);
    v_acts := array_append(v_acts, 'execute_orders');
  END IF;

  -- Outside the lth_poll_orders_* hours (03–16 UTC) take over polling while anything is open.
  IF v_hour < 3 OR v_hour > 16 THEN
    SELECT count(*) INTO v_open FROM lth_pvr.exchange_orders WHERE status = 'submitted';
    IF v_open > 0 THEN
      PERFORM lth_pvr.call_edge('ef_poll_orders', '{}'::jsonb);
      v_acts := array_append(v_acts, 'poll_orders');
    END IF;
  END IF;

  RETURN jsonb_build_object('actions', to_jsonb(v_acts), 'pending_intents', v_n, 'utc_hour', v_hour);
END $$;

REVOKE EXECUTE ON FUNCTION lth_pvr.retry_pending_usdpc_conversions() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('usdpc_conversion_retry') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'usdpc_conversion_retry');
-- every 10 minutes, every hour (was */10 3-16)
SELECT cron.schedule('usdpc_conversion_retry', '*/10 * * * *', $$SELECT lth_pvr.retry_pending_usdpc_conversions();$$);
