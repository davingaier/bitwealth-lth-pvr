-- 20261112_incident_get_secret_lockdown.sql
-- Incident 2026-11-11 15:35–16:04Z (Barcelona VPN exit, Python-urllib/3.12):
--   public.get_secret(text) was SECURITY DEFINER + EXECUTE for anon and returned
--   private.app_secrets.service_jwt (the edge-function secret key). With only the
--   public publishable key the attacker obtained the secret key, then read VALR
--   credentials (customers 9/49/56), listed auth users, generated recovery links
--   and logged in as the org owner and as customer 49, signed VALR withdraw
--   requests (rejected — trade-only keys) and attempted an allow-list insert (403).
--   No funds moved; no data was modified. Secret key rotated 2026-11-12 06:4xZ.
--
-- This migration:
--   1. locks get_secret down to service_role;
--   2. revokes EXECUTE from anon/PUBLIC on every SECURITY DEFINER function in
--      public / lth_pvr / sth_cb that performs no identity check, except the
--      handful the public website calls anonymously;
--   3. revokes EXECUTE from authenticated on pure plumbing (cron / pipeline /
--      edge-dispatch helpers) that no browser session should ever invoke.
-- Browser callers are authenticated users (portal / Admin UI); edge functions use
-- the secret key (service_role) and are unaffected.

begin;

revoke execute on function public.get_secret(text) from public, anon, authenticated;

do $$
declare
  r record;
  allow_anon text[] := array[
    'public.get_marketing_chart',
    'public.get_lth_pvr_marketing_chart',
    'public.get_backtest_results',
    'public.get_sth_cb_backtest_results',
    'lth_pvr.forecast_lth_pvr_option4',
    'lth_pvr.request_lth_pvr_historical_annual_results'
  ];
  plumbing text[] := array[
    'lth_pvr.call_edge',
    'lth_pvr.call_edge_function',
    'lth_pvr.upsert_cron',
    'lth_pvr.resume_daily_pipeline',
    'lth_pvr.ensure_ci_bands_today',
    'lth_pvr.ensure_ci_bands_today_with_resume',
    'lth_pvr.ensure_rb_bands_today',
    'lth_pvr.ensure_hwm_initialised',
    'lth_pvr.ensure_hwm_initialised_all',
    'lth_pvr.carry_forward_daily_balances',
    'lth_pvr.upsert_ci_bands',
    'public.lth_pvr_upsert_ci_bands',
    'lth_pvr.accumulate_platform_fee',
    'lth_pvr.accumulate_annual_platform_fee',
    'lth_pvr.accumulate_main_account_btc',
    'lth_pvr.clear_main_account_accumulation',
    'lth_pvr.recompute_hodl_balances',
    'lth_pvr.recompute_std_dca_balances',
    'lth_pvr.reconcile_partner_withdrawals',
    'lth_pvr.raise_alert',
    'lth_pvr.log_parameter_change',
    'lth_pvr._client_historical_annual_payload',
    'lth_pvr._refresh_client_historical_annual_request',
    'public.queue_valr_balance_finalizer',
    'public.run_valr_balance_finalizer',
    'public.apply_pending_fee_plans',
    'public.auto_resolve_stale_alerts',
    'public.claim_next_triage_alert',
    'public.fn_write_fee_history',
    'public.refresh_customer_details_latest',
    'sth_cb.ensure_pipeline_today'
  ];
  fq text;
begin
  for r in
    select n.nspname, p.proname, p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'lth_pvr', 'sth_cb')
      and not (
        p.prosrc ilike '%auth.uid()%' or p.prosrc ilike '%my_orgs%' or
        p.prosrc ilike '%is_org_admin%' or p.prosrc ilike '%is_any_org_admin%' or
        p.prosrc ilike '%auth.jwt()%' or p.prosrc ilike '%auth.role()%'
      )
  loop
    fq := r.nspname || '.' || r.proname;
    if fq = any(allow_anon) then continue; end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
    if fq = any(plumbing) then
      execute format('revoke execute on function %s from authenticated', r.sig);
    end if;
    insert into public.alert_events(component, severity, org_id, message, context)
    values ('security_lockdown', 'info',
            (select org_id from public.org_members limit 1),
            'Revoked anon EXECUTE on ' || r.sig::text,
            jsonb_build_object('function', r.sig::text, 'also_authenticated', fq = any(plumbing), 'migration', '20261112_incident_get_secret_lockdown'));
  end loop;
end $$;

-- Mark the lockdown log rows resolved immediately — they are an audit trail, not open alerts.
update public.alert_events
   set resolved_at = now(), resolved_by = 'migration', resolution_note = 'Audit trail of 20261112 lockdown'
 where component = 'security_lockdown' and resolved_at is null;

commit;
