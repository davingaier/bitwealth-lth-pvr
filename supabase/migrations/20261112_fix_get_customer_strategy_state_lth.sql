-- 20261112_fix_get_customer_strategy_state_lth.sql
-- Pre-existing bug: for LTH_PVR customers the function never assigned v_sig, and plpgsql raised 55000
-- ('record v_sig is not assigned yet') when the RETURN tested v_sig.date. Found while regression-testing the phase-3
-- hardening with customer 54; unrelated to the security changes.
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

  SELECT btc_balance, usdt_balance, usdpc_balance, usdpc_price_usd, nav_usd, date INTO v_bal
  FROM lth_pvr.balances_daily WHERE org_id = v_cust.org_id AND customer_id = p_customer_id ORDER BY date DESC LIMIT 1;
  IF v_bal.nav_usd IS NOT NULL AND v_bal.nav_usd > 0 THEN
    v_alloc := round(greatest(0, least(1,
      (v_bal.nav_usd - coalesce(v_bal.usdt_balance, 0) - coalesce(v_bal.usdpc_balance, 0) * coalesce(v_bal.usdpc_price_usd, 1)) / v_bal.nav_usd)), 4);
  END IF;

  IF v_cs.strategy_code = 'STH_CB' THEN
    SELECT trade_date, action, amount_pct, rule, note INTO v_dec
    FROM sth_cb.decisions_daily WHERE org_id = v_cust.org_id AND customer_id = p_customer_id ORDER BY trade_date DESC LIMIT 1;
    SELECT date, position_state, signal_in_market,
           coalesce(signal_target_alloc, CASE WHEN signal_in_market THEN 1 ELSE 0 END) AS signal_target_alloc
      INTO v_sig
    FROM sth_cb.tracker_daily
    WHERE org_id = v_cust.org_id AND tracker_key = coalesce(v_cs.config_key, 'hybrid_v2_2')
    ORDER BY date DESC LIMIT 1;
  ELSE
    -- LTH_PVR has no tracker signal: give v_sig a typed, all-NULL shape so the RETURN can test v_sig.date
    SELECT null::date AS date, null::text AS position_state, null::boolean AS signal_in_market, null::numeric AS signal_target_alloc INTO v_sig;
    SELECT trade_date, action, amount_pct, rule, note INTO v_dec
    FROM lth_pvr.decisions_daily WHERE org_id = v_cust.org_id AND customer_id = p_customer_id ORDER BY trade_date DESC LIMIT 1;
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
$function$
;
