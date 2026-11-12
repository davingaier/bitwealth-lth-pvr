r"""
tools/audit_rpc_guards.py — find SECURITY DEFINER functions callable by `authenticated` that perform no identity
check, and (with --apply) guard them.

Incident #2 (2026-11-11) lesson: SECURITY DEFINER + EXECUTE for browser roles + no auth check = any logged-in customer
(or, before the anon revoke, anyone with the public key) can run admin/ops functions. Two guards are injected:

  public.assert_org_admin()                 — caller must be an org admin/owner (service_role / cron / postgres pass)
  public.assert_customer_access(cust_id)    — caller must be that customer (JWT email ↔ customer_details.email, or
                                              app_metadata.customer_id), an org admin, or a service/cron caller
  public.assert_partner()                   — caller must be an active partner user, or an org admin / service caller

plpgsql bodies get `PERFORM <guard>;` after their first BEGIN. SQL-language functions are renamed to <name>__core
(browser EXECUTE revoked) and replaced by a plpgsql wrapper with the identical signature that guards then delegates.

Usage (secrets injected by Infisical):
  .\tools\with-secrets.ps1 python tools\audit_rpc_guards.py            # report only
  .\tools\with-secrets.ps1 python tools\audit_rpc_guards.py --apply    # apply + write supabase/migrations/<date>_guard_authenticated_rpcs.sql
"""
import os, re, sys, datetime
import psycopg

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

AUTH_CHECK_RE = r"auth\.uid\(\)|my_orgs|is_org_admin|is_any_org_admin|auth\.jwt\(\)|auth\.role\(\)|partner_whoami|assert_org_admin|assert_customer_access|assert_partner"

# Functions the public website calls anonymously (and the harmless public-data helpers) — left unguarded.
PUBLIC_OK = {
    "public.get_marketing_chart", "public.get_lth_pvr_marketing_chart", "public.get_backtest_results",
    "public.get_sth_cb_backtest_results", "lth_pvr.forecast_lth_pvr_option4",
    "lth_pvr.request_lth_pvr_historical_annual_results",
}
# Customer-scoped functions: guard = assert_customer_access(<arg>)
CUSTOMER_ARG = {
    "public.get_customer_accrued_fees": "p_customer_id", "public.get_customer_exchange_account": "p_customer_id",
    "public.get_customer_onboarding_status": "p_customer_id", "public.get_customer_trade_start_date": "p_customer_id",
    "public.list_customer_portfolios": "p_customer_id", "public.list_customer_transactions": "p_customer_id",
    "public.regenerate_kyc_signed_url": "p_customer_id", "public.get_customer_fee_rates_asof": "p_customer_id",
    "lth_pvr.get_customer_buy_metrics": "p_customer_id", "lth_pvr.statement_already_generated": "p_customer_id",
    "lth_pvr.get_withdrawable_balance": "p_customer_id", "lth_pvr.get_customer_performance_data": "p_customer_id",
}
PARTNER = {"public.partner_list_withdrawals", "public.partner_list_requests", "public.partner_list_invoices",
           "public.partner_list_audit_log"}

GUARDS_SQL = r"""
create or replace function public.assert_org_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  -- auth.role() is null for pg_cron / direct postgres calls and 'service_role' for edge functions: both pass.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and not public.is_any_org_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.assert_org_admin() from public, anon;

create or replace function public.assert_customer_access(p_customer_id bigint)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_email text; v_app_cid bigint;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then return; end if;   -- service / cron
  if public.is_any_org_admin() then return; end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_app_cid := nullif(auth.jwt() -> 'app_metadata' ->> 'customer_id', '')::bigint;
  -- user_metadata.customer_id is deliberately NOT trusted: a logged-in user can rewrite it.
  if v_app_cid = p_customer_id then return; end if;
  if v_email <> '' and exists (select 1 from public.customer_details cd
                               where cd.customer_id = p_customer_id and lower(cd.email) = v_email) then
    return;
  end if;
  raise exception 'not authorised for customer %', p_customer_id using errcode = '42501';
end $$;
revoke execute on function public.assert_customer_access(bigint) from public, anon;

create or replace function public.assert_partner()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then return; end if;
  if public.is_any_org_admin() then return; end if;
  if exists (select 1 from public.partner_users pu where pu.user_id = auth.uid() and pu.is_active) then return; end if;
  raise exception 'partner privileges required' using errcode = '42501';
end $$;
revoke execute on function public.assert_partner() from public, anon;
"""


def fetch_targets(cur):
    cur.execute(f"""
      select n.nspname, p.proname, p.oid, p.oid::regprocedure::text, l.lanname, p.proretset,
             pg_get_functiondef(p.oid), pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid),
             pg_get_function_result(p.oid), p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
      where p.prosecdef and n.nspname in ('public','lth_pvr','sth_cb')
        and has_function_privilege('authenticated', p.oid, 'execute')
        and p.prosrc !~* %s
        and p.proname not like '%%__core'
      order by n.nspname, p.proname""", (AUTH_CHECK_RE,))
    return cur.fetchall()


