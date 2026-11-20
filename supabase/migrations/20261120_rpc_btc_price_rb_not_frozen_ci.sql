-- 2026-11-20: list_customer_portfolios (portal portfolio card) and list_accumulated_fees (Admin fees panel)
-- still read the BTC price from lth_pvr.ci_bands_daily, frozen at 77,031 since the 2026-05-19 CI->RB
-- migration. Switch both to rb_bands_daily (the live source). Applied via MCP apply_migration
-- "rpc_btc_price_rb_not_frozen_ci"; this file mirrors it for the repo.
--
-- Remaining ci_bands_daily readers are intentional: get_bands_chart_series__core(p_source='ci') (historical
-- chart), forecast_lth_pvr_option4 / get_withdrawable_balance (RB first, CI only as fallback), the CI freeze
-- guard / upsert / ensure_* legacy plumbing, and run_public_backtest (historical back-test data).

CREATE OR REPLACE FUNCTION public.list_customer_portfolios(p_customer_id bigint)
 RETURNS TABLE(portfolio_id uuid, strategy_code text, strategy_name text, status text, nav_usd numeric, btc_balance numeric, usdt_balance numeric, usdpc_balance numeric, usdpc_price_usd numeric, usdpc_value_usd numeric, btc_price numeric, total_contributions numeric, has_trading_history boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  PERFORM public.assert_customer_access(p_customer_id::bigint);
  return query
  select
    cs.portfolio_id,
    cs.strategy_code,
    coalesce(s.name, cs.strategy_code || ' Strategy')::text as strategy_name,
    cs.status,
    coalesce(latest_balance.nav_usd, 0) as nav_usd,
    coalesce(latest_balance.btc_balance, 0) as btc_balance,
    coalesce(latest_balance.usdt_balance, 0) as usdt_balance,
    coalesce(latest_balance.usdpc_balance, 0) as usdpc_balance,
    latest_balance.usdpc_price_usd as usdpc_price_usd,
    (coalesce(latest_balance.usdpc_balance, 0) * coalesce(latest_balance.usdpc_price_usd, 1)) as usdpc_value_usd,
    coalesce(latest_price.btc_price, 0) as btc_price,
    coalesce(contrib.net_usdt, 0) as total_contributions,
    exists(
      select 1 from lth_pvr.decisions_daily dd where dd.customer_id = p_customer_id
      union all select 1 from sth_cb.decisions_daily sd where sd.customer_id = p_customer_id limit 1
    ) as has_trading_history,
    cs.created_at
  from public.customer_strategies cs
  left join public.strategies s on s.strategy_code = cs.strategy_code
  left join lateral (
    select bd.btc_balance, bd.usdt_balance, bd.usdpc_balance, bd.usdpc_price_usd, bd.nav_usd
    from lth_pvr.balances_daily bd
    where bd.customer_id = p_customer_id and bd.date <= current_date
    order by bd.date desc limit 1
  ) latest_balance on true
  left join lateral (
    select rb.btc_price
    from lth_pvr.rb_bands_daily rb
    where rb.date <= current_date and rb.btc_price is not null
    order by rb.date desc limit 1
  ) latest_price on true
  left join lateral (
    select
      coalesce(sum(case when kind = 'topup'      then amount_usdt else 0 end), 0)
      + coalesce(sum(case when kind = 'withdrawal' then amount_usdt else 0 end), 0) as net_usdt
    from lth_pvr.ledger_lines
    where customer_id = p_customer_id
  ) contrib on true
  where cs.customer_id = p_customer_id
  order by cs.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_accumulated_fees(p_org_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(customer_id bigint, customer_name text, email text, accumulated_btc numeric, accumulated_usdt numeric, accumulated_zar numeric, total_usd numeric, last_updated_at timestamp with time zone, last_transfer_attempt_at timestamp with time zone, transfer_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_org_id UUID;
  v_btc_price NUMERIC(38,2);
BEGIN
  PERFORM public.assert_org_admin();
  v_org_id := COALESCE(p_org_id, (SELECT id FROM public.organizations LIMIT 1));
  SELECT rb.btc_price INTO v_btc_price FROM lth_pvr.rb_bands_daily rb WHERE rb.btc_price IS NOT NULL ORDER BY rb.date DESC LIMIT 1;
  IF v_btc_price IS NULL THEN v_btc_price := 100000; END IF;

  RETURN QUERY
  SELECT caf.customer_id, cd.first_names || ' ' || cd.last_name, cd.email,
    caf.accumulated_btc, caf.accumulated_usdt, caf.accumulated_zar,
    (caf.accumulated_btc * v_btc_price) + caf.accumulated_usdt + (caf.accumulated_zar / 18.5),
    caf.last_updated_at, caf.last_transfer_attempt_at, caf.transfer_count
  FROM lth_pvr.customer_accumulated_fees caf
  JOIN public.customer_details cd ON caf.customer_id = cd.customer_id
  WHERE caf.org_id = v_org_id AND (caf.accumulated_btc > 0 OR caf.accumulated_usdt > 0 OR caf.accumulated_zar > 0)
  ORDER BY total_usd DESC;
END;
$function$;
