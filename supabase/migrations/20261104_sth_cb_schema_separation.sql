-- 20261104_sth_cb_schema_separation.sql
-- ===========================================================================
-- STH Cost Basis Strategy — option A schema separation + in-place strategy switching.
--
-- Strategy layer → sth_cb schema:
--   • sth_cb.decisions_daily                       per-customer live decisions (was lth_pvr.decisions_daily band_source='sth_cb')
--   • sth_cb.get_pipeline_status(org, date)        org-level step status for the STH CB chain
--   • sth_cb.get_customer_pipeline_status(org, d)  per-customer rows (decision · intent · execute · settle · convert)
--   • public.sth_cb_pipeline_status / public.sth_cb_customer_pipeline_status  browser wrappers guarded by my_orgs()
-- Shared execution / accounting layer stays in lth_pvr (order_intents, exchange_orders, order_fills, ledger_lines,
-- balances_daily, fees, USDPC) — it is the common engine for every strategy.
--
-- Strategy switching (in place):
--   • public.customer_strategy_history             audit rows (from/to, options, holdings snapshot, who/when/why)
--   • public.switch_customer_strategy(...)         updates the customer's existing customer_strategies row so every
--                                                  FK / exchange account / fee plan is preserved; the new strategy adopts
--                                                  the current holdings on its next run (Policy A)
--
-- Clean-ups: lth_pvr.get_pipeline_status back to LTH-only; public.get_customer_pipeline_status limited to LTH_PVR
-- customers; get_customer_strategy_state / list_customer_portfolios read the new decisions table.
-- ===========================================================================

-- ── 1. sth_cb.decisions_daily ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sth_cb.decisions_daily (
  decision_id         bigserial PRIMARY KEY,
  org_id              uuid        NOT NULL,
  customer_id         bigint      NOT NULL REFERENCES public.customer_details(customer_id) ON DELETE CASCADE,
  config_key          text        NOT NULL,
  signal_date         date        NOT NULL,
  trade_date          date        NOT NULL,
  price_usd           numeric,
  signal_in_market    boolean,
  signal_target_alloc numeric,
  current_alloc       numeric,
  target_alloc        numeric,
  action              text        NOT NULL CHECK (action IN ('BUY','SELL','HOLD')),
  amount_pct          numeric     NOT NULL DEFAULT 0 CHECK (amount_pct >= 0 AND amount_pct <= 1),
  rule                text,
  note                text,
  join_policy         text,
  last_buy_px         numeric,
  btc_balance         numeric,
  cash_usd            numeric,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, customer_id, trade_date)
);
CREATE INDEX IF NOT EXISTS decisions_daily_org_trade_date_idx ON sth_cb.decisions_daily (org_id, trade_date);
ALTER TABLE sth_cb.decisions_daily ENABLE ROW LEVEL SECURITY;   -- no policies: service role only (browser via RPCs)
GRANT ALL ON sth_cb.decisions_daily TO service_role;
GRANT USAGE, SELECT ON SEQUENCE sth_cb.decisions_daily_decision_id_seq TO service_role;
COMMENT ON TABLE sth_cb.decisions_daily IS
  'STH Cost Basis Strategy live decisions, one row per customer per trade_date (HOLD rows included). amount_pct = fraction of cash (BUY) or of BTC (SELL). Sized into lth_pvr.order_intents by ef_create_order_intents.';

CREATE OR REPLACE FUNCTION sth_cb.enforce_sth_cb_customer()
 RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_strategies cs
     WHERE cs.customer_id = NEW.customer_id AND cs.org_id = NEW.org_id AND cs.strategy_code = 'STH_CB'
  ) THEN
    RAISE EXCEPTION 'sth_cb.% may only contain rows for customers on the STH_CB strategy (customer_id=%, org_id=%)',
      TG_TABLE_NAME, NEW.customer_id, NEW.org_id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enforce_sth_cb_customer ON sth_cb.decisions_daily;
CREATE TRIGGER trg_enforce_sth_cb_customer BEFORE INSERT OR UPDATE ON sth_cb.decisions_daily
  FOR EACH ROW EXECUTE FUNCTION sth_cb.enforce_sth_cb_customer();

