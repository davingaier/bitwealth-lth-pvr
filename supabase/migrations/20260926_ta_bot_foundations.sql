-- ============================================================================
-- TA_BOT — Phase 0 foundations
-- New product: technical-analysis trading bot (Bybit perpetuals first).
-- Schemas: ta_bot (live), ta_bot_bt (back-testing). Strategy-agnostic objects
-- (customers, orgs, exchange_accounts, alert_events) stay in public.
-- Security posture: RLS enabled + zero policies + privileges revoked from
-- anon/authenticated on every table. All browser access goes through
-- SECURITY DEFINER RPCs (added in later phases) that guard on org membership.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Strategy catalogue
-- ---------------------------------------------------------------------------
INSERT INTO public.strategies (strategy_code, name, description, schema_name)
VALUES ('TA_BOT', 'Technical Analysis Bot',
        'Multi-agent TA confluence trading bot (scalp / day / swing) on perpetual futures',
        'ta_bot')
ON CONFLICT (strategy_code) DO UPDATE
   SET name = EXCLUDED.name, description = EXCLUDED.description, schema_name = EXCLUDED.schema_name;

ALTER TABLE public.customer_strategies DROP CONSTRAINT IF EXISTS chk_customer_strategies_strategy_code;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT chk_customer_strategies_strategy_code
  CHECK (strategy_code IN ('LTH_PVR', 'ADV_DCA', 'STD_DCA', 'TA_BOT'));

-- ---------------------------------------------------------------------------
-- 1. Schemas
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ta_bot;
CREATE SCHEMA IF NOT EXISTS ta_bot_bt;

REVOKE ALL ON SCHEMA ta_bot    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA ta_bot_bt FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ta_bot, ta_bot_bt TO service_role;

-- Future tables created in these schemas are service-role only by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA ta_bot    REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ta_bot_bt REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ta_bot    REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ta_bot_bt REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA ta_bot    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ta_bot_bt GRANT ALL ON TABLES TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Tenant guard trigger (mirrors lth_pvr.enforce_lth_pvr_customer)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ta_bot.enforce_ta_bot_customer()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_strategies cs
     WHERE cs.customer_id = NEW.customer_id
       AND cs.org_id      = NEW.org_id
       AND cs.strategy_code = 'TA_BOT'
  ) THEN
    RAISE EXCEPTION
      '%.% may only contain rows for customers with a TA_BOT strategy (customer_id=%, org_id=%)',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, NEW.customer_id, NEW.org_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION ta_bot.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ---------------------------------------------------------------------------
-- 3. Market data (shared across tenants — no org/customer columns)
-- ---------------------------------------------------------------------------
CREATE TABLE ta_bot.instruments (
  exchange       text NOT NULL,
  symbol         text NOT NULL,                       -- exchange-native, e.g. BTCUSDT
  tv_symbol      text NOT NULL,                       -- TradingView format, e.g. BYBIT:BTCUSDT.P
  category       text NOT NULL DEFAULT 'linear',      -- linear | inverse | spot
  base_asset     text NOT NULL,
  quote_asset    text NOT NULL,
  tick_size      numeric(38,12) NOT NULL,
  qty_step       numeric(38,12) NOT NULL,
  min_qty        numeric(38,12) NOT NULL,
  max_qty        numeric(38,12),
  min_notional   numeric(38,8),
  max_leverage   numeric(10,2),
  status         text NOT NULL DEFAULT 'Trading',
  tracked        boolean NOT NULL DEFAULT false,      -- worker streams candles only for tracked instruments
  raw            jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, symbol)
);
CREATE UNIQUE INDEX ux_instruments_tv_symbol ON ta_bot.instruments (tv_symbol);

