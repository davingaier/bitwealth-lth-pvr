-- 20260703_consolidate_order_fallback_poll_orders.sql
-- =====================================================================
-- Consolidate the stale-LIMIT -> MARKET fallback onto a SINGLE authority.
--
-- BEFORE: two independent fallback owners ran every minute in the trade
-- window and could both convert the same order in the same instant
-- (poll-orders-1min fires at :00, exactly when lth_market_fallback_00s does):
--   * poll-orders-1min       -> ef_poll_orders     (status + fills + fallback)
--   * lth_market_fallback_*  -> ef_market_fallback (fallback only, x6 @ 10s)
-- That race could place TWO market orders for one buy/sell. ef_market_fallback
-- additionally (a) SKIPPED api-model customers (no subaccount_id) and
-- (b) placed a MARKET order for the FULL order qty, ignoring any partial fill
-- (over-execution risk).
--
-- AFTER: ef_poll_orders is the sole fallback authority. It handles both
-- account models, subtracts already-filled qty (remainingQty), records fills,
-- and now claims each fallback atomically (submitted -> cancelled_for_market
-- via a single conditional UPDATE) so overlapping workers can never
-- double-convert. We keep the 10-second effective cadence with the same
-- pg_sleep-offset trick, now pointed at ef_poll_orders.
--
-- ef_market_fallback remains DEPLOYED but UNSCHEDULED — re-enabling the old
-- crons is the rollback.
-- =====================================================================

-- 1) Retire the six ef_market_fallback offset crons
SELECT cron.unschedule('lth_market_fallback_00s');
SELECT cron.unschedule('lth_market_fallback_10s');
SELECT cron.unschedule('lth_market_fallback_20s');
SELECT cron.unschedule('lth_market_fallback_30s');
SELECT cron.unschedule('lth_market_fallback_40s');
SELECT cron.unschedule('lth_market_fallback_50s');

-- 2) Retire the single-cadence poll cron (replaced by the 6 offset crons below)
SELECT cron.unschedule('poll-orders-1min');

-- 3) Schedule ef_poll_orders at 10s cadence (00,10,20,30,40,50s) 03:00-16:59 UTC.
--    Each invocation is a single fast stateless pass, so running it 6x/min is
--    safe (the old long-running internal 10s loop is gone).
SELECT cron.schedule('lth_poll_orders_00s', '*/1 3-16 * * *', $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('lth_poll_orders_10s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(10);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('lth_poll_orders_20s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(20);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('lth_poll_orders_30s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('lth_poll_orders_40s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(40);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('lth_poll_orders_50s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(50);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
$$);
