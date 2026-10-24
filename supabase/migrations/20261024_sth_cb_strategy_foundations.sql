-- ============================================================================
-- STH_CB — Short-Term-Holder Cost Basis strategy: Phase 0 foundations
-- ----------------------------------------------------------------------------
-- New BTC strategy (back-tester only for now; no live pipeline yet).
--
-- Strategy rules (ChartInspect "STH Line: Trend Band 5% + Capitulation Buy 70%"):
--   R1  Capitulation buy : price <= 70% of STH cost basis  -> deploy all cash
--   R2  Capitulation exit: price >= 100% of STH cost basis -> sell all BTC
--                          (optionally gated: sell only once momentum <= thr)
--   R3  Trend entry      : price >= 105% of STH cost basis -> deploy all cash
--       Trend exit       : price <=  95% of STH cost basis -> sell all BTC
--                          (optionally momentum-gated as above)
--   In-market = capitulation latch OR trend latch (ChartInspect semantics).
--
-- Data source: STH cost basis == Research Bitcoin realizedprice/realized_price_sth,
-- already persisted daily in lth_pvr.onchain_pvr_daily by ef_fetch_onchain_pvr.
-- sth_cb.cost_basis_daily is a VIEW over that table so there is a single
-- source of truth and no duplicate RB fetch.
--
-- Security posture (mirrors ta_bot / ta_bot_bt): RLS on, zero policies, all
-- privileges revoked from anon/authenticated. Browser access goes through
-- SECURITY DEFINER RPCs in public that guard on org membership (my_orgs()).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Strategy catalogue
-- ---------------------------------------------------------------------------
INSERT INTO public.strategies (strategy_code, name, description, schema_name)
VALUES ('STH_CB', 'STH Cost Basis BTC Strategy',
        'All-in / all-out BTC strategy driven by price relative to the short-term-holder cost basis (capitulation buy at 70%, trend band +5%/-5%)',
        'sth_cb')
ON CONFLICT (strategy_code) DO UPDATE
   SET name = EXCLUDED.name, description = EXCLUDED.description, schema_name = EXCLUDED.schema_name;

ALTER TABLE public.customer_strategies DROP CONSTRAINT IF EXISTS chk_customer_strategies_strategy_code;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT chk_customer_strategies_strategy_code
  CHECK (strategy_code IN ('LTH_PVR', 'ADV_DCA', 'STD_DCA', 'TA_BOT', 'STH_CB'));

-- ---------------------------------------------------------------------------
-- 1. Schemas
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS sth_cb;
CREATE SCHEMA IF NOT EXISTS sth_cb_bt;

REVOKE ALL ON SCHEMA sth_cb    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA sth_cb_bt FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA sth_cb, sth_cb_bt TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA sth_cb    REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA sth_cb_bt REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA sth_cb    REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA sth_cb_bt REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA sth_cb    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA sth_cb_bt GRANT ALL ON TABLES TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Daily inputs: STH cost basis + price (view over on-chain PVR series)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW sth_cb.cost_basis_daily AS
SELECT d.org_id,
       d.date                                   AS close_date,
       d.btc_price                              AS btc_price_usd,
       d.sth_realized_price                     AS sth_cost_basis_usd,
       CASE WHEN d.sth_realized_price > 0
            THEN d.btc_price / d.sth_realized_price END AS price_to_cb_ratio
FROM lth_pvr.onchain_pvr_daily d
WHERE d.btc_price IS NOT NULL
  AND d.sth_realized_price IS NOT NULL;

