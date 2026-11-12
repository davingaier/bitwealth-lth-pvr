-- 20261112_advisor_hardening_phase3.sql
-- Supabase security-advisor follow-up after incident #2 (61 errors / 300 warnings). What it fixes:
--   A. anon had full table privileges on several public tables (wallet_config = our withdrawal/fee destination
--      addresses, ai_agent_config, alert_triage_*, customer_fee_plan_history) and SELECT on 17 SECURITY DEFINER
--      views exposing customer performance / KYC-completeness / balances. → anon loses every table/view/sequence
--      privilege in the app schemas (the public website only uses edge functions + 6 allow-listed RPCs), including
--      for future objects (default privileges), and EXECUTE on the remaining anon-callable SECURITY DEFINER functions.
--   B. 22 tables had RLS disabled while readable (some writable) by browser roles — lth_pvr.rb_api_token (Research
--      Bitcoin token) was readable by any logged-in customer. → RLS on everywhere; admins keep full access via an
--      is_any_org_admin() policy; rb_api_token gets no browser policy at all.
--   C. 38 views ran with SECURITY DEFINER semantics (owner privileges), so any logged-in customer could read every
--      customer's decisions, fills, portfolios through lth_pvr.v_* and anon could even UPDATE/DELETE through the
--      lth_pvr.exchange_accounts view. → views switched to security_invoker; their base tables get an additive
--      admin_read_all policy so the Admin UI keeps working; service_role / pg_cron / SECURITY DEFINER functions bypass
--      RLS and are unaffected.
--   D. SECURITY DEFINER functions without a pinned search_path → pinned to "<own schema>, public, extensions".
-- Everything is data-driven so it also covers objects added since the advisor run.

begin;

-- ───────────────────────────── A. anon ─────────────────────────────
do $$
declare s text;
begin
  foreach s in array array['public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','fic']
  loop
    if exists (select 1 from pg_namespace where nspname = s) then
      execute format('revoke all on all tables in schema %I from anon', s);
      execute format('revoke all on all sequences in schema %I from anon', s);
      execute format('alter default privileges for role postgres in schema %I revoke all on tables from anon', s);
      execute format('alter default privileges for role postgres in schema %I revoke all on sequences from anon', s);
      execute format('alter default privileges for role postgres in schema %I revoke execute on functions from anon', s);
    end if;
  end loop;
end $$;

do $$
declare r record;
        allow_anon text[] := array['public.get_marketing_chart','public.get_lth_pvr_marketing_chart',
                                   'public.get_backtest_results','public.get_sth_cb_backtest_results',
                                   'lth_pvr.forecast_lth_pvr_option4','lth_pvr.request_lth_pvr_historical_annual_results'];
begin
  for r in select n.nspname, p.proname, p.oid::regprocedure as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','fic')
             and has_function_privilege('anon', p.oid, 'execute')
  loop
    if (r.nspname || '.' || r.proname) = any(allow_anon) then continue; end if;
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;

-- ───────────────────────────── B. RLS-off tables ─────────────────────────────
do $$
declare r record;
begin
  for r in select n.nspname, c.relname
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind = 'r' and not c.relrowsecurity
             and n.nspname in ('public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','fic')
  loop
    execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
    if r.nspname = 'lth_pvr' and r.relname = 'rb_api_token' then
      execute 'revoke all on lth_pvr.rb_api_token from anon, authenticated';   -- token: service/cron only
    else
      execute format('create policy admin_all on %I.%I for all to authenticated using (public.is_any_org_admin()) with check (public.is_any_org_admin())',
                     r.nspname, r.relname);
    end if;
  end loop;
end $$;

-- ───────────────────────────── C. views → security_invoker ─────────────────────────────
-- C1. additive admin read policy on every RLS table that sits under a definer view and has no admin policy yet
do $$
declare r record;
begin
  for r in
    with v as (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.relkind = 'v' and n.nspname in ('public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','fic')
                 and coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'),'false') <> 'true')
    select distinct bn.nspname, bc.relname, bc.oid
    from v join pg_rewrite rw on rw.ev_class = v.oid
           join pg_depend d on d.objid = rw.oid and d.classid = 'pg_rewrite'::regclass
           join pg_class bc on bc.oid = d.refobjid join pg_namespace bn on bn.oid = bc.relnamespace
    where bc.relkind = 'r' and bc.oid <> v.oid
  loop
    if not exists (select 1 from pg_policy p where p.polrelid = r.oid and pg_get_expr(p.polqual, r.oid) ilike '%is_any_org_admin%') then
      execute format('create policy admin_read_all on %I.%I for select to authenticated using (public.is_any_org_admin())', r.nspname, r.relname);
    end if;
    if not has_table_privilege('authenticated', r.oid, 'select') then
      execute format('grant select on %I.%I to authenticated', r.nspname, r.relname);
    end if;
  end loop;
end $$;

-- C2. flip the views
do $$
declare r record;
begin
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where c.relkind = 'v' and n.nspname in ('public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','fic')
             and coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'),'false') <> 'true'
  loop
    execute format('alter view %I.%I set (security_invoker = true)', r.nspname, r.relname);
  end loop;
end $$;

-- ───────────────────────────── D. search_path on SECURITY DEFINER functions ─────────────────────────────
do $$
declare r record;
begin
  for r in select n.nspname, p.oid::regprocedure as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prosecdef and p.prokind = 'f'
             and n.nspname in ('public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','fic','private')
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = %I, public, extensions', r.sig, r.nspname);
  end loop;
end $$;

-- D2. pin search_path on the remaining (non-definer) functions too — same superset, removes the hijack surface for
--     trigger functions and helpers executed by privileged roles.
do $$
declare r record;
begin
  for r in select n.nspname, p.oid::regprocedure as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where p.prokind = 'f'
             and n.nspname in ('public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','fic','private')
             and pg_get_userbyid(p.proowner) = 'postgres'        -- skip extension-owned helpers (http extension)
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = %I, public, extensions', r.sig, r.nspname);
  end loop;
end $$;

-- ───────────────────────────── E. unconditional RLS policies ─────────────────────────────
-- 42 policies granted to `authenticated` with USING/WITH CHECK = true let any logged-in customer read and modify
-- lth_pvr.settings (ef_base_url!), alert_events, exchange_daily_balances, real_exchange_txs, strategies, … The
-- advisor does not flag these ("a policy exists"). Tighten every one of them to org admins; service_role, pg_cron and
-- SECURITY DEFINER functions are unaffected.
do $$
declare r record; q text;
begin
  for r in
    select n.nspname, c.relname, p.polname, p.polcmd
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','lth_pvr','sth_cb','lth_pvr_bt','sth_cb_bt','fic')
      and 'authenticated' in (select rolname from pg_roles where oid = any(p.polroles))
      and coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') in ('true','(true)')
      and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'true') in ('true','(true)')
  loop
    q := format('alter policy %I on %I.%I', r.polname, r.nspname, r.relname);
    if r.polcmd = 'a' then
      execute q || ' with check (public.is_any_org_admin())';
    elsif r.polcmd in ('r','d') then
      execute q || ' using (public.is_any_org_admin())';
    else
      execute q || ' using (public.is_any_org_admin()) with check (public.is_any_org_admin())';
    end if;
  end loop;
end $$;

commit;
