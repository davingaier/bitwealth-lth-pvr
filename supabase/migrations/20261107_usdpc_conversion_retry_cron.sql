-- 2026-11-07 · Retry pending USDPC→USDT funding conversions through the day
--
-- VALR's USDPC/USDT market is a thin market-maker quote; ef_execute_orders now sells in depth-sized MARKET chunks and
-- leaves the intent `pending` when no acceptable depth exists. Neither existing guard re-drives execution once the
-- day's decisions are written, so this job calls ef_execute_orders every 10 minutes while such an intent is pending.

CREATE OR REPLACE FUNCTION lth_pvr.retry_pending_usdpc_conversions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'lth_pvr', 'public'
AS $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n
    FROM lth_pvr.order_intents
   WHERE trade_date = CURRENT_DATE
     AND status = 'pending'
     AND (reason = 'usdpc_prebuy_convert' OR (pair = 'BTC/USDT' AND side = 'BUY'));
  IF v_n = 0 THEN
    RETURN jsonb_build_object('action', 'none', 'pending', 0);
  END IF;
  PERFORM lth_pvr.call_edge('ef_execute_orders', '{}'::jsonb);
  RETURN jsonb_build_object('action', 'execute_orders', 'pending', v_n);
END $$;

REVOKE EXECUTE ON FUNCTION lth_pvr.retry_pending_usdpc_conversions() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('usdpc_conversion_retry') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'usdpc_conversion_retry');
SELECT cron.schedule('usdpc_conversion_retry', '*/10 3-16 * * *', $$SELECT lth_pvr.retry_pending_usdpc_conversions();$$);