-- ── 2. Org-level pipeline status (STH CB chain) ─────────────────────────────
CREATE OR REPLACE FUNCTION sth_cb.get_pipeline_status(p_org_id uuid, p_trade_date date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'sth_cb', 'lth_pvr', 'public'
AS $$
DECLARE
  v_trade_date   date := COALESCE(p_trade_date, (now() AT TIME ZONE 'UTC')::date);
  v_signal_date  date;
  v_current_date date := (now() AT TIME ZONE 'UTC')::date;
  v_window_valid boolean;
  v_live         integer;
  v_keys         text[];
  v_tracker      boolean;
  v_onchain      boolean;
  v_decisions    integer;
  v_actionable   integer;
  v_intents      boolean;
  v_orders       boolean;
  v_ledger       boolean;
  v_signal       jsonb;
BEGIN
  v_signal_date  := v_trade_date - 1;
  v_window_valid := v_current_date <= v_trade_date;

  SELECT count(*), COALESCE(array_agg(DISTINCT COALESCE(cs.config_key,'hybrid_v2_2')), ARRAY['hybrid_v2_2'])
    INTO v_live, v_keys
  FROM public.customer_strategies cs
  JOIN public.customer_details cd ON cd.customer_id = cs.customer_id
  WHERE cs.org_id = p_org_id AND cs.strategy_code = 'STH_CB' AND cs.live_enabled AND cs.status = 'active'
    AND cd.registration_status = 'active';

  SELECT EXISTS (SELECT 1 FROM lth_pvr.onchain_pvr_daily WHERE org_id = p_org_id AND date = v_signal_date) INTO v_onchain;
  SELECT bool_and(EXISTS (SELECT 1 FROM sth_cb.tracker_daily t WHERE t.org_id = p_org_id AND t.tracker_key = k AND t.date = v_signal_date))
    INTO v_tracker FROM unnest(v_keys) k;

  SELECT jsonb_build_object('config_key', t.tracker_key, 'date', t.date, 'position_state', t.position_state,
           'signal_in_market', t.signal_in_market, 'signal_target_alloc', t.signal_target_alloc,
           'signal_rule', t.signal_rule, 'signal_note', t.signal_note, 'price_usd', t.price_usd,
           'sth_cost_basis_usd', t.sth_cost_basis_usd, 'price_to_cb_ratio', t.price_to_cb_ratio)
    INTO v_signal
  FROM sth_cb.tracker_daily t
  WHERE t.org_id = p_org_id AND t.tracker_key = v_keys[1]
  ORDER BY t.date DESC LIMIT 1;

  SELECT count(*), count(*) FILTER (WHERE action <> 'HOLD') INTO v_decisions, v_actionable
  FROM sth_cb.decisions_daily WHERE org_id = p_org_id AND trade_date = v_trade_date;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.order_intents oi
    JOIN sth_cb.decisions_daily d ON d.org_id = oi.org_id AND d.customer_id = oi.customer_id AND d.trade_date = oi.trade_date
    WHERE oi.org_id = p_org_id AND oi.trade_date = v_trade_date AND d.action <> 'HOLD' AND oi.pair <> 'USDPC/USDT'
  ) INTO v_intents;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.exchange_orders eo
    JOIN lth_pvr.order_intents oi ON oi.intent_id = eo.intent_id
    JOIN sth_cb.decisions_daily d ON d.org_id = oi.org_id AND d.customer_id = oi.customer_id AND d.trade_date = oi.trade_date
    WHERE eo.org_id = p_org_id AND oi.trade_date = v_trade_date AND eo.pair <> 'USDPC/USDT'
  ) INTO v_orders;

  SELECT EXISTS (
    SELECT 1 FROM lth_pvr.ledger_lines l
    JOIN sth_cb.decisions_daily d ON d.org_id = l.org_id AND d.customer_id = l.customer_id AND d.trade_date = l.trade_date
    WHERE l.org_id = p_org_id AND l.trade_date = v_trade_date AND l.kind IN ('buy','sell')
  ) INTO v_ledger;

  RETURN jsonb_build_object(
    'strategy',        'STH_CB',
    'trade_date',      v_trade_date,
    'signal_date',     v_signal_date,
    'current_date',    v_current_date,
    'window_valid',    v_window_valid,
    'live_customers',  v_live,
    'config_keys',     to_jsonb(v_keys),
    'signal',          v_signal,
    'steps', jsonb_build_object(
      'onchain',   v_onchain,
      'tracker',   COALESCE(v_tracker, false),
      'decisions', v_decisions > 0,
      'intents',   CASE WHEN v_decisions > 0 AND v_actionable = 0 THEN true ELSE v_intents END,
      'orders',    CASE WHEN v_decisions > 0 AND v_actionable = 0 THEN true ELSE v_orders END,
      'ledger',    CASE WHEN v_decisions > 0 AND v_actionable = 0 THEN true ELSE v_ledger END
    ),
    'decisions_count',  v_decisions,
    'actionable_count', v_actionable,
    'can_run',  COALESCE(v_tracker, false) AND v_window_valid AND v_live > 0 AND v_decisions = 0,
    'reason', CASE
      WHEN v_live = 0 THEN 'No live STH CB clients'
      WHEN NOT COALESCE(v_tracker, false) THEN format('Tracker has no row for %s yet (on-chain fetch 02:00 UTC)', v_signal_date)
      WHEN v_decisions > 0 AND v_actionable = 0 THEN 'Complete – all clients on target (HOLD)'
      WHEN v_ledger THEN 'Complete – ledger posted'
      WHEN v_decisions > 0 THEN 'Decisions written – orders in progress'
      WHEN NOT v_window_valid THEN 'Trade window expired'
      ELSE 'Ready to run'
    END
  );
