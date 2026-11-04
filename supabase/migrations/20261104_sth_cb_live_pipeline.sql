-- 20261104_sth_cb_live_pipeline.sql
--
-- STH Cost Basis Strategy (Hybrid v2.2) goes live. The existing money path (lth_pvr.order_intents →
-- ef_execute_orders → ef_poll_orders → ef_post_ledger_and_balances → fee EFs) is strategy-agnostic and keyed on
-- per-customer rows in lth_pvr.decisions_daily, so STH_CB only needs its own decision generator
-- (ef_sth_cb_generate_decisions, chained from ef_sth_cb_tracker) plus the schema below.
--
--   public.customer_strategies.join_policy   'immediate' (default) | 'next_signal'
--       immediate   = a new / newly-funded client adopts the strategy's current state at once: if the strategy is
--                     in the market, all deployable cash is bought on the next pipeline run (Policy A, 2026-11-04).
--       next_signal = cash (earning USDPC yield) is held until the strategy's NEXT allocation increase.
--   public.customer_strategies.config_key    → sth_cb.tracker_config.tracker_key (default 'hybrid_v2_2'); the
--                                               tracker row the customer follows.
--   sth_cb.tracker_daily.signal_target_alloc the engine's target allocation decided at this close (to be executed
--                                               the next day) — the live generator's single source of truth.
--   public.customer_details.preferred_strategy_code  what the prospect asked for on the website.
--   lth_pvr.fn_usdt_available_for_trading    widened to STH_CB (USDPC buying power).
--   lth_pvr.get_pipeline_status              gains an `sth_cb` block (tracker / decisions / live customers).

-- ── 1. customer_strategies ──────────────────────────────────────────────────────
ALTER TABLE public.customer_strategies
  ADD COLUMN IF NOT EXISTS join_policy text NOT NULL DEFAULT 'immediate',
  ADD COLUMN IF NOT EXISTS config_key  text;
ALTER TABLE public.customer_strategies DROP CONSTRAINT IF EXISTS chk_customer_strategies_join_policy;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT chk_customer_strategies_join_policy CHECK (join_policy IN ('immediate', 'next_signal'));
ALTER TABLE public.customer_strategies DROP CONSTRAINT IF EXISTS fk_customer_strategies_sth_cb_config;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT fk_customer_strategies_sth_cb_config
  FOREIGN KEY (org_id, config_key) REFERENCES sth_cb.tracker_config (org_id, tracker_key);
COMMENT ON COLUMN public.customer_strategies.join_policy IS
  'STH_CB: immediate = adopt the strategy''s current state on funding (buy now if it is in the market); next_signal = hold cash until the next allocation increase.';
COMMENT ON COLUMN public.customer_strategies.config_key IS
  'STH_CB: the sth_cb.tracker_config row (tracker_key) whose daily state this customer follows. NULL for other strategies.';

-- Existing STH_CB rows (if any) follow the production config.
UPDATE public.customer_strategies SET config_key = 'hybrid_v2_2' WHERE strategy_code = 'STH_CB' AND config_key IS NULL;

-- ── 2. tracker_daily: tomorrow's target allocation ──────────────────────────────
ALTER TABLE sth_cb.tracker_daily ADD COLUMN IF NOT EXISTS signal_target_alloc numeric;
COMMENT ON COLUMN sth_cb.tracker_daily.signal_target_alloc IS
  'Target BTC allocation (0..1) decided at this close, to be executed on the next trading day. target_alloc is the allocation AFTER today''s execution.';

-- ── 3. prospect strategy preference ─────────────────────────────────────────────
ALTER TABLE public.customer_details ADD COLUMN IF NOT EXISTS preferred_strategy_code text;
ALTER TABLE public.customer_details DROP CONSTRAINT IF EXISTS chk_customer_details_preferred_strategy;
ALTER TABLE public.customer_details
  ADD CONSTRAINT chk_customer_details_preferred_strategy
  CHECK (preferred_strategy_code IS NULL OR preferred_strategy_code IN ('STH_CB', 'LTH_PVR', 'UNDECIDED'));
COMMENT ON COLUMN public.customer_details.preferred_strategy_code IS 'Strategy the prospect selected on the website sign-up form (informational; the admin confirms the actual strategy).';