CREATE TABLE ta_bot.candles (
  exchange   text NOT NULL,
  symbol     text NOT NULL,
  timeframe  text NOT NULL,                           -- 1m 5m 15m 1h 4h 1d
  open_time  timestamptz NOT NULL,
  open       numeric(38,12) NOT NULL,
  high       numeric(38,12) NOT NULL,
  low        numeric(38,12) NOT NULL,
  close      numeric(38,12) NOT NULL,
  volume     numeric(38,12) NOT NULL,
  turnover   numeric(38,8),
  confirmed  boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exchange, symbol, timeframe, open_time),
  CONSTRAINT chk_candles_timeframe CHECK (timeframe IN ('1m','5m','15m','1h','4h','1d')),
  CONSTRAINT chk_candles_ohlc CHECK (high >= low AND high >= open AND high >= close AND low <= open AND low <= close)
);
CREATE INDEX ix_candles_lookup ON ta_bot.candles (exchange, symbol, timeframe, open_time DESC);

-- ---------------------------------------------------------------------------
-- 4. Tool registry + analysis output (shared across tenants)
-- ---------------------------------------------------------------------------
CREATE TABLE ta_bot.tools (
  tool_code      text PRIMARY KEY,                    -- e.g. 'sr_swing', 'fib_retrace'
  name           text NOT NULL,
  description    text,
  version        int  NOT NULL DEFAULT 1,
  enabled        boolean NOT NULL DEFAULT false,
  weight         numeric(6,3) NOT NULL DEFAULT 1.000, -- confluence weight
  timeframes     text[] NOT NULL DEFAULT '{}',        -- timeframes this tool runs on
  params         jsonb NOT NULL DEFAULT '{}'::jsonb,
  knowledge_doc  text,                                -- path under ta-bot/knowledge/
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tools_touch BEFORE UPDATE ON ta_bot.tools
  FOR EACH ROW EXECUTE FUNCTION ta_bot.touch_updated_at();

CREATE TABLE ta_bot.analysis_runs (
  run_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange         text NOT NULL,
  symbol           text NOT NULL,
  style            text NOT NULL,                     -- scalp | day | swing
  timeframes       text[] NOT NULL,
  candles_through  timestamptz NOT NULL,              -- last confirmed candle used
  tool_codes       text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'running',   -- running | ok | error
  error            text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_analysis_runs_style CHECK (style IN ('scalp','day','swing'))
);
CREATE INDEX ix_analysis_runs_symbol ON ta_bot.analysis_runs (exchange, symbol, style, started_at DESC);

CREATE TABLE ta_bot.levels (
  level_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES ta_bot.analysis_runs(run_id) ON DELETE CASCADE,
  exchange    text NOT NULL,
  symbol      text NOT NULL,
  timeframe   text NOT NULL,
  tool_code   text NOT NULL REFERENCES ta_bot.tools(tool_code),
  level_type  text NOT NULL,                          -- support | resistance | pivot | zone | trendline
  price_low   numeric(38,12) NOT NULL,
  price_high  numeric(38,12) NOT NULL,
  strength    numeric(6,4) NOT NULL DEFAULT 1,        -- tool-native 0..1
  touches     int,
  first_seen  timestamptz,
  last_seen   timestamptz,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_levels_range CHECK (price_high >= price_low)
);
CREATE INDEX ix_levels_run ON ta_bot.levels (run_id);

CREATE TABLE ta_bot.confluence_zones (
  zone_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES ta_bot.analysis_runs(run_id) ON DELETE CASCADE,
  exchange       text NOT NULL,
  symbol         text NOT NULL,
  style          text NOT NULL,
  price_low      numeric(38,12) NOT NULL,
  price_high     numeric(38,12) NOT NULL,
  bias           text NOT NULL,                       -- support | resistance
  score          numeric(10,4) NOT NULL,              -- deterministic confluence score
  prob_baseline  numeric(5,4),                        -- calibrated model output (Phase 2)
  prob_final     numeric(5,4),                        -- after Analyst overlay (clamped)
  tool_codes     text[] NOT NULL,
  level_ids      uuid[] NOT NULL,
  rationale      text,
  valid_from     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_zone_range CHECK (price_high >= price_low),
  CONSTRAINT chk_zone_bias CHECK (bias IN ('support','resistance')),
  CONSTRAINT chk_zone_probs CHECK (
    (prob_baseline IS NULL OR prob_baseline BETWEEN 0 AND 1) AND
    (prob_final    IS NULL OR prob_final    BETWEEN 0 AND 1))
);
CREATE INDEX ix_zones_symbol_active ON ta_bot.confluence_zones (exchange, symbol, style, created_at DESC);

CREATE TABLE ta_bot.zone_outcomes (
  outcome_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id         uuid NOT NULL REFERENCES ta_bot.confluence_zones(zone_id) ON DELETE CASCADE,
  touched_at      timestamptz NOT NULL,
  outcome         text NOT NULL,                      -- reversed | broken | undetermined
  mfe_atr         numeric(10,4),                      -- max favourable excursion in ATR units
  mae_atr         numeric(10,4),
  bars_to_resolve int,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_outcome CHECK (outcome IN ('reversed','broken','undetermined'))
);
CREATE INDEX ix_zone_outcomes_zone ON ta_bot.zone_outcomes (zone_id);

CREATE TABLE ta_bot.calibration_models (
  model_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  style        text NOT NULL,
  symbol       text,                                  -- NULL = all symbols
  method       text NOT NULL,                         -- logistic | isotonic
  params       jsonb NOT NULL,
  brier_score  numeric(8,6),
  sample_size  int NOT NULL,
  fitted_at    timestamptz NOT NULL DEFAULT now(),
  active       boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- 5. Tenant config + trading (per org/customer; guarded by trigger)
-- ---------------------------------------------------------------------------
CREATE TABLE ta_bot.tenant_config (
  org_id                    uuid   NOT NULL,
  customer_id               bigint NOT NULL,
  exchange                  text   NOT NULL DEFAULT 'bybit',
  mode                      text   NOT NULL DEFAULT 'paper',   -- paper (testnet) | live
  halted                    boolean NOT NULL DEFAULT false,    -- kill switch
  halted_reason             text,
  symbols                   text[] NOT NULL DEFAULT '{}',
  styles                    text[] NOT NULL DEFAULT '{swing}',
  risk_pct_per_trade        numeric(6,4) NOT NULL DEFAULT 0.0050,  -- 0.5 % of equity
  max_daily_loss_pct        numeric(6,4) NOT NULL DEFAULT 0.0300,
  max_concurrent_positions  int NOT NULL DEFAULT 2,
  leverage_cap              numeric(6,2) NOT NULL DEFAULT 3,
  min_zone_probability      numeric(5,4) NOT NULL DEFAULT 0.6000,
  llm_daily_budget_usd      numeric(10,2) NOT NULL DEFAULT 2.00,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, customer_id),
  CONSTRAINT chk_tenant_mode CHECK (mode IN ('paper','live')),
  CONSTRAINT chk_tenant_styles CHECK (styles <@ ARRAY['scalp','day','swing']::text[]),
  CONSTRAINT chk_tenant_risk CHECK (risk_pct_per_trade > 0 AND risk_pct_per_trade <= 0.05
                                AND max_daily_loss_pct > 0 AND max_daily_loss_pct <= 0.25
                                AND leverage_cap >= 1 AND leverage_cap <= 25)
);
CREATE TRIGGER trg_enforce_ta_bot_customer BEFORE INSERT OR UPDATE OF customer_id, org_id ON ta_bot.tenant_config
  FOR EACH ROW EXECUTE FUNCTION ta_bot.enforce_ta_bot_customer();
CREATE TRIGGER trg_tenant_config_touch BEFORE UPDATE ON ta_bot.tenant_config
  FOR EACH ROW EXECUTE FUNCTION ta_bot.touch_updated_at();

CREATE TABLE ta_bot.trade_plans (
  plan_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid   NOT NULL,
  customer_id  bigint NOT NULL,
  zone_id      uuid REFERENCES ta_bot.confluence_zones(zone_id),
  run_id       uuid REFERENCES ta_bot.analysis_runs(run_id),
  exchange     text NOT NULL,
  symbol       text NOT NULL,
  style        text NOT NULL,
  side         text NOT NULL,                         -- long | short
  entry_low    numeric(38,12) NOT NULL,
  entry_high   numeric(38,12) NOT NULL,
  stop_price   numeric(38,12) NOT NULL,
  tp_levels    jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{price, pct}]
  rr           numeric(8,3),
  probability  numeric(5,4),
  status       text NOT NULL DEFAULT 'proposed',      -- proposed | approved | active | filled | cancelled | expired | closed
  valid_until  timestamptz,
  rationale    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_plan_side CHECK (side IN ('long','short')),
  CONSTRAINT chk_plan_status CHECK (status IN ('proposed','approved','active','filled','cancelled','expired','closed')),
  CONSTRAINT chk_plan_stop CHECK (
    (side = 'long'  AND stop_price < entry_low) OR
    (side = 'short' AND stop_price > entry_high))
);
CREATE INDEX ix_trade_plans_tenant ON ta_bot.trade_plans (org_id, customer_id, status, created_at DESC);
CREATE TRIGGER trg_enforce_ta_bot_customer BEFORE INSERT OR UPDATE OF customer_id, org_id ON ta_bot.trade_plans
  FOR EACH ROW EXECUTE FUNCTION ta_bot.enforce_ta_bot_customer();
