-- ============================================================================
-- Fee-Plan Choice — Phase 1: fee RPCs + effective-dated plan resolution
-- Date: 2026-07-11
--
-- - get_customer_fee_rates      : now also returns fee_plan + management_* fields
-- - update_customer_fee_rates   : consolidated (rates/schedules/mgmt), writes a
--                                 customer_fee_plan_history row (effective today)
-- - set_customer_fee_plan       : switches plan effective FIRST OF NEXT MONTH
-- - get_customer_fee_rates_asof : resolves the in-force config for a given date
--                                 (used by fee-calc / statement generators)
-- - apply_pending_fee_plans     : monthly job that flips customer_strategies.fee_plan
--                                 to the row in force today (run at month start)
-- - fn_write_fee_history        : internal helper (append open history row)
--
-- Grants are applied via a DO-block over resolved regprocedure signatures.
-- ============================================================================

DROP FUNCTION IF EXISTS public.update_customer_fee_rates(bigint, numeric, numeric);
DROP FUNCTION IF EXISTS public.update_customer_fee_rates(bigint, numeric, numeric, text, text);
DROP FUNCTION IF EXISTS public.get_customer_fee_rates(bigint[]);

CREATE OR REPLACE FUNCTION public.get_customer_fee_rates(p_customer_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(customer_id bigint, performance_fee_rate numeric, performance_fee_percentage numeric,
   platform_fee_rate numeric, platform_fee_percentage numeric,
   performance_fee_schedule text, platform_fee_schedule text,
   fee_plan text, management_fee_rate numeric, management_fee_percentage numeric, management_fee_schedule text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT cs.customer_id,
    COALESCE(cs.performance_fee_rate, 0.10),
    COALESCE(cs.performance_fee_rate, 0.10) * 100,
    COALESCE(cs.platform_fee_rate, 0.0075),
    COALESCE(cs.platform_fee_rate, 0.0075) * 100,
    COALESCE(cs.performance_fee_schedule, 'monthly')::text,
    COALESCE(cs.platform_fee_schedule, 'immediate')::text,
    COALESCE(cs.fee_plan, 'platform')::text,
    COALESCE(cs.management_fee_rate, 0.01),
    COALESCE(cs.management_fee_rate, 0.01) * 100,
    COALESCE(cs.management_fee_schedule, 'monthly')::text
  FROM public.customer_strategies cs
  WHERE cs.strategy_code = 'LTH_PVR'
    AND (p_customer_ids IS NULL OR array_length(p_customer_ids,1) IS NULL OR cs.customer_id = ANY(p_customer_ids))
    AND (p_customer_ids IS NOT NULL OR cs.status = 'active')
  ORDER BY cs.customer_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_write_fee_history(p_customer_id bigint, p_effective_from date, p_created_by text, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cs public.customer_strategies%ROWTYPE;
BEGIN
  SELECT * INTO cs FROM public.customer_strategies
   WHERE customer_id=p_customer_id AND strategy_code='LTH_PVR' LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.customer_fee_plan_history
     SET effective_to = p_effective_from - 1
   WHERE customer_id=p_customer_id AND strategy_code='LTH_PVR' AND effective_to IS NULL
     AND effective_from < p_effective_from;
  INSERT INTO public.customer_fee_plan_history(
    org_id, customer_id, strategy_code, fee_plan,
    platform_fee_rate, platform_fee_schedule, management_fee_rate, management_fee_schedule,
    performance_fee_rate, performance_fee_schedule, effective_from, effective_to, created_by, note)
  VALUES(cs.org_id, p_customer_id, 'LTH_PVR', cs.fee_plan,
    cs.platform_fee_rate, cs.platform_fee_schedule, cs.management_fee_rate, cs.management_fee_schedule,
    cs.performance_fee_rate, cs.performance_fee_schedule, p_effective_from, NULL, p_created_by, p_note)
  ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_customer_fee_rates(
  p_customer_id bigint,
  p_performance_fee_rate numeric DEFAULT NULL,
  p_platform_fee_rate numeric DEFAULT NULL,
  p_performance_fee_schedule text DEFAULT NULL,
  p_platform_fee_schedule text DEFAULT NULL,
  p_management_fee_rate numeric DEFAULT NULL,
  p_management_fee_schedule text DEFAULT NULL,
  p_created_by text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','lth_pvr'
AS $function$
DECLARE v_org uuid; v_found boolean;
BEGIN
  IF p_performance_fee_rate IS NOT NULL AND (p_performance_fee_rate<0 OR p_performance_fee_rate>1) THEN
    RETURN jsonb_build_object('success',false,'error','Performance fee rate must be between 0 and 1'); END IF;
  IF p_platform_fee_rate IS NOT NULL AND (p_platform_fee_rate<0 OR p_platform_fee_rate>1) THEN
    RETURN jsonb_build_object('success',false,'error','Platform fee rate must be between 0 and 1'); END IF;
  IF p_management_fee_rate IS NOT NULL AND (p_management_fee_rate<0 OR p_management_fee_rate>1) THEN
    RETURN jsonb_build_object('success',false,'error','Management fee rate must be between 0 and 1'); END IF;
  IF p_performance_fee_schedule IS NOT NULL AND p_performance_fee_schedule NOT IN ('monthly','quarterly','annual') THEN
    RETURN jsonb_build_object('success',false,'error','Performance fee schedule invalid'); END IF;
  IF p_platform_fee_schedule IS NOT NULL AND p_platform_fee_schedule NOT IN ('immediate','monthly','quarterly','annual') THEN
    RETURN jsonb_build_object('success',false,'error','Platform fee schedule invalid'); END IF;
  IF p_management_fee_schedule IS NOT NULL AND p_management_fee_schedule NOT IN ('monthly','quarterly','annual') THEN
    RETURN jsonb_build_object('success',false,'error','Management fee schedule invalid'); END IF;

  SELECT org_id INTO v_org FROM public.customer_details WHERE customer_id=p_customer_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Customer not found'); END IF;

  UPDATE public.customer_strategies SET
    performance_fee_rate     = COALESCE(p_performance_fee_rate, performance_fee_rate),
    platform_fee_rate        = COALESCE(p_platform_fee_rate, platform_fee_rate),
    performance_fee_schedule = COALESCE(p_performance_fee_schedule, performance_fee_schedule),
    platform_fee_schedule    = COALESCE(p_platform_fee_schedule, platform_fee_schedule),
    management_fee_rate      = COALESCE(p_management_fee_rate, management_fee_rate),
    management_fee_schedule  = COALESCE(p_management_fee_schedule, management_fee_schedule)
  WHERE customer_id=p_customer_id AND strategy_code='LTH_PVR';
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF NOT v_found THEN RETURN jsonb_build_object('success',false,'error','Customer strategy not found'); END IF;

  PERFORM public.fn_write_fee_history(p_customer_id, CURRENT_DATE, p_created_by, 'Rate/schedule update');
  RETURN jsonb_build_object('success',true,'customer_id',p_customer_id,'message','Fee rates updated');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_customer_fee_plan(
  p_customer_id bigint, p_fee_plan text, p_created_by text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_current text; v_eff date; v_org uuid;
        v_plat numeric; v_plat_s text; v_mgmt numeric; v_mgmt_s text; v_perf numeric; v_perf_s text;
BEGIN
  IF p_fee_plan NOT IN ('platform','management') THEN
    RETURN jsonb_build_object('success',false,'error','fee_plan must be platform or management'); END IF;
  SELECT org_id, fee_plan, platform_fee_rate, platform_fee_schedule, management_fee_rate, management_fee_schedule,
         performance_fee_rate, performance_fee_schedule
    INTO v_org, v_current, v_plat, v_plat_s, v_mgmt, v_mgmt_s, v_perf, v_perf_s
    FROM public.customer_strategies WHERE customer_id=p_customer_id AND strategy_code='LTH_PVR' LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','Customer strategy not found'); END IF;
  IF v_current = p_fee_plan THEN
    RETURN jsonb_build_object('success',true,'no_change',true,'message','Already on '||p_fee_plan||' plan'); END IF;

  v_eff := (date_trunc('month', CURRENT_DATE) + interval '1 month')::date;
  UPDATE public.customer_fee_plan_history SET effective_to = v_eff - 1
   WHERE customer_id=p_customer_id AND strategy_code='LTH_PVR' AND effective_to IS NULL AND effective_from < v_eff;
  INSERT INTO public.customer_fee_plan_history(
    org_id, customer_id, strategy_code, fee_plan, platform_fee_rate, platform_fee_schedule,
    management_fee_rate, management_fee_schedule, performance_fee_rate, performance_fee_schedule,
    effective_from, effective_to, created_by, note)
  VALUES(v_org, p_customer_id, 'LTH_PVR', p_fee_plan, v_plat, v_plat_s, v_mgmt, v_mgmt_s, v_perf, v_perf_s,
    v_eff, NULL, p_created_by, 'Plan switch '||v_current||' -> '||p_fee_plan||' effective '||v_eff);
  RETURN jsonb_build_object('success',true,'customer_id',p_customer_id,'previous_plan',v_current,
    'new_plan',p_fee_plan,'effective_from',v_eff,'message','Plan switch scheduled for '||v_eff);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_fee_rates_asof(p_customer_id bigint, p_as_of date)
 RETURNS TABLE(fee_plan text, platform_fee_rate numeric, platform_fee_schedule text,
   management_fee_rate numeric, management_fee_schedule text,
   performance_fee_rate numeric, performance_fee_schedule text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT h.fee_plan, h.platform_fee_rate, h.platform_fee_schedule, h.management_fee_rate,
         h.management_fee_schedule, h.performance_fee_rate, h.performance_fee_schedule
  FROM public.customer_fee_plan_history h
  WHERE h.customer_id=p_customer_id AND h.strategy_code='LTH_PVR'
    AND h.effective_from <= p_as_of AND (h.effective_to IS NULL OR h.effective_to >= p_as_of)
  ORDER BY h.effective_from DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT cs.fee_plan, cs.platform_fee_rate, cs.platform_fee_schedule, cs.management_fee_rate,
      cs.management_fee_schedule, cs.performance_fee_rate, cs.performance_fee_schedule
    FROM public.customer_strategies cs WHERE cs.customer_id=p_customer_id AND cs.strategy_code='LTH_PVR' LIMIT 1;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_pending_fee_plans()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int := 0;
BEGIN
  UPDATE public.customer_strategies cs
     SET fee_plan = h.fee_plan
  FROM public.customer_fee_plan_history h
  WHERE h.customer_id=cs.customer_id AND h.strategy_code=cs.strategy_code
    AND h.effective_from <= CURRENT_DATE AND (h.effective_to IS NULL OR h.effective_to >= CURRENT_DATE)
    AND cs.fee_plan <> h.fee_plan AND cs.strategy_code='LTH_PVR';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- Grants (resolve exact signatures)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('get_customer_fee_rates','update_customer_fee_rates','set_customer_fee_plan',
       'get_customer_fee_rates_asof','apply_pending_fee_plans')
  LOOP
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||r.sig||' TO authenticated';
  END LOOP;
END $$;