-- ── 4. Strategy catalogue text (public-safe, no thresholds) ─────────────────────
UPDATE public.strategies
SET name = 'STH Cost Basis Strategy',
    description = 'All-in / all-out BTC strategy driven by price relative to the short-term-holder cost basis, with momentum-gated scale-out into on-chain euphoria and dip re-buys (Hybrid v2.2)'
WHERE strategy_code = 'STH_CB';

-- ── 5. Buying power includes USDPC for STH_CB customers too ─────────────────────
CREATE OR REPLACE FUNCTION lth_pvr.fn_usdt_available_for_trading(p_org uuid, p_customer bigint)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
declare
  v_usdt   numeric := 0;
  v_usdpc  numeric := 0;
  v_price  numeric := 1;
  v_enabled boolean := false;
begin
  select coalesce(b.usdt_balance, 0), coalesce(b.usdpc_balance, 0)
    into v_usdt, v_usdpc
  from lth_pvr.balances_daily b
  where b.org_id = p_org and b.customer_id = p_customer
  order by b.date desc
  limit 1;

  select coalesce(cs.usdpc_enabled, false)
    into v_enabled
  from public.customer_strategies cs
  where cs.org_id = p_org
    and cs.customer_id = p_customer
    and cs.strategy_code in ('LTH_PVR', 'STH_CB')
  order by cs.effective_from desc nulls last
  limit 1;

  if not coalesce(v_enabled, false) or coalesce(v_usdpc, 0) <= 0 then
    return coalesce(v_usdt, 0);
  end if;

  select price_usd into v_price
  from lth_pvr.usdpc_prices_daily
  order by date desc
  limit 1;
  v_price := coalesce(v_price, 1);

  return coalesce(v_usdt, 0) + coalesce(v_usdpc, 0) * v_price;
end;
$function$;

