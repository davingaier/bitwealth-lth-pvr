-- 20261113_usdpc_sweep_hourly_cron.sql
-- The USDPC sweep only ran as the tail of the LTH PVR pipeline (~00:20Z and the 03:00Z resume guard). On
-- 2026-11-13 the USDPC market maker was absent at 03:00Z, every sweep chunk was rejected ("outside slippage price
-- band") and nothing retried; customer 49's 113k USDT from the trend-exit sell arrived at 05:1xZ, after the last
-- sweep, and sat un-swept all day. Run the sweep hourly with its own execute → poll → post_ledger chain
-- (`{"chain":true}`). ef_sweep_usdt_to_usdpc skips customers with a pending BTC buy / funding conversion and STH_CB
-- customers whose decision for today does not exist yet, so an hourly cadence cannot front-run a buy.
select cron.unschedule(jobid) from cron.job where jobname = 'usdpc_sweep_hourly';
select cron.schedule('usdpc_sweep_hourly', '35 * * * *',
  $$select lth_pvr.call_edge('ef_sweep_usdt_to_usdpc', '{"chain": true}'::jsonb);$$);
