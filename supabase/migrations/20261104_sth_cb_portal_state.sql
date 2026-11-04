-- 20261104_sth_cb_portal_state.sql
-- ===========================================================================
-- Client portal: strategy name + STH Cost Basis state for a customer's portfolio card.
--
--   • public.list_customer_portfolios() — strategy_name now comes from public.strategies.name
--     ("STH Cost Basis Strategy") instead of strategy_code || ' Strategy'.
--   • public.get_customer_strategy_state(p_customer_id) — SECURITY DEFINER; caller must be the customer
--     (auth.email() = customer_details.email) or an org member (my_orgs()). Returns the strategy, joining rule,
--     the strategy's current signal (in market / in cash + target allocation — no thresholds), the customer's own
--     allocation and their most recent decision. Nothing proprietary is exposed.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.list_customer_portfolios(p_customer_id bigint)
 RETURNS TABLE(portfolio_id uuid, strategy_code text, strategy_name text, status text, nav_usd numeric, btc_balance numeric, usdt_balance numeric, usdpc_balance numeric, usdpc_price_usd numeric, usdpc_value_usd numeric, btc_price numeric, total_contributions numeric, has_trading_history boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
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
      select 1 from lth_pvr.decisions_daily dd
      where dd.customer_id = p_customer_id limit 1
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
    select cb.btc_price
    from lth_pvr.ci_bands_daily cb
    where cb.date <= current_date
    order by cb.date desc limit 1
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

CREATE OR REPLACE FUNCTION public.get_customer_strategy_state(p_customer_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'lth_pvr', 'sth_cb'
AS $function$
DECLARE
  v_cust   record;
  v_cs     record;
  v_sig    record;
  v_bal    record;
  v_dec    record;
  v_alloc  numeric;
BEGIN
  SELECT customer_id, org_id, email INTO v_cust FROM public.customer_details WHERE customer_id = p_customer_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Customer not found'); END IF;

  -- Caller must be this customer (portal) or a member of the customer's org (admin).
  IF NOT (
    lower(coalesce(auth.email(), '')) = lower(coalesce(v_cust.email, '!'))
    OR v_cust.org_id IN (SELECT id FROM public.my_orgs())
    OR current_setting('request.jwt.claim.role', true) = 'service_role'
  ) THEN
    RETURN jsonb_build_object('error', 'Not authorised');
  END IF;

  SELECT cs.strategy_code, s.name AS strategy_name, cs.status, cs.live_enabled, cs.join_policy, cs.config_key, cs.usdpc_enabled
    INTO v_cs
  FROM public.customer_strategies cs
  LEFT JOIN public.strategies s ON s.strategy_code = cs.strategy_code
  WHERE cs.customer_id = p_customer_id AND cs.status NOT IN ('closed', 'terminated')
  ORDER BY cs.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('strategy_code', NULL); END IF;

  SELECT btc_balance, usdt_balance, usdpc_balance, usdpc_price_usd, nav_usd, date
    INTO v_bal
  FROM lth_pvr.balances_daily
  WHERE org_id = v_cust.org_id AND customer_id = p_customer_id
  ORDER BY date DESC LIMIT 1;
  IF v_bal.nav_usd IS NOT NULL AND v_bal.nav_usd > 0 THEN
    v_alloc := round(greatest(0, least(1,
      (v_bal.nav_usd - coalesce(v_bal.usdt_balance, 0) - coalesce(v_bal.usdpc_balance, 0) * coalesce(v_bal.usdpc_price_usd, 1)) / v_bal.nav_usd)), 4);
  END IF;

  SELECT trade_date, action, amount_pct, rule, note
    INTO v_dec
  FROM lth_pvr.decisions_daily
  WHERE org_id = v_cust.org_id AND customer_id = p_customer_id
  ORDER BY trade_date DESC LIMIT 1;

  IF v_cs.strategy_code = 'STH_CB' THEN
    SELECT date, position_state, signal_in_market,
           coalesce(signal_target_alloc, CASE WHEN signal_in_market THEN 1 ELSE 0 END) AS signal_target_alloc
      INTO v_sig
    FROM sth_cb.tracker_daily
    WHERE org_id = v_cust.org_id AND tracker_key = coalesce(v_cs.config_key, 'hybrid_v2_2')
    ORDER BY date DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'strategy_code',  v_cs.strategy_code,
    'strategy_name',  coalesce(v_cs.strategy_name, v_cs.strategy_code),
    'status',         v_cs.status,
    'live_enabled',   v_cs.live_enabled,
    'join_policy',    v_cs.join_policy,
    'usdpc_enabled',  v_cs.usdpc_enabled,
    'customer_alloc', v_alloc,
    'balance_date',   v_bal.date,
    'signal', CASE WHEN v_sig.date IS NULL THEN NULL ELSE jsonb_build_object(
        'date', v_sig.date, 'in_market', v_sig.signal_in_market, 'target_alloc', v_sig.signal_target_alloc,
        'state', CASE WHEN NOT v_sig.signal_in_market THEN 'cash'
                      WHEN v_sig.signal_target_alloc >= 0.999 THEN 'fully_invested'
                      ELSE 'scaling_out' END) END,
    'last_decision', CASE WHEN v_dec.trade_date IS NULL THEN NULL ELSE jsonb_build_object(
        'trade_date', v_dec.trade_date, 'action', v_dec.action, 'amount_pct', v_dec.amount_pct, 'rule', v_dec.rule) END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_strategy_state(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_strategy_state(bigint) TO authenticated, service_role;
