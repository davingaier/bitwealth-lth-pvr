-- 20261112_regrant_browser_rpcs.sql
-- 20261112_incident_get_secret_lockdown revoked EXECUTE from PUBLIC on unguarded SECURITY DEFINER functions. Four of
-- them had only ever been reachable through the implicit PUBLIC grant and are called from a browser, so the portal
-- (Admin Preview of customer 49) got 403s on get_withdrawable_balance / get_customer_performance_data. Re-grant them
-- to authenticated; the guard migration that follows (tools/audit_rpc_guards.py) adds the identity checks.
begin;
grant execute on function lth_pvr.get_withdrawable_balance(bigint)                to authenticated, service_role;
grant execute on function lth_pvr.get_customer_performance_data(bigint, uuid)     to authenticated, service_role;
grant execute on function lth_pvr.get_annual_fee_accruals(integer)                to authenticated, service_role;
grant execute on function sth_cb.get_customer_pipeline_status(uuid, date)         to authenticated, service_role;
commit;
