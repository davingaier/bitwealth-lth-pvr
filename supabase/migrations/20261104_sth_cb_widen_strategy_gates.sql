-- 20261104_sth_cb_widen_strategy_gates.sql
-- ===========================================================================
-- STH_CB live pipeline (part 2): every SQL gate that said "LTH_PVR customers only" now admits STH_CB too.
--
--   • lth_pvr.enforce_lth_pvr_customer()  — trigger on 21 lth_pvr tables (balances_daily, decisions_daily,
--     order_intents, ledger_lines, …). Without this change a STH_CB customer could not have a single balance row.
--   • lth_pvr.ensure_hwm_initialised / _all — performance-fee HWM seeding (strategy-agnostic apart from the gate).
--   • public.*fee* RPCs (set_customer_fee_plan, update_customer_fee_rates, get_customer_fee_rates[_asof],
--     apply_pending_fee_plans, fn_write_fee_history) — Admin UI fee maintenance.
--
-- Deliberately NOT widened: lth_pvr.admin_release_bear_pause / admin_rearm_bear_pause (LTH_PVR-specific state),
-- ef_generate_decisions (LTH_PVR decisions only; STH_CB has ef_sth_cb_generate_decisions).
--
-- Mechanics: rewrite each function body in place via regexp_replace on pg_get_functiondef(), so the rest of every
-- definition stays byte-identical. The audit query at the bottom lists any literal 'LTH_PVR' left behind.
-- ===========================================================================

DO $do$
DECLARE
  r   record;
  def text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('lth_pvr', 'public')
      AND p.prokind = 'f'
      AND p.prosrc ~* 'strategy_code\s*=\s*''LTH_PVR'''
      AND p.proname IN (
        'enforce_lth_pvr_customer', 'ensure_hwm_initialised', 'ensure_hwm_initialised_all',
        'apply_pending_fee_plans', 'get_customer_fee_rates', 'get_customer_fee_rates_asof',
        'set_customer_fee_plan', 'update_customer_fee_rates', 'fn_write_fee_history'
      )
  LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, '(\m(?:\w+\.)?strategy_code)\s*=\s*''LTH_PVR''', '\1 IN (''LTH_PVR'',''STH_CB'')', 'g');
    EXECUTE def;
  END LOOP;
END
$do$;

-- fn_write_fee_history hard-coded the strategy code in its INSERT; use the customer's actual strategy.
CREATE OR REPLACE FUNCTION public.fn_write_fee_history(p_customer_id bigint, p_effective_from date, p_created_by text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cs public.customer_strategies%ROWTYPE;
BEGIN
  SELECT * INTO cs FROM public.customer_strategies
   WHERE customer_id=p_customer_id AND strategy_code IN ('LTH_PVR','STH_CB') LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.customer_fee_plan_history
     SET effective_to = p_effective_from - 1
   WHERE customer_id=p_customer_id AND strategy_code=cs.strategy_code AND effective_to IS NULL
     AND effective_from < p_effective_from;
  INSERT INTO public.customer_fee_plan_history(
    org_id, customer_id, strategy_code, fee_plan,
    platform_fee_rate, platform_fee_schedule, management_fee_rate, management_fee_schedule,
    performance_fee_rate, performance_fee_schedule, effective_from, effective_to, created_by, note)
  VALUES(cs.org_id, p_customer_id, cs.strategy_code, cs.fee_plan,
    cs.platform_fee_rate, cs.platform_fee_schedule, cs.management_fee_rate, cs.management_fee_schedule,
    cs.performance_fee_rate, cs.performance_fee_schedule, p_effective_from, NULL, p_created_by, p_note)
  ON CONFLICT DO NOTHING;
END;
$function$;

-- Trigger message no longer claims LTH_PVR-only.
CREATE OR REPLACE FUNCTION lth_pvr.enforce_lth_pvr_customer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.customer_strategies cs
     WHERE cs.customer_id   = NEW.customer_id
       AND cs.org_id        = NEW.org_id
       AND cs.strategy_code IN ('LTH_PVR', 'STH_CB')
  ) THEN
    RAISE EXCEPTION
      '%.% may only contain rows for customers with an LTH_PVR or STH_CB strategy (customer_id=%, org_id=%)',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, NEW.customer_id, NEW.org_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- Audit (run manually): remaining literal gates
-- SELECT n.nspname||'.'||p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--  WHERE n.nspname IN ('lth_pvr','public') AND p.prosrc ~* 'strategy_code\s*=\s*''LTH_PVR''';