CREATE TRIGGER trg_trade_plans_touch BEFORE UPDATE ON ta_bot.trade_plans
  FOR EACH ROW EXECUTE FUNCTION ta_bot.touch_updated_at();

CREATE TABLE ta_bot.positions (
  position_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid   NOT NULL,
  customer_id    bigint NOT NULL,
  plan_id        uuid REFERENCES ta_bot.trade_plans(plan_id),
  exchange       text NOT NULL,
  symbol         text NOT NULL,
  side           text NOT NULL,
  qty            numeric(38,12) NOT NULL,
  avg_entry      numeric(38,12),
  stop_price     numeric(38,12),
  tp_levels      jsonb NOT NULL DEFAULT '[]'::jsonb,
  leverage       numeric(6,2),
  unrealised_pnl numeric(38,8),
  realised_pnl   numeric(38,8),
  status         text NOT NULL DEFAULT 'open',        -- open | closed
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  exchange_snapshot jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_position_side CHECK (side IN ('long','short')),
  CONSTRAINT chk_position_status CHECK (status IN ('open','closed'))
);
CREATE INDEX ix_positions_tenant_open ON ta_bot.positions (org_id, customer_id, status);
CREATE TRIGGER trg_enforce_ta_bot_customer BEFORE INSERT OR UPDATE OF customer_id, org_id ON ta_bot.positions
  FOR EACH ROW EXECUTE FUNCTION ta_bot.enforce_ta_bot_customer();