END $$;
GRANT EXECUTE ON FUNCTION sth_cb.get_pipeline_status(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.sth_cb_pipeline_status(p_org_id uuid, p_trade_date date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (p_org_id IN (SELECT id FROM public.my_orgs()) OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RETURN jsonb_build_object('error', 'Not authorised');
  END IF;
  RETURN sth_cb.get_pipeline_status(p_org_id, p_trade_date);
END $$;
REVOKE ALL ON FUNCTION public.sth_cb_pipeline_status(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sth_cb_pipeline_status(uuid, date) TO authenticated, service_role;

-- ── 3. Per-customer pipeline rows (mirror of public.get_customer_pipeline_status) ─────
CREATE OR REPLACE FUNCTION sth_cb.get_customer_pipeline_status(p_org_id uuid, p_date date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'sth_cb', 'lth_pvr', 'public'
AS $$
DECLARE
  v_now         timestamptz := now();
  v_today       date := (v_now AT TIME ZONE 'UTC')::date;
  v_is_today    boolean := (p_date = v_today);
  v_signal_date date := p_date - 1;
  v_minutes     int := EXTRACT(EPOCH FROM ((v_now AT TIME ZONE 'UTC') - p_date::timestamp)) / 60;
  v_trk         record;
  v_dec_n       int;
  v_trk_status  text; v_trk_label text;
  v_dec_status  text; v_dec_label text;
  v_customers   jsonb;
BEGIN
  SELECT t.date, t.computed_at, t.signal_in_market, t.signal_target_alloc, t.signal_rule, t.price_usd
    INTO v_trk
  FROM sth_cb.tracker_daily t
  WHERE t.org_id = p_org_id AND t.tracker_key = 'hybrid_v2_2' AND t.date = v_signal_date
  LIMIT 1;

  IF v_trk.date IS NOT NULL THEN
    v_trk_status := 'complete';
    v_trk_label  := format('Signal %s: %s · %s', to_char(v_signal_date,'YYYY-MM-DD'),
                    CASE WHEN v_trk.signal_in_market THEN format('in market, target %s%% BTC', round(COALESCE(v_trk.signal_target_alloc,1)*100)) ELSE 'in cash' END,
                    COALESCE(v_trk.signal_rule,'Hold'));
  ELSIF v_is_today AND v_minutes < 120 THEN
    v_trk_status := 'not_started'; v_trk_label := 'Scheduled 02:00 UTC (on-chain fetch + tracker)';
  ELSIF v_is_today AND v_minutes < 150 THEN
    v_trk_status := 'in_progress'; v_trk_label := 'Rebuilding tracker…';
  ELSE
    v_trk_status := 'failed'; v_trk_label := 'Tracker row missing for ' || to_char(v_signal_date,'YYYY-MM-DD');
  END IF;

  SELECT count(*) INTO v_dec_n FROM sth_cb.decisions_daily WHERE org_id = p_org_id AND trade_date = p_date;
  IF v_dec_n > 0 THEN
    v_dec_status := 'complete'; v_dec_label := v_dec_n || ' decisions generated';
  ELSIF v_trk_status <> 'complete' THEN
    v_dec_status := 'not_started'; v_dec_label := 'Waiting on tracker';
  ELSIF v_is_today AND v_minutes < 125 THEN
    v_dec_status := 'not_started'; v_dec_label := 'Scheduled ~02:05 UTC';
  ELSIF v_is_today AND v_minutes < 150 THEN
    v_dec_status := 'in_progress'; v_dec_label := 'Generating decisions…';
  ELSE
    v_dec_status := 'failed'; v_dec_label := 'Decisions not generated';
  END IF;

  WITH active_customers AS (
    SELECT cd.customer_id,
           TRIM(COALESCE(cd.first_names,'')||' '||COALESCE(cd.last_name,'')) AS customer_name,
           cd.registration_status, ea.label AS account_label, cs.join_policy, cs.config_key, cs.live_enabled
    FROM public.customer_details cd
    JOIN public.customer_strategies cs ON cs.customer_id = cd.customer_id AND cs.org_id = p_org_id AND cs.status = 'active' AND cs.strategy_code = 'STH_CB'
    LEFT JOIN public.exchange_accounts ea ON ea.exchange_account_id = cs.exchange_account_id AND ea.org_id = p_org_id
    WHERE cd.org_id = p_org_id
  ),
  cust_decision AS (
    SELECT customer_id, action, amount_pct, rule, note, current_alloc, target_alloc
    FROM sth_cb.decisions_daily WHERE org_id = p_org_id AND trade_date = p_date
  ),
  cust_intent AS (
    SELECT DISTINCT ON (customer_id) customer_id, intent_id, status, side, pair, amount, limit_price, created_at, reason
    FROM lth_pvr.order_intents
    WHERE org_id = p_org_id AND trade_date = p_date AND pair <> 'USDPC/USDT'
    ORDER BY customer_id, created_at DESC
  ),
  cust_skip_alert AS (
    SELECT DISTINCT ON ((context->>'customer_id')::bigint) (context->>'customer_id')::bigint AS customer_id, message
    FROM public.alert_events
    WHERE component = 'ef_create_order_intents' AND (context->>'trade_date')::date = p_date AND context ? 'customer_id'
    ORDER BY (context->>'customer_id')::bigint, created_at DESC
  ),
  cust_order AS (
    SELECT DISTINCT ON (oi.customer_id) oi.customer_id, eo.exchange_order_id, eo.status, eo.side, eo.pair, eo.qty, eo.price, eo.submitted_at, eo.updated_at
    FROM lth_pvr.exchange_orders eo JOIN lth_pvr.order_intents oi ON oi.intent_id = eo.intent_id
    WHERE eo.org_id = p_org_id AND oi.trade_date = p_date AND eo.pair <> 'USDPC/USDT'
    ORDER BY oi.customer_id, eo.submitted_at DESC
  ),
  cust_convert AS (
    SELECT oi.customer_id,
           count(DISTINCT oi.intent_id) AS n_intents,
           count(DISTINCT oi.intent_id) FILTER (WHERE oi.status IN ('failed','rejected','cancelled','error')) AS n_failed_intents,
           count(DISTINCT eo.exchange_order_id) FILTER (WHERE upper(coalesce(eo.status,'')) IN ('FILLED','COMPLETED')) AS n_filled_orders,
           count(DISTINCT eo.exchange_order_id) FILTER (WHERE upper(coalesce(eo.status,'')) IN ('CANCELLED','REJECTED','FAILED','ERROR')) AS n_failed_orders,
           bool_or(oi.reason = 'usdpc_prebuy_convert') AS has_prebuy,
           bool_or(oi.reason = 'usdpc_sweep') AS has_sweep,
           max(coalesce(eo.updated_at, eo.submitted_at, oi.created_at)) AS last_at
    FROM lth_pvr.order_intents oi
    LEFT JOIN lth_pvr.exchange_orders eo ON eo.intent_id = oi.intent_id AND eo.org_id = p_org_id
    WHERE oi.org_id = p_org_id AND oi.trade_date = p_date AND oi.pair = 'USDPC/USDT'
    GROUP BY oi.customer_id
  ),
  cust_settle AS (
    SELECT customer_id, bool_or(kind IN ('buy','sell','trade')) AS posted, max(created_at) AS posted_at, sum(amount_btc) AS btc, sum(amount_usdt) AS usdt
    FROM lth_pvr.ledger_lines WHERE org_id = p_org_id AND trade_date = p_date GROUP BY customer_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'customer_id', ac.customer_id,
      'customer_name', ac.customer_name,
      'registration_status', ac.registration_status,
      'account_label', COALESCE(ac.account_label, '') || CASE WHEN ac.live_enabled THEN '' ELSE ' · live disabled' END
                       || CASE WHEN ac.join_policy = 'next_signal' THEN ' · waits for next signal' ELSE '' END,
      'decision', jsonb_build_object(
        'status', CASE WHEN cd.customer_id IS NOT NULL THEN 'complete'
                       WHEN v_dec_status = 'complete' THEN 'na'
                       WHEN v_dec_status = 'failed' THEN 'failed'
                       WHEN v_dec_status = 'in_progress' THEN 'in_progress' ELSE 'not_started' END,
        'action', cd.action,
        'label', CASE
          WHEN cd.action IS NULL AND v_dec_status = 'complete' THEN 'Skipped (not live / inactive)'
          WHEN cd.action IS NULL THEN v_dec_label
          WHEN cd.action = 'HOLD' THEN 'HOLD — ' || COALESCE(cd.rule,'')
          ELSE cd.action || ' ' || round(cd.amount_pct*100,1)::text || '% (' || COALESCE(cd.rule,'') || ')'
        END
      ),
      'intent', CASE
        WHEN cd.action = 'HOLD' THEN jsonb_build_object('status','na','label','No order required (HOLD)')
        WHEN cd.customer_id IS NULL AND v_dec_status = 'complete' THEN jsonb_build_object('status','na','label','—')
        WHEN ci.intent_id IS NOT NULL THEN jsonb_build_object(
          'status', CASE ci.status WHEN 'pending' THEN 'in_progress' WHEN 'submitted' THEN 'complete' WHEN 'filled' THEN 'complete' WHEN 'executed' THEN 'complete' WHEN 'failed' THEN 'failed' WHEN 'rejected' THEN 'failed' WHEN 'cancelled' THEN 'failed' WHEN 'error' THEN 'failed' ELSE 'in_progress' END,
          'label', ci.side||' '||coalesce(ci.amount::text,'')||' '||coalesce(ci.pair,'')||COALESCE(' @ '||ci.limit_price::text,'')||' — '||ci.status)
        WHEN cd.customer_id IS NULL THEN jsonb_build_object('status','not_started','label','Awaiting decision')
        WHEN sa.message IS NOT NULL THEN jsonb_build_object('status','na','label','Skipped — '||sa.message)
        WHEN v_is_today AND v_minutes < 150 THEN jsonb_build_object('status','in_progress','label','Sizing order…')
        ELSE jsonb_build_object('status','failed','label','Order intent missing')
      END,
      'execute', CASE
        WHEN cd.action = 'HOLD' OR (cd.customer_id IS NULL AND v_dec_status = 'complete') THEN jsonb_build_object('status','na','label','—')
        WHEN sa.message IS NOT NULL AND ci.intent_id IS NULL THEN jsonb_build_object('status','na','label','—')
        WHEN co.exchange_order_id IS NOT NULL THEN jsonb_build_object(
          'status', CASE upper(coalesce(co.status,'')) WHEN 'PLACED' THEN 'in_progress' WHEN 'PARTIALLY_FILLED' THEN 'in_progress' WHEN 'OPEN' THEN 'in_progress' WHEN 'PENDING' THEN 'in_progress' WHEN 'SUBMITTED' THEN 'in_progress' WHEN 'FILLED' THEN 'complete' WHEN 'COMPLETED' THEN 'complete' WHEN 'CANCELLED' THEN 'failed' WHEN 'REJECTED' THEN 'failed' WHEN 'FAILED' THEN 'failed' WHEN 'ERROR' THEN 'failed' ELSE 'in_progress' END,
          'label', co.side||' '||coalesce(co.qty::text,'')||' '||coalesce(co.pair,'')||COALESCE(' @ '||co.price::text,'')||' — '||coalesce(co.status,'?'))
        WHEN ci.intent_id IS NULL THEN jsonb_build_object('status','not_started','label','Awaiting intent')
        WHEN v_is_today AND v_minutes < 160 THEN jsonb_build_object('status','in_progress','label','Placing order on VALR…')
        ELSE jsonb_build_object('status','failed','label','Order not placed')
      END,
      'settle', CASE
        WHEN cd.action = 'HOLD' OR (cd.customer_id IS NULL AND v_dec_status = 'complete') THEN jsonb_build_object('status','na','label','—')
        WHEN sa.message IS NOT NULL AND ci.intent_id IS NULL THEN jsonb_build_object('status','na','label','—')
        WHEN cs.posted THEN jsonb_build_object('status','complete','label','Settled '||COALESCE(round(cs.btc,8)::text||' BTC ','')||COALESCE('@ '||round(cs.usdt,2)::text||' USDT','')||' ('||to_char(cs.posted_at AT TIME ZONE 'UTC','HH24:MI')||' UTC)')
        WHEN co.exchange_order_id IS NULL THEN jsonb_build_object('status','not_started','label','Awaiting fills')
        WHEN upper(coalesce(co.status,'')) IN ('FILLED','COMPLETED') THEN jsonb_build_object('status','in_progress','label','Posting to ledger…')
        WHEN upper(coalesce(co.status,'')) IN ('CANCELLED','REJECTED','FAILED','ERROR') THEN jsonb_build_object('status','na','label','Order did not fill')
        ELSE jsonb_build_object('status','not_started','label','Awaiting fills')
      END,
      'convert', CASE
        WHEN cc.customer_id IS NULL THEN jsonb_build_object('status','na','label','No USDPC conversion')
        WHEN cc.n_failed_intents > 0 OR cc.n_failed_orders > 0 THEN jsonb_build_object('status','failed','label','USDPC conversion failed — '||cc.n_filled_orders::text||'/'||cc.n_intents::text||' filled')
        WHEN cc.n_filled_orders >= cc.n_intents AND cc.n_intents > 0 THEN jsonb_build_object('status','complete','label','USDPC '||CASE WHEN cc.has_prebuy AND cc.has_sweep THEN 'convert' WHEN cc.has_prebuy THEN 'pre-buy convert' ELSE 'sweep' END||' filled ('||cc.n_filled_orders::text||'/'||cc.n_intents::text||')')
        ELSE jsonb_build_object('status','in_progress','label','USDPC conversion in progress ('||cc.n_filled_orders::text||'/'||cc.n_intents::text||' filled)')
      END,
      'subtitle', jsonb_build_object(
        'step', CASE
          WHEN cs.posted THEN 'Settled'
          WHEN co.exchange_order_id IS NOT NULL THEN 'Executing'
          WHEN ci.intent_id IS NOT NULL THEN 'Sizing order'
          WHEN cd.customer_id IS NOT NULL AND sa.message IS NOT NULL THEN 'Order skipped'
          WHEN cd.customer_id IS NOT NULL THEN CASE WHEN cd.action = 'HOLD' THEN 'Hold' ELSE 'Decision ready' END
          WHEN v_dec_status = 'complete' THEN 'Skipped today'
          WHEN v_dec_status = 'failed' THEN 'Pipeline failed'
          ELSE 'Waiting on pipeline'
        END,
        'detail', CASE
          WHEN cs.posted THEN 'Last activity '||to_char(cs.posted_at AT TIME ZONE 'UTC','HH24:MI')||' UTC'
          WHEN co.exchange_order_id IS NOT NULL THEN co.side||' '||coalesce(co.qty::text,'')||' '||coalesce(co.pair,'')||COALESCE(' @ '||co.price::text,'')||' — '||coalesce(co.status,'?')
          WHEN ci.intent_id IS NOT NULL THEN ci.side||' '||coalesce(ci.amount::text,'')||' '||coalesce(ci.pair,'')||' — '||ci.status
          WHEN cd.customer_id IS NOT NULL AND sa.message IS NOT NULL THEN sa.message
          WHEN cd.customer_id IS NOT NULL THEN COALESCE(cd.note,'') || ' · alloc ' || round(COALESCE(cd.current_alloc,0)*100) || '% → ' || round(COALESCE(cd.target_alloc,0)*100) || '%'
          WHEN v_dec_status = 'complete' THEN 'No decision generated for this customer'
          ELSE v_dec_label
        END
      )
    ) ORDER BY ac.registration_status NULLS LAST, ac.customer_name)
  INTO v_customers
  FROM active_customers ac
  LEFT JOIN cust_decision   cd ON cd.customer_id = ac.customer_id
  LEFT JOIN cust_intent     ci ON ci.customer_id = ac.customer_id
  LEFT JOIN cust_skip_alert sa ON sa.customer_id = ac.customer_id
  LEFT JOIN cust_order      co ON co.customer_id = ac.customer_id
  LEFT JOIN cust_convert    cc ON cc.customer_id = ac.customer_id
  LEFT JOIN cust_settle     cs ON cs.customer_id = ac.customer_id;

  IF v_customers IS NULL AND v_dec_n = 0 THEN v_dec_status := 'na'; v_dec_label := 'No STH CB clients'; END IF;

  RETURN jsonb_build_object(
    'date', p_date, 'is_today', v_is_today, 'now_utc', v_now, 'signal_date', v_signal_date,
    'org_steps', jsonb_build_object(
      'tracker',   jsonb_build_object('status', v_trk_status, 'label', v_trk_label, 'ts', v_trk.computed_at),
      'decisions', jsonb_build_object('status', v_dec_status, 'label', v_dec_label)
    ),
    'customers', COALESCE(v_customers, '[]'::jsonb)
  );
END $$;
GRANT EXECUTE ON FUNCTION sth_cb.get_customer_pipeline_status(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.sth_cb_customer_pipeline_status(p_org_id uuid, p_date date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (p_org_id IN (SELECT id FROM public.my_orgs()) OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
    RETURN jsonb_build_object('error', 'Not authorised');
  END IF;
  RETURN sth_cb.get_customer_pipeline_status(p_org_id, p_date);
END $$;
REVOKE ALL ON FUNCTION public.sth_cb_customer_pipeline_status(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sth_cb_customer_pipeline_status(uuid, date) TO authenticated, service_role;

-- ── 4. LTH PVR functions back to LTH-only ────────────────────────────────────
-- 4a. public.get_customer_pipeline_status: only LTH_PVR customers (rewrite in place).
DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_customer_pipeline_status';
  IF def IS NOT NULL AND def NOT LIKE '%cs.strategy_code=''LTH_PVR''%' THEN
    def := replace(def,
      'JOIN public.customer_strategies cs ON cs.customer_id=cd.customer_id AND cs.org_id=p_org_id AND cs.status=''active''',
      'JOIN public.customer_strategies cs ON cs.customer_id=cd.customer_id AND cs.org_id=p_org_id AND cs.status=''active'' AND cs.strategy_code=''LTH_PVR''');
    EXECUTE def;
  END IF;
END $do$;

-- 4b. lth_pvr.get_pipeline_status: drop the sth_cb block (now sth_cb.get_pipeline_status) and the band_source filter.
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
BEGIN
  v_trade_date    := COALESCE(p_trade_date, (now() AT TIME ZONE 'UTC')::date);
  v_signal_date   := v_trade_date - INTERVAL '1 day';
  v_current_date  := (now() AT TIME ZONE 'UTC')::date;
  v_window_closes := (v_trade_date + INTERVAL '1 day')::timestamp;

  SELECT EXISTS (SELECT 1 FROM lth_pvr.rb_bands_daily WHERE date = v_signal_date AND mode = 'static' AND org_id = v_org_id) INTO v_bands_exists;
  v_window_valid := v_current_date <= (v_signal_date + INTERVAL '1 day')::date;

  SELECT EXISTS (SELECT 1 FROM lth_pvr.decisions_daily WHERE trade_date = v_trade_date AND org_id = v_org_id) INTO v_decisions_done;
  SELECT EXISTS (SELECT 1 FROM lth_pvr.order_intents WHERE trade_date = v_trade_date AND org_id = v_org_id) INTO v_intents_done;
  SELECT EXISTS (SELECT 1 FROM lth_pvr.exchange_orders WHERE submitted_at::date = v_trade_date AND org_id = v_org_id) INTO v_orders_done;
  SELECT EXISTS (SELECT 1 FROM lth_pvr.exchange_orders WHERE submitted_at::date = v_trade_date AND org_id = v_org_id AND status != 'error') INTO v_orders_polling;
  SELECT EXISTS (SELECT 1 FROM lth_pvr.ledger_lines WHERE trade_date = v_trade_date AND org_id = v_org_id AND kind IN ('buy', 'sell')) INTO v_ledger_done;

  IF v_decisions_done AND NOT v_intents_done THEN
    SELECT (
      EXISTS (SELECT 1 FROM public.alert_events WHERE component = 'ef_create_order_intents'
                AND created_at >= (v_trade_date::timestamp AT TIME ZONE 'UTC') AND created_at < ((v_trade_date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
                AND severity IN ('info', 'warn'))
      AND NOT EXISTS (SELECT 1 FROM public.alert_events WHERE component = 'ef_create_order_intents'
                AND created_at >= (v_trade_date::timestamp AT TIME ZONE 'UTC') AND created_at < ((v_trade_date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
                AND severity IN ('error', 'critical'))
    ) INTO v_intents_attempted_ok;
    IF v_intents_attempted_ok THEN
      v_no_viable_trades := true;
      v_intents_done := true; v_orders_done := true; v_orders_polling := true; v_ledger_done := true;
    END IF;
  END IF;

  v_can_resume := v_bands_exists AND v_window_valid AND NOT v_ledger_done;

  IF v_no_viable_trades THEN
    v_resume_reason := 'Pipeline complete – no viable trades today (all positions below minimum)';
  ELSIF NOT v_bands_exists THEN
    v_resume_reason := format('RB bands for %s not yet available', v_signal_date);
  ELSIF NOT v_window_valid THEN
    v_resume_reason := format('Trade window expired (current date: %s, window closed: %s)', v_current_date, v_window_closes);
  ELSIF v_ledger_done THEN
    v_resume_reason := 'Pipeline fully complete (ledger posted)';
  ELSE
    v_resume_reason := 'Pipeline ready to resume';
  END IF;

  RETURN jsonb_build_object(
    'trade_date', v_trade_date, 'signal_date', v_signal_date, 'current_date', v_current_date, 'window_closes', v_window_closes,
    'ci_bands_available', v_bands_exists, 'rb_bands_available', v_bands_exists, 'band_source', 'rb',
    'window_valid', v_window_valid, 'can_resume', v_can_resume, 'resume_reason', v_resume_reason,
    'steps', jsonb_build_object('ci_bands', v_bands_exists, 'rb_bands', v_bands_exists, 'decisions', v_decisions_done,
      'intents', v_intents_done, 'orders', v_orders_done, 'poll_orders', v_orders_polling, 'ledger', v_ledger_done)
  );
END;
$function$;

-- ── 5. Strategy switching ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_strategy_history (
  id                   bigserial PRIMARY KEY,
  org_id               uuid   NOT NULL,
  customer_id          bigint NOT NULL REFERENCES public.customer_details(customer_id) ON DELETE CASCADE,
  customer_strategy_id uuid,
  from_strategy_code   text,
  to_strategy_code     text   NOT NULL,
  from_config          jsonb,
  to_config            jsonb,
  holdings_snapshot    jsonb,
  reason               text,
  changed_by           text,
  changed_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_strategy_history_customer_idx ON public.customer_strategy_history (customer_id, changed_at DESC);
ALTER TABLE public.customer_strategy_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_strategy_history_org_read ON public.customer_strategy_history;
CREATE POLICY customer_strategy_history_org_read ON public.customer_strategy_history
  FOR SELECT TO authenticated USING (org_id IN (SELECT id FROM public.my_orgs()));
GRANT SELECT ON public.customer_strategy_history TO authenticated;
GRANT ALL ON public.customer_strategy_history TO service_role;
COMMENT ON TABLE public.customer_strategy_history IS 'Audit trail of in-place strategy switches (public.switch_customer_strategy). The live row stays in customer_strategies; this table records what changed, by whom, and the holdings at the time.';

CREATE OR REPLACE FUNCTION public.switch_customer_strategy(
  p_customer_id bigint, p_to_strategy_code text, p_options jsonb DEFAULT '{}'::jsonb, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'lth_pvr', 'sth_cb'
AS $$
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

  IF NOT (v_cust.org_id IN (SELECT id FROM public.my_orgs() WHERE role IN ('owner','admin','editor'))
          OR current_setting('request.jwt.claim.role', true) = 'service_role') THEN
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

  -- Options per target strategy
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

  -- Holdings snapshot (latest ledger-derived balance)
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

  -- Fee-plan history is keyed by strategy code; stamp a row so as-of lookups see the new code from today.
  BEGIN
    PERFORM public.fn_write_fee_history(p_customer_id, CURRENT_DATE, v_by, format('Strategy switch %s → %s', v_cs.strategy_code, p_to_strategy_code));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- What happens next (informational)
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
END $$;
REVOKE ALL ON FUNCTION public.switch_customer_strategy(bigint, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.switch_customer_strategy(bigint, text, jsonb, text) TO authenticated, service_role;

-- ── 6. Readers of the decisions table ───────────────────────────────────────
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

-- list_customer_portfolios.has_trading_history: either decisions table.
DO $do$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'list_customer_portfolios' AND pg_get_function_identity_arguments(p.oid) = 'p_customer_id bigint';
  IF def IS NOT NULL AND def NOT LIKE '%sth_cb.decisions_daily%' THEN
    def := replace(def,
      'select 1 from lth_pvr.decisions_daily dd
      where dd.customer_id = p_customer_id limit 1',
      'select 1 from lth_pvr.decisions_daily dd where dd.customer_id = p_customer_id
      union all select 1 from sth_cb.decisions_daily sd where sd.customer_id = p_customer_id limit 1');
    EXECUTE def;
  END IF;
END $do$;
