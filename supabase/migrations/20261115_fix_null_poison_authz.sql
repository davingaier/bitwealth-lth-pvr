-- 20261115_fix_null_poison_authz.sql
-- See header note: NULL-poisoned service_role guard let any authenticated user bypass authorization.
begin;
create or replace function public.jwt_is_service_role()
returns boolean language sql stable set search_path = public as $jsr$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
                  nullif(current_setting('request.jwt.claim.role', true), ''), '') = 'service_role';
$jsr$;
revoke execute on function public.jwt_is_service_role() from public, anon;
grant execute on function public.jwt_is_service_role() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.switch_customer_strategy(p_customer_id bigint, p_to_strategy_code text, p_options jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'lth_pvr', 'sth_cb'
AS $function$
DECLARE
  v_cs        public.customer_strategies%ROWTYPE;
  v_cust      record;
  v_to        record;
  v_from_name text;
  v_bal       record;
  v_by        text := COALESCE(auth.email(), current_setting('request.jwt.claim.role', true), 'system');
  v_new_label text;
  v_cfg_key   text;
  v_join      text;
  v_var_id    uuid;
  v_usdpc     boolean;
  v_sig       record;
  v_next      text;
BEGIN
  SELECT customer_id, org_id, display_name, first_names, last_name, registration_status INTO v_cust
  FROM public.customer_details WHERE customer_id = p_customer_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Customer not found'); END IF;

  IF NOT COALESCE(v_cust.org_id IN (SELECT id FROM public.my_orgs() WHERE role IN ('owner','admin','editor'))
          OR public.jwt_is_service_role(), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorised');
  END IF;

  SELECT * INTO v_to FROM public.strategies WHERE strategy_code = p_to_strategy_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', format('Unknown strategy %s', p_to_strategy_code)); END IF;
  IF p_to_strategy_code NOT IN ('LTH_PVR','STH_CB') THEN
    RETURN jsonb_build_object('ok', false, 'error', format('%s has no live pipeline; only LTH_PVR and STH_CB can be switched to', p_to_strategy_code));
  END IF;

  SELECT * INTO v_cs FROM public.customer_strategies
  WHERE customer_id = p_customer_id AND org_id = v_cust.org_id AND status IN ('active','pending','suspended')
  ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Customer has no open strategy row to switch'); END IF;
  IF v_cs.strategy_code = p_to_strategy_code THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Customer is already on %s', p_to_strategy_code));
  END IF;

  SELECT name INTO v_from_name FROM public.strategies WHERE strategy_code = v_cs.strategy_code;

  IF p_to_strategy_code = 'STH_CB' THEN
    v_cfg_key := COALESCE(NULLIF(p_options->>'config_key',''), 'hybrid_v2_2');
    v_join    := COALESCE(NULLIF(p_options->>'join_policy',''), 'immediate');
    IF v_join NOT IN ('immediate','next_signal') THEN RETURN jsonb_build_object('ok', false, 'error', 'join_policy must be immediate or next_signal'); END IF;
    IF NOT EXISTS (SELECT 1 FROM sth_cb.tracker_config WHERE org_id = v_cust.org_id AND tracker_key = v_cfg_key AND is_active) THEN
      RETURN jsonb_build_object('ok', false, 'error', format('config_key %s is not an active sth_cb.tracker_config row', v_cfg_key));
    END IF;
    v_var_id := NULL;
    v_usdpc  := COALESCE((p_options->>'usdpc_enabled')::boolean, true);
  ELSE
    v_cfg_key := NULL; v_join := 'immediate';
    v_var_id := COALESCE(NULLIF(p_options->>'strategy_variation_id','')::uuid,
                         (SELECT id FROM lth_pvr.strategy_variation_templates WHERE is_production AND is_active ORDER BY sort_order LIMIT 1));
    v_usdpc  := COALESCE((p_options->>'usdpc_enabled')::boolean, v_cs.usdpc_enabled);
  END IF;

  SELECT date, btc_balance, usdt_balance, usdpc_balance, usdpc_price_usd, nav_usd INTO v_bal
  FROM lth_pvr.balances_daily WHERE org_id = v_cust.org_id AND customer_id = p_customer_id ORDER BY date DESC LIMIT 1;

  v_new_label := CASE
    WHEN v_from_name IS NOT NULL AND position(v_from_name IN COALESCE(v_cs.label,'')) > 0 THEN replace(v_cs.label, v_from_name, v_to.name)
    ELSE COALESCE(NULLIF(v_cust.display_name,''), TRIM(COALESCE(v_cust.first_names,'')||' '||COALESCE(v_cust.last_name,''))) || ' - ' || v_to.name
  END;

  INSERT INTO public.customer_strategy_history
    (org_id, customer_id, customer_strategy_id, from_strategy_code, to_strategy_code, from_config, to_config, holdings_snapshot, reason, changed_by)
  VALUES (
    v_cust.org_id, p_customer_id, v_cs.customer_strategy_id, v_cs.strategy_code, p_to_strategy_code,
    jsonb_build_object('label', v_cs.label, 'config_key', v_cs.config_key, 'join_policy', v_cs.join_policy,
                       'strategy_variation_id', v_cs.strategy_variation_id, 'usdpc_enabled', v_cs.usdpc_enabled,
                       'live_enabled', v_cs.live_enabled, 'status', v_cs.status, 'fee_plan', v_cs.fee_plan),
    jsonb_build_object('label', v_new_label, 'config_key', v_cfg_key, 'join_policy', v_join,
                       'strategy_variation_id', v_var_id, 'usdpc_enabled', v_usdpc, 'options', p_options),
    CASE WHEN v_bal.date IS NULL THEN NULL ELSE jsonb_build_object('date', v_bal.date, 'btc', v_bal.btc_balance, 'usdt', v_bal.usdt_balance,
         'usdpc', v_bal.usdpc_balance, 'usdpc_price_usd', v_bal.usdpc_price_usd, 'nav_usd', v_bal.nav_usd) END,
    p_reason, v_by);

  UPDATE public.customer_strategies
     SET strategy_code = p_to_strategy_code,
         label = v_new_label,
         config_key = v_cfg_key,
         join_policy = v_join,
         strategy_variation_id = v_var_id,
         usdpc_enabled = v_usdpc
   WHERE customer_strategy_id = v_cs.customer_strategy_id;

  BEGIN
    PERFORM public.fn_write_fee_history(p_customer_id, CURRENT_DATE, v_by, format('Strategy switch %s → %s', v_cs.strategy_code, p_to_strategy_code));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF p_to_strategy_code = 'STH_CB' THEN
    SELECT signal_in_market, signal_target_alloc, date INTO v_sig FROM sth_cb.tracker_daily
    WHERE org_id = v_cust.org_id AND tracker_key = v_cfg_key ORDER BY date DESC LIMIT 1;
    v_next := CASE
      WHEN v_sig.date IS NULL THEN 'Tracker has no state yet'
      WHEN v_sig.signal_in_market AND v_join = 'immediate' THEN format('Strategy is in the market (target %s%% BTC): all USDT/USDPC will be bought into BTC on the next run (~02:05 UTC)', round(COALESCE(v_sig.signal_target_alloc,1)*100))
      WHEN v_sig.signal_in_market THEN 'Strategy is in the market but join_policy=next_signal: cash is held until the next entry signal'
      ELSE 'Strategy is in cash: any BTC held will be sold on the next run; cash earns USDPC yield'
    END;
  ELSE
    v_next := 'LTH PVR decisions resume at the next 00:10 UTC run (current holdings are adopted as-is)';
  END IF;

  RETURN jsonb_build_object('ok', true, 'customer_id', p_customer_id, 'customer_strategy_id', v_cs.customer_strategy_id,
    'from', v_cs.strategy_code, 'to', p_to_strategy_code, 'label', v_new_label, 'config_key', v_cfg_key, 'join_policy', v_join,
    'usdpc_enabled', v_usdpc, 'holdings', CASE WHEN v_bal.date IS NULL THEN NULL ELSE jsonb_build_object('date', v_bal.date, 'btc', v_bal.btc_balance,
    'usdt', v_bal.usdt_balance, 'usdpc', v_bal.usdpc_balance, 'nav_usd', v_bal.nav_usd) END, 'next', v_next);
END $function$;
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

  IF NOT COALESCE(
    lower(coalesce(auth.email(), '')) = lower(coalesce(v_cust.email, '!'))
    OR v_cust.org_id IN (SELECT id FROM public.my_orgs())
    OR public.jwt_is_service_role()
  , false) THEN
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
$function$;
CREATE OR REPLACE FUNCTION public.sth_cb_pipeline_status(p_org_id uuid, p_trade_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(p_org_id IN (SELECT id FROM public.my_orgs()) OR public.jwt_is_service_role(), false) THEN
    RETURN jsonb_build_object('error', 'Not authorised');
  END IF;
  RETURN sth_cb.get_pipeline_status(p_org_id, p_trade_date);
END $function$;
CREATE OR REPLACE FUNCTION public.sth_cb_customer_pipeline_status(p_org_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(p_org_id IN (SELECT id FROM public.my_orgs()) OR public.jwt_is_service_role(), false) THEN
    RETURN jsonb_build_object('error', 'Not authorised');
  END IF;
  RETURN sth_cb.get_customer_pipeline_status(p_org_id, p_date);
END $function$;
commit;