CREATE TRIGGER trg_positions_touch BEFORE UPDATE ON ta_bot.positions
  FOR EACH ROW EXECUTE FUNCTION ta_bot.touch_updated_at();

CREATE TABLE ta_bot.orders (
  order_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid   NOT NULL,
  customer_id       bigint NOT NULL,
  plan_id           uuid REFERENCES ta_bot.trade_plans(plan_id),
  position_id       uuid REFERENCES ta_bot.positions(position_id),
  exchange          text NOT NULL,
  symbol            text NOT NULL,
  exchange_order_id text,
  order_link_id     text NOT NULL UNIQUE,             -- idempotency key sent to exchange
  side              text NOT NULL,                    -- buy | sell
  order_type        text NOT NULL,                    -- limit | market
  purpose           text NOT NULL,                    -- entry | stop | take_profit | close
  qty               numeric(38,12) NOT NULL,
  price             numeric(38,12),
  trigger_price     numeric(38,12),
  reduce_only       boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'new',      -- new | submitted | partially_filled | filled | cancelled | rejected
  raw_request       jsonb,
  raw_response      jsonb,
  submitted_at      timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_order_side CHECK (side IN ('buy','sell')),
  CONSTRAINT chk_order_type CHECK (order_type IN ('limit','market')),
  CONSTRAINT chk_order_purpose CHECK (purpose IN ('entry','stop','take_profit','close')),
  CONSTRAINT chk_order_status CHECK (status IN ('new','submitted','partially_filled','filled','cancelled','rejected'))
);
CREATE INDEX ix_orders_tenant ON ta_bot.orders (org_id, customer_id, status);
CREATE INDEX ix_orders_exchange_id ON ta_bot.orders (exchange, exchange_order_id);
CREATE TRIGGER trg_enforce_ta_bot_customer BEFORE INSERT OR UPDATE OF customer_id, org_id ON ta_bot.orders
  FOR EACH ROW EXECUTE FUNCTION ta_bot.enforce_ta_bot_customer();