GRANT SELECT ON sth_cb.cost_basis_daily TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Back-test tables (shapes mirror lth_pvr_bt so the Admin UI chart code
--    can render both strategies with the same column names)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sth_cb_bt.bt_runs (
  bt_run_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  label              text,
  status             text NOT NULL DEFAULT 'running',  -- running | ok | error
  error              text,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  created_by         uuid,
  -- Companion LTH PVR run (lth_pvr_bt.bt_runs) executed with the same
  -- window / contributions / fees, used as a benchmark overlay in the UI.
  lth_pvr_bt_run_id  uuid,
  summary            jsonb
);
CREATE INDEX IF NOT EXISTS bt_runs_org_started_idx ON sth_cb_bt.bt_runs (org_id, started_at DESC);

CREATE TABLE IF NOT EXISTS sth_cb_bt.bt_params (
  bt_run_id                    uuid PRIMARY KEY REFERENCES sth_cb_bt.bt_runs (bt_run_id) ON DELETE CASCADE,
  start_date                   date NOT NULL,
  end_date                     date NOT NULL,
  upfront_contrib_usdt         numeric NOT NULL DEFAULT 0,
  monthly_contrib_usdt         numeric NOT NULL DEFAULT 0,
  maker_bps_trade              numeric NOT NULL DEFAULT 8,     -- VALR BTC/USDT fee (bps, charged in BTC)
  maker_bps_contrib            numeric NOT NULL DEFAULT 18,    -- VALR USDT/ZAR fee (bps, charged in USDT)
  fee_plan                     text    NOT NULL DEFAULT 'management',  -- management | platform
  platform_fee_pct             numeric NOT NULL DEFAULT 0.0075,
  management_fee_pct           numeric NOT NULL DEFAULT 0.01,
  performance_fee_pct          numeric NOT NULL DEFAULT 0.10,
  usdpc_enabled                boolean NOT NULL DEFAULT true,
  usdpc_apy_percent            numeric NOT NULL DEFAULT 10,
  usdpc_conversion_fee_percent numeric NOT NULL DEFAULT 0.1,
  -- Strategy thresholds expressed as price / STH-cost-basis ratios
  cap_buy_ratio                numeric NOT NULL DEFAULT 0.70,
  cap_exit_ratio               numeric NOT NULL DEFAULT 1.00,
  trend_enter_ratio            numeric NOT NULL DEFAULT 1.05,
  trend_exit_ratio             numeric NOT NULL DEFAULT 0.95,
  -- Momentum gate on sells: sell only once ROC(momo_len) <= momo_thr
  momo_enabled                 boolean NOT NULL DEFAULT true,
  momo_len                     integer NOT NULL DEFAULT 5,
  momo_thr                     numeric NOT NULL DEFAULT 0,
  momo_on_cap_exit             boolean NOT NULL DEFAULT true,
  momo_on_trend_exit           boolean NOT NULL DEFAULT true,
  -- 1 = signal on close of day D, fill at close of D+1 (matches live pipeline)
  -- 0 = fill at same-day close (ChartInspect style)
  execution_lag_days           integer NOT NULL DEFAULT 1 CHECK (execution_lag_days IN (0, 1)),
  CONSTRAINT chk_sth_cb_ratios CHECK (
    cap_buy_ratio > 0 AND cap_buy_ratio < cap_exit_ratio
    AND trend_exit_ratio < trend_enter_ratio
  )
);