-- ── 6. Pipeline status: STH_CB block ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lth_pvr.get_pipeline_status(p_trade_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_trade_date     date;
  v_signal_date    date;
  v_current_date   date;
  v_org_id         uuid := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  v_bands_exists   boolean;
  v_window_valid   boolean;
  v_window_closes  timestamp;
  v_decisions_done boolean;
  v_intents_done   boolean;
  v_orders_done    boolean;
  v_orders_polling boolean;
  v_ledger_done    boolean;
  v_can_resume     boolean;
  v_resume_reason  text;
  v_no_viable_trades boolean := false;
  v_intents_attempted_ok boolean;
  -- STH_CB
  v_scb_live        integer;
  v_scb_tracker     boolean;
  v_scb_decisions   boolean;
  v_scb_intents     boolean;
  v_scb_signal      jsonb;
BEGIN
  v_trade_date    := COALESCE(p_trade_date, (now() AT TIME ZONE 'UTC')::date);
  v_signal_date   := v_trade_date - INTERVAL '1 day';
  v_current_date  := (now() AT TIME ZONE 'UTC')::date;
  v_window_closes := (v_trade_date + INTERVAL '1 day')::timestamp;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.rb_bands_daily
    WHERE date = v_signal_date AND mode = 'static' AND org_id = v_org_id
  ) INTO v_bands_exists;

  v_window_valid := v_current_date <= (v_signal_date + INTERVAL '1 day')::date;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.decisions_daily
    WHERE trade_date = v_trade_date AND org_id = v_org_id
      AND COALESCE(band_source, 'rb') <> 'sth_cb'
  ) INTO v_decisions_done;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.order_intents
    WHERE trade_date = v_trade_date AND org_id = v_org_id
  ) INTO v_intents_done;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.exchange_orders
    WHERE submitted_at::date = v_trade_date AND org_id = v_org_id
  ) INTO v_orders_done;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.exchange_orders
    WHERE submitted_at::date = v_trade_date
      AND org_id = v_org_id
      AND status != 'error'
  ) INTO v_orders_polling;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.ledger_lines
    WHERE trade_date = v_trade_date
      AND org_id = v_org_id
      AND kind IN ('buy', 'sell')
  ) INTO v_ledger_done;

  IF v_decisions_done AND NOT v_intents_done THEN
    SELECT (
      EXISTS (
        SELECT 1 FROM public.alert_events
        WHERE component = 'ef_create_order_intents'
          AND created_at >= (v_trade_date::timestamp AT TIME ZONE 'UTC')
          AND created_at <  ((v_trade_date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
          AND severity IN ('info', 'warn')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.alert_events
        WHERE component = 'ef_create_order_intents'
          AND created_at >= (v_trade_date::timestamp AT TIME ZONE 'UTC')
          AND created_at <  ((v_trade_date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
          AND severity IN ('error', 'critical')
      )
    ) INTO v_intents_attempted_ok;

    IF v_intents_attempted_ok THEN
      v_no_viable_trades := true;
      v_intents_done   := true;
      v_orders_done    := true;
      v_orders_polling := true;
      v_ledger_done    := true;
    END IF;
  END IF;

  v_can_resume := v_bands_exists AND v_window_valid AND NOT v_ledger_done;

  IF v_no_viable_trades THEN
    v_resume_reason := 'Pipeline complete – no viable trades today (all positions below minimum)';
  ELSIF NOT v_bands_exists THEN
    v_resume_reason := format('RB bands for %s not yet available', v_signal_date);
  ELSIF NOT v_window_valid THEN
    v_resume_reason := format('Trade window expired (current date: %s, window closed: %s)',
                              v_current_date, v_window_closes);
  ELSIF v_ledger_done THEN
    v_resume_reason := 'Pipeline fully complete (ledger posted)';
  ELSE
    v_resume_reason := 'Pipeline ready to resume';
  END IF;

  -- ── STH_CB block (independent of the LTH resume logic) ──
  SELECT count(*) INTO v_scb_live
  FROM public.customer_strategies cs
  JOIN public.customer_details cd ON cd.customer_id = cs.customer_id
  WHERE cs.org_id = v_org_id AND cs.strategy_code = 'STH_CB' AND cs.live_enabled = true
    AND cs.status = 'active' AND cd.registration_status = 'active';

  SELECT EXISTS (
    SELECT 1 FROM sth_cb.tracker_daily
    WHERE org_id = v_org_id AND tracker_key = 'hybrid_v2_2' AND date = v_signal_date
  ) INTO v_scb_tracker;

  SELECT jsonb_build_object(
           'date', t.date, 'position_state', t.position_state, 'signal_in_market', t.signal_in_market,
           'signal_target_alloc', t.signal_target_alloc, 'signal_rule', t.signal_rule, 'price_usd', t.price_usd)
  INTO v_scb_signal
  FROM sth_cb.tracker_daily t
  WHERE t.org_id = v_org_id AND t.tracker_key = 'hybrid_v2_2'
  ORDER BY t.date DESC LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.decisions_daily
    WHERE trade_date = v_trade_date AND org_id = v_org_id AND band_source = 'sth_cb'
  ) INTO v_scb_decisions;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.order_intents oi
    JOIN lth_pvr.decisions_daily d ON d.org_id = oi.org_id AND d.customer_id = oi.customer_id AND d.trade_date = oi.trade_date
    WHERE oi.trade_date = v_trade_date AND oi.org_id = v_org_id AND d.band_source = 'sth_cb' AND d.action IN ('BUY', 'SELL')
  ) INTO v_scb_intents;

  RETURN jsonb_build_object(
    'trade_date',         v_trade_date,
    'signal_date',        v_signal_date,
    'current_date',       v_current_date,
    'window_closes',      v_window_closes,
    'ci_bands_available', v_bands_exists,
    'rb_bands_available', v_bands_exists,
    'band_source',        'rb',
    'window_valid',       v_window_valid,
    'can_resume',         v_can_resume,
    'resume_reason',      v_resume_reason,
    'steps', jsonb_build_object(
      'ci_bands',    v_bands_exists,
      'rb_bands',    v_bands_exists,
      'decisions',   v_decisions_done,
      'intents',     v_intents_done,
      'orders',      v_orders_done,
      'poll_orders', v_orders_polling,
      'ledger',      v_ledger_done
    ),
    'sth_cb', jsonb_build_object(
      'live_customers', v_scb_live,
      'tracker_ready',  v_scb_tracker,
      'decisions',      v_scb_decisions,
      'intents',        v_scb_intents,
      'can_run',        v_scb_tracker AND v_window_valid AND v_scb_live > 0,
      'signal',         v_scb_signal
    )
  );
END;
$function$;