def guard_call(fq, identity_args):
    if fq in PUBLIC_OK:
        return None
    if fq in CUSTOMER_ARG:
        arg = CUSTOMER_ARG[fq]
        names = [a.strip().split(" ")[0] for a in identity_args.split(", ") if a.strip()]
        if arg not in names:
            raise RuntimeError(f"{fq}: expected argument {arg} not found in ({identity_args})")
        return f"public.assert_customer_access({arg}::bigint)"
    if fq in PARTNER:
        return "public.assert_partner()"
    return "public.assert_org_admin()"


def plpgsql_patch(definition, guard):
    head, sep, body = definition.partition("AS $function$")
    if not sep:
        raise RuntimeError("unexpected function definition format")
    m = re.search(r"\bBEGIN\b", body, flags=re.IGNORECASE)
    if not m:
        raise RuntimeError("no BEGIN found")
    body = body[: m.end()] + f"\n  PERFORM {guard};" + body[m.end():]
    return head + sep + body


def sql_wrapper(nsp, name, oid, sig, guard, args_with_defaults, identity_args, result, proconfig, retset):
    core = f"{name}__core"
    arg_names = [a.strip().split(" ")[0] for a in identity_args.split(", ") if a.strip()]
    for a in arg_names:
        if not re.match(r"^[a-z_][a-z0-9_]*$", a):
            raise RuntimeError(f"{sig}: unnamed or odd argument '{a}' — guard by hand")
    call = f"{nsp}.{core}({', '.join(arg_names)})"
    cfg = ""
    for c in proconfig or []:
        k, _, v = c.partition("=")
        cfg += f"\n SET {k} TO '{v}'"
    delegate = f"RETURN QUERY SELECT * FROM {call};" if retset else f"RETURN {call};"
    return f"""
ALTER FUNCTION {sig} RENAME TO {core};
REVOKE EXECUTE ON FUNCTION {nsp}.{core}({identity_args}) FROM public, anon, authenticated;
CREATE FUNCTION {nsp}.{name}({args_with_defaults})
 RETURNS {result}
 LANGUAGE plpgsql
 SECURITY DEFINER{cfg}
AS $function$
BEGIN
  PERFORM {guard};
  {delegate}
END
$function$;
REVOKE EXECUTE ON FUNCTION {nsp}.{name}({identity_args}) FROM public, anon;
GRANT EXECUTE ON FUNCTION {nsp}.{name}({identity_args}) TO authenticated, service_role;
"""


def main():
    apply = "--apply" in sys.argv
    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=20) as conn, conn.cursor() as cur:
        rows = fetch_targets(cur)
        print(f"{len(rows)} authenticated-callable SECURITY DEFINER functions without an identity check")
        stmts, report = [GUARDS_SQL], []
        for nsp, name, oid, sig, lang, retset, definition, args_def, identity_args, result, proconfig in rows:
            fq = f"{nsp}.{name}"
            guard = guard_call(fq, identity_args)
            if guard is None:
                report.append(f"  skip   {sig}  (public allow-list)")
                continue
            if lang == "plpgsql":
                stmts.append(plpgsql_patch(definition, guard) + ";")
                report.append(f"  patch  {sig}  -> {guard}")
            elif lang == "sql":
                stmts.append(sql_wrapper(nsp, name, oid, sig, guard, args_def, identity_args, result, proconfig, retset))
                report.append(f"  wrap   {sig}  -> {guard}")
            else:
                report.append(f"  MANUAL {sig}  language {lang}")
        print("\n".join(report))
        if not apply:
            print("\n(dry run — pass --apply to guard them)")
            return
        sql = "-- Generated by tools/audit_rpc_guards.py on " + datetime.date.today().isoformat() + "\n" + \
              "-- Guards every SECURITY DEFINER function callable by `authenticated` that had no identity check.\n" + \
              "begin;\n" + "\n".join(stmts) + "\ncommit;\n"
        base = os.path.join(ROOT, "supabase", "migrations", datetime.date.today().strftime("%Y%m%d") + "_guard_authenticated_rpcs")
        path, n = base + ".sql", 2
        while os.path.exists(path):   # never overwrite an earlier run's migration
            path, n = f"{base}_{n}.sql", n + 1
        with open(path, "w", encoding="utf-8") as f:
            f.write(sql)
        cur.execute(sql)
        conn.commit()
        remaining = fetch_targets(cur)
        print(f"\napplied. migration written to {os.path.relpath(path, ROOT)}; remaining unguarded: {len(remaining)}")
        for r in remaining:
            print("  ", r[3])


if __name__ == "__main__":
    main()