CREATE TABLE IF NOT EXISTS sth_cb_bt.bt_results_daily (
  bt_run_id                  uuid NOT NULL REFERENCES sth_cb_bt.bt_runs (bt_run_id) ON DELETE CASCADE,
  org_id                     uuid NOT NULL,
  close_date                 date NOT NULL,
  trade_date                 date NOT NULL,
  signal_date                date,                 -- close whose signal was executed today
  action                     text NOT NULL,        -- BUY | SELL | HOLD
  amount_pct                 numeric NOT NULL DEFAULT 0,
  rule                       text,
  note                       text,
  position_state             text NOT NULL,        -- cash | cap_hold | trend_hold (after today's execution)
  cap_latch                  boolean NOT NULL DEFAULT false,
  trend_latch                boolean NOT NULL DEFAULT false,
  signal_in_market           boolean NOT NULL DEFAULT false,  -- decision at today's close (for next fill)
  roc                        numeric,
  btc_balance                numeric NOT NULL DEFAULT 0,
  usdt_balance               numeric NOT NULL DEFAULT 0,
  nav_usd                    numeric NOT NULL DEFAULT 0,
  price_usd                  numeric,
  sth_cost_basis_usd         numeric,
  price_to_cb_ratio          numeric,
  contrib_gross_usdt_cum     numeric NOT NULL DEFAULT 0,
  contrib_fee_usdt_cum       numeric NOT NULL DEFAULT 0,
  contrib_net_usdt_cum       numeric NOT NULL DEFAULT 0,
  total_roi_percent          numeric,
  cagr_percent               numeric,
  platform_fees_paid_usdt    numeric NOT NULL DEFAULT 0,
  performance_fees_paid_usdt numeric NOT NULL DEFAULT 0,
  exchange_fees_paid_btc     numeric NOT NULL DEFAULT 0,
  exchange_fees_paid_usdt    numeric NOT NULL DEFAULT 0,
  high_water_mark_usdt       numeric NOT NULL DEFAULT 0,
  usdpc_balance              numeric NOT NULL DEFAULT 0,
  usdpc_price_usd            numeric,
  usdpc_yield_usdt           numeric NOT NULL DEFAULT 0,
  usdpc_conversion_fee_usdt  numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (bt_run_id, close_date)
);

CREATE TABLE IF NOT EXISTS sth_cb_bt.bt_ledger (
  ledger_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_run_id    uuid NOT NULL REFERENCES sth_cb_bt.bt_runs (bt_run_id) ON DELETE CASCADE,
  org_id       uuid NOT NULL,
  trade_date   date NOT NULL,
  close_date   date NOT NULL,
  kind         text NOT NULL,          -- contrib | buy | sell | fee | convert
  amount_btc   numeric NOT NULL DEFAULT 0,
  amount_usdt  numeric NOT NULL DEFAULT 0,
  fee_btc      numeric NOT NULL DEFAULT 0,
  fee_usdt     numeric NOT NULL DEFAULT 0,
  amount_usdpc numeric NOT NULL DEFAULT 0,
  fee_usdpc    numeric NOT NULL DEFAULT 0,
  note         text
);
CREATE INDEX IF NOT EXISTS bt_ledger_run_date_idx ON sth_cb_bt.bt_ledger (bt_run_id, trade_date);

CREATE TABLE IF NOT EXISTS sth_cb_bt.bt_std_dca_balances (
  bt_run_id                uuid NOT NULL REFERENCES sth_cb_bt.bt_runs (bt_run_id) ON DELETE CASCADE,
  org_id                   uuid NOT NULL,
  close_date               date NOT NULL,
  trade_date               date NOT NULL,
  btc_balance              numeric NOT NULL DEFAULT 0,
  usdt_balance             numeric NOT NULL DEFAULT 0,
  nav_usd                  numeric NOT NULL DEFAULT 0,
  contrib_gross_usdt_cum   numeric NOT NULL DEFAULT 0,
  contrib_fee_usdt_cum     numeric NOT NULL DEFAULT 0,
  contrib_net_usdt_cum     numeric NOT NULL DEFAULT 0,
  total_roi_percent        numeric,
  cagr_percent             numeric,
  total_exchange_fees_btc  numeric NOT NULL DEFAULT 0,
  total_exchange_fees_usdt numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (bt_run_id, close_date)
);

CREATE TABLE IF NOT EXISTS sth_cb_bt.bt_std_dca_ledger (
  ledger_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_run_id   uuid NOT NULL REFERENCES sth_cb_bt.bt_runs (bt_run_id) ON DELETE CASCADE,
  org_id      uuid NOT NULL,
  trade_date  date NOT NULL,
  close_date  date NOT NULL,
  usdt_spent  numeric NOT NULL DEFAULT 0,
  btc_bought  numeric NOT NULL DEFAULT 0,
  price_used  numeric,
  fee_btc     numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sth_cb_bt.bt_hodl_balances (
  bt_run_id                uuid NOT NULL REFERENCES sth_cb_bt.bt_runs (bt_run_id) ON DELETE CASCADE,
  org_id                   uuid NOT NULL,
  close_date               date NOT NULL,
  trade_date               date NOT NULL,
  btc_balance              numeric NOT NULL DEFAULT 0,
  usdt_balance             numeric NOT NULL DEFAULT 0,
  nav_usd                  numeric NOT NULL DEFAULT 0,
  contrib_gross_usdt_cum   numeric NOT NULL DEFAULT 0,
  contrib_fee_usdt_cum     numeric NOT NULL DEFAULT 0,
  contrib_net_usdt_cum     numeric NOT NULL DEFAULT 0,
  total_roi_percent        numeric,
  cagr_percent             numeric,
  total_exchange_fees_btc  numeric NOT NULL DEFAULT 0,
  total_exchange_fees_usdt numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (bt_run_id, close_date)
);

CREATE TABLE IF NOT EXISTS sth_cb_bt.bt_hodl_ledger (
  ledger_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bt_run_id   uuid NOT NULL REFERENCES sth_cb_bt.bt_runs (bt_run_id) ON DELETE CASCADE,
  org_id      uuid NOT NULL,
  trade_date  date NOT NULL,
  close_date  date NOT NULL,
  usdt_spent  numeric NOT NULL DEFAULT 0,
  btc_bought  numeric NOT NULL DEFAULT 0,
  price_used  numeric,
  fee_btc     numeric NOT NULL DEFAULT 0,
  fee_usdt    numeric NOT NULL DEFAULT 0
);

-- Annual roll-up — identical column list to lth_pvr_bt.v_bt_results_annual
CREATE OR REPLACE VIEW sth_cb_bt.v_bt_results_annual AS
WITH adv_raw AS (
  SELECT bt_run_id, trade_date,
         date_part('year', trade_date)::integer AS trading_year,
         last_value(price_usd) OVER w AS btc_price,
         last_value(contrib_gross_usdt_cum) OVER w AS total_investment,
         last_value(btc_balance) OVER w AS btc_holdings,
         last_value(usdt_balance + usdpc_balance * COALESCE(usdpc_price_usd, 1)) OVER w AS usd_holdings,
         last_value(nav_usd) OVER w AS nav_usd,
         last_value(total_roi_percent) OVER w AS roi_percent,
         last_value(cagr_percent) OVER w AS cagr_percent
  FROM sth_cb_bt.bt_results_daily
  WINDOW w AS (PARTITION BY bt_run_id, date_part('year', trade_date)
               ORDER BY trade_date ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
),
adv_yearly AS (
  SELECT DISTINCT ON (bt_run_id, trading_year)
         bt_run_id, trading_year, btc_price, total_investment, btc_holdings, usd_holdings,
         nav_usd, roi_percent, cagr_percent
  FROM adv_raw ORDER BY bt_run_id, trading_year, trade_date DESC
),
std_raw AS (
  SELECT bt_run_id, trade_date,
         date_part('year', trade_date)::integer AS trading_year,
         last_value(nav_usd) OVER w AS nav_usd,
         last_value(total_roi_percent) OVER w AS roi_percent,
         last_value(cagr_percent) OVER w AS cagr_percent
  FROM sth_cb_bt.bt_std_dca_balances
  WINDOW w AS (PARTITION BY bt_run_id, date_part('year', trade_date)
               ORDER BY trade_date ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
),
std_yearly AS (
  SELECT DISTINCT ON (bt_run_id, trading_year) bt_run_id, trading_year, nav_usd, roi_percent, cagr_percent
  FROM std_raw ORDER BY bt_run_id, trading_year, trade_date DESC
),
hodl_raw AS (
  SELECT bt_run_id, trade_date,
         date_part('year', trade_date)::integer AS trading_year,
         last_value(nav_usd) OVER w AS nav_usd,
         last_value(total_roi_percent) OVER w AS roi_percent,
         last_value(cagr_percent) OVER w AS cagr_percent
  FROM sth_cb_bt.bt_hodl_balances
  WINDOW w AS (PARTITION BY bt_run_id, date_part('year', trade_date)
               ORDER BY trade_date ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
),
hodl_yearly AS (
  SELECT DISTINCT ON (bt_run_id, trading_year) bt_run_id, trading_year, nav_usd, roi_percent, cagr_percent
  FROM hodl_raw ORDER BY bt_run_id, trading_year, trade_date DESC
)
SELECT a.bt_run_id, a.trading_year, a.btc_price, a.total_investment, a.btc_holdings, a.usd_holdings,
       a.nav_usd, a.roi_percent, a.cagr_percent,
       s.nav_usd AS std_nav_usd,  s.roi_percent AS std_roi_percent,  s.cagr_percent AS std_cagr_percent,
       h.nav_usd AS hodl_nav_usd, h.roi_percent AS hodl_roi_percent, h.cagr_percent AS hodl_cagr_percent
FROM adv_yearly a
LEFT JOIN std_yearly  s ON s.bt_run_id = a.bt_run_id AND s.trading_year = a.trading_year
LEFT JOIN hodl_yearly h ON h.bt_run_id = a.bt_run_id AND h.trading_year = a.trading_year
ORDER BY a.bt_run_id, a.trading_year;

-- ---------------------------------------------------------------------------
-- 4. Lock down: RLS on, no policies, service_role only
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('sth_cb', 'sth_cb_bt') LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
    EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC, anon, authenticated', r.schemaname, r.tablename);
    EXECUTE format('GRANT ALL ON %I.%I TO service_role', r.schemaname, r.tablename);
  END LOOP;
END $$;
GRANT SELECT ON sth_cb_bt.v_bt_results_annual TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Browser-facing RPCs (SECURITY DEFINER, org-membership guarded)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sth_cb_bt.assert_run_access(p_bt_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sth_cb_bt.bt_runs r
     WHERE r.bt_run_id = p_bt_run_id
       AND r.org_id IN (SELECT id FROM public.my_orgs())
  ) THEN
    RAISE EXCEPTION 'sth_cb_bt run % not found or access denied', p_bt_run_id USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sth_cb_bt_list_runs(p_limit integer DEFAULT 50)
RETURNS TABLE (
  bt_run_id uuid, org_id uuid, label text, status text, error text,
  started_at timestamptz, finished_at timestamptz, lth_pvr_bt_run_id uuid, summary jsonb,
  start_date date, end_date date, upfront_contrib_usdt numeric, monthly_contrib_usdt numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.bt_run_id, r.org_id, r.label, r.status, r.error, r.started_at, r.finished_at,
         r.lth_pvr_bt_run_id, r.summary,
         p.start_date, p.end_date, p.upfront_contrib_usdt, p.monthly_contrib_usdt
  FROM sth_cb_bt.bt_runs r
  LEFT JOIN sth_cb_bt.bt_params p ON p.bt_run_id = r.bt_run_id
  WHERE r.org_id IN (SELECT id FROM public.my_orgs())
  ORDER BY r.started_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
$$;

CREATE OR REPLACE FUNCTION public.sth_cb_bt_get_run(p_bt_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM sth_cb_bt.assert_run_access(p_bt_run_id);
  SELECT jsonb_build_object('run', to_jsonb(r), 'params', to_jsonb(p))
    INTO v
  FROM sth_cb_bt.bt_runs r
  LEFT JOIN sth_cb_bt.bt_params p ON p.bt_run_id = r.bt_run_id
  WHERE r.bt_run_id = p_bt_run_id;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.sth_cb_bt_get_results_daily(p_bt_run_id uuid)
RETURNS SETOF sth_cb_bt.bt_results_daily
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM sth_cb_bt.assert_run_access(p_bt_run_id);
  RETURN QUERY SELECT * FROM sth_cb_bt.bt_results_daily d
               WHERE d.bt_run_id = p_bt_run_id ORDER BY d.trade_date;
END $$;

CREATE OR REPLACE FUNCTION public.sth_cb_bt_get_std_dca_balances(p_bt_run_id uuid)
RETURNS SETOF sth_cb_bt.bt_std_dca_balances
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM sth_cb_bt.assert_run_access(p_bt_run_id);
  RETURN QUERY SELECT * FROM sth_cb_bt.bt_std_dca_balances d
               WHERE d.bt_run_id = p_bt_run_id ORDER BY d.trade_date;
END $$;

CREATE OR REPLACE FUNCTION public.sth_cb_bt_get_hodl_balances(p_bt_run_id uuid)
RETURNS SETOF sth_cb_bt.bt_hodl_balances
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM sth_cb_bt.assert_run_access(p_bt_run_id);
  RETURN QUERY SELECT * FROM sth_cb_bt.bt_hodl_balances d
               WHERE d.bt_run_id = p_bt_run_id ORDER BY d.trade_date;
END $$;

CREATE OR REPLACE FUNCTION public.sth_cb_bt_get_ledger(p_bt_run_id uuid)
RETURNS SETOF sth_cb_bt.bt_ledger
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM sth_cb_bt.assert_run_access(p_bt_run_id);
  RETURN QUERY SELECT * FROM sth_cb_bt.bt_ledger l
               WHERE l.bt_run_id = p_bt_run_id ORDER BY l.trade_date, l.kind;
END $$;

CREATE OR REPLACE FUNCTION public.sth_cb_bt_get_annual(p_bt_run_id uuid)
RETURNS SETOF sth_cb_bt.v_bt_results_annual
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM sth_cb_bt.assert_run_access(p_bt_run_id);
  RETURN QUERY SELECT * FROM sth_cb_bt.v_bt_results_annual v
               WHERE v.bt_run_id = p_bt_run_id ORDER BY v.trading_year;
END $$;

-- Daily STH cost basis series for charts (org fixed to the live org, same
-- convention as public.get_onchain_pvr_series).
CREATE OR REPLACE FUNCTION public.get_sth_cost_basis_series(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (close_date date, btc_price_usd numeric, sth_cost_basis_usd numeric, price_to_cb_ratio numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT v.close_date, v.btc_price_usd, v.sth_cost_basis_usd, v.price_to_cb_ratio
  FROM sth_cb.cost_basis_daily v
  WHERE v.org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
    AND (p_from IS NULL OR v.close_date >= p_from)
    AND (p_to   IS NULL OR v.close_date <= p_to)
  ORDER BY v.close_date;
$$;

REVOKE ALL ON FUNCTION sth_cb_bt.assert_run_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sth_cb_bt_list_runs(integer)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.sth_cb_bt_get_run(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.sth_cb_bt_get_results_daily(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sth_cb_bt_get_std_dca_balances(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.sth_cb_bt_get_hodl_balances(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sth_cb_bt_get_ledger(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.sth_cb_bt_get_annual(uuid)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sth_cost_basis_series(date, date)    TO authenticated;

COMMENT ON SCHEMA sth_cb    IS 'STH Cost Basis BTC strategy — daily inputs (live pipeline not yet built).';
COMMENT ON SCHEMA sth_cb_bt IS 'STH Cost Basis BTC strategy — back-testing (isolated from live data).';
COMMENT ON VIEW sth_cb.cost_basis_daily IS 'Price vs short-term-holder cost basis (RB realized_price_sth) sourced from lth_pvr.onchain_pvr_daily.';