CREATE TRIGGER trg_orders_touch BEFORE UPDATE ON ta_bot.orders
  FOR EACH ROW EXECUTE FUNCTION ta_bot.touch_updated_at();

CREATE TABLE ta_bot.fills (
  fill_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES ta_bot.orders(order_id) ON DELETE CASCADE,
  exchange_exec_id text NOT NULL,
  qty              numeric(38,12) NOT NULL,
  price            numeric(38,12) NOT NULL,
  fee              numeric(38,12),
  fee_asset        text,
  is_maker         boolean,
  executed_at      timestamptz NOT NULL,
  raw              jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_fills_exec ON ta_bot.fills (order_id, exchange_exec_id);

CREATE TABLE ta_bot.trade_events (
  event_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid   NOT NULL,
  customer_id   bigint NOT NULL,
  position_id   uuid REFERENCES ta_bot.positions(position_id),
  plan_id       uuid REFERENCES ta_bot.trade_plans(plan_id),
  agent         text NOT NULL,                        -- analyst | executor | manager | improver | system | admin
  event_type    text NOT NULL,                        -- e.g. plan_created, entry_placed, sl_moved, tp_partial, closed, rejected
  before_state  jsonb,
  after_state   jsonb,
  accepted      boolean NOT NULL DEFAULT true,        -- false when a risk invariant rejected the action
  reject_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_trade_events_tenant ON ta_bot.trade_events (org_id, customer_id, created_at DESC);
CREATE TRIGGER trg_enforce_ta_bot_customer BEFORE INSERT OR UPDATE OF customer_id, org_id ON ta_bot.trade_events
  FOR EACH ROW EXECUTE FUNCTION ta_bot.enforce_ta_bot_customer();

-- ---------------------------------------------------------------------------
-- 6. Agents, improvement loop, external inputs, worker ops
-- ---------------------------------------------------------------------------
CREATE TABLE ta_bot.agent_runs (
  run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent         text NOT NULL,                        -- analyst | executor | manager | improver | market_data | scheduler
  org_id        uuid,
  customer_id   bigint,
  symbol        text,
  status        text NOT NULL DEFAULT 'running',      -- running | ok | error
  model         text,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10,6),
  prompt        text,
  response      text,
  error         text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX ix_agent_runs_agent ON ta_bot.agent_runs (agent, started_at DESC);

CREATE TABLE ta_bot.improvement_proposals (
  proposal_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid REFERENCES ta_bot.agent_runs(run_id),
  kind          text NOT NULL,                        -- param_change | new_tool | disable_tool | weight_change
  title         text NOT NULL,
  payload       jsonb NOT NULL,
  evidence      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- back-test metrics, sample trades
  bt_run_id     uuid,
  status        text NOT NULL DEFAULT 'proposed',     -- proposed | approved | rejected | applied
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_proposal_kind CHECK (kind IN ('param_change','new_tool','disable_tool','weight_change')),
  CONSTRAINT chk_proposal_status CHECK (status IN ('proposed','approved','rejected','applied'))
);

CREATE TABLE ta_bot.tv_webhook_events (
  event_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at  timestamptz NOT NULL DEFAULT now(),
  source_ip    text,
  tv_symbol    text,
  payload      jsonb NOT NULL,
  processed_at timestamptz,
  verdict      text
);

CREATE TABLE ta_bot.worker_heartbeat (
  worker_id    text PRIMARY KEY,
  version      text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- 7. Back-testing schema
-- ---------------------------------------------------------------------------
CREATE TABLE ta_bot_bt.bt_runs (
  bt_run_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid,
  label        text,
  exchange     text NOT NULL,
  symbol       text NOT NULL,
  style        text NOT NULL,
  from_ts      timestamptz NOT NULL,
  to_ts        timestamptz NOT NULL,
  params       jsonb NOT NULL,                        -- tool set, weights, risk, execution assumptions
  status       text NOT NULL DEFAULT 'queued',        -- queued | running | ok | error
  metrics      jsonb,                                 -- net_return, sharpe, max_dd, win_rate, profit_factor, brier
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE TABLE ta_bot_bt.bt_trades (
  bt_trade_id  bigserial PRIMARY KEY,
  bt_run_id    uuid NOT NULL REFERENCES ta_bot_bt.bt_runs(bt_run_id) ON DELETE CASCADE,
  side         text NOT NULL,
  entry_ts     timestamptz NOT NULL,
  entry_price  numeric(38,12) NOT NULL,
  exit_ts      timestamptz,
  exit_price   numeric(38,12),
  qty          numeric(38,12) NOT NULL,
  stop_price   numeric(38,12),
  pnl          numeric(38,8),
  r_multiple   numeric(10,4),
  exit_reason  text,
  zone         jsonb
);
CREATE INDEX ix_bt_trades_run ON ta_bot_bt.bt_trades (bt_run_id);

CREATE TABLE ta_bot_bt.bt_equity (
  bt_run_id  uuid NOT NULL REFERENCES ta_bot_bt.bt_runs(bt_run_id) ON DELETE CASCADE,
  ts         timestamptz NOT NULL,
  equity     numeric(38,8) NOT NULL,
  drawdown   numeric(10,6),
  PRIMARY KEY (bt_run_id, ts)
);

CREATE TABLE ta_bot_bt.bt_zone_outcomes (
  bt_run_id   uuid NOT NULL REFERENCES ta_bot_bt.bt_runs(bt_run_id) ON DELETE CASCADE,
  zone_ts     timestamptz NOT NULL,
  price_low   numeric(38,12) NOT NULL,
  price_high  numeric(38,12) NOT NULL,
  score       numeric(10,4) NOT NULL,
  tool_codes  text[] NOT NULL,
  outcome     text NOT NULL,
  mfe_atr     numeric(10,4),
  mae_atr     numeric(10,4)
);
CREATE INDEX ix_bt_zone_outcomes_run ON ta_bot_bt.bt_zone_outcomes (bt_run_id);

-- ---------------------------------------------------------------------------
-- 8. Lock-down: RLS on (deny-all) + revoke from browser roles
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('ta_bot','ta_bot_bt') LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
    EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC, anon, authenticated', r.schemaname, r.tablename);
    EXECUTE format('GRANT ALL ON %I.%I TO service_role', r.schemaname, r.tablename);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ta_bot_bt TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Tenant exchange credentials (service-role only)
--    Exchange accounts stay in public.exchange_accounts (strategy-agnostic);
--    keys live in Vault via api_key_vault_id / api_secret_vault_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ta_bot.get_tenant_exchange_credentials(p_org_id uuid, p_customer_id bigint)
RETURNS TABLE(exchange text, api_key text, api_secret text, exchange_account_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'ta_bot', 'public', 'vault'
AS $$
DECLARE
  v_exchange text; v_acct uuid; v_key_id uuid; v_sec_id uuid; v_key text; v_sec text;
BEGIN
  SELECT ea.exchange, ea.exchange_account_id, ea.api_key_vault_id, ea.api_secret_vault_id
    INTO v_exchange, v_acct, v_key_id, v_sec_id
    FROM public.customer_strategies cs
    JOIN public.exchange_accounts ea ON ea.exchange_account_id = cs.exchange_account_id
   WHERE cs.org_id = p_org_id AND cs.customer_id = p_customer_id AND cs.strategy_code = 'TA_BOT'
   ORDER BY cs.effective_from DESC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No TA_BOT exchange account for org=% customer=%', p_org_id, p_customer_id;
  END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE id = v_key_id;
  SELECT decrypted_secret INTO v_sec FROM vault.decrypted_secrets WHERE id = v_sec_id;
  IF v_key IS NULL OR v_sec IS NULL THEN
    RAISE EXCEPTION 'Vault secret missing for TA_BOT customer=% (account=%)', p_customer_id, v_acct;
  END IF;

  RETURN QUERY SELECT v_exchange, v_key, v_sec, v_acct;
END $$;

REVOKE ALL ON FUNCTION ta_bot.get_tenant_exchange_credentials(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ta_bot.get_tenant_exchange_credentials(uuid, bigint) TO service_role;
REVOKE ALL ON FUNCTION ta_bot.enforce_ta_bot_customer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ta_bot.touch_updated_at() FROM PUBLIC, anon, authenticated;
