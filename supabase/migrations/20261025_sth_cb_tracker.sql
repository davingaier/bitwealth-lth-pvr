-- ============================================================================
-- STH_CB strategy tracker — daily "paper" record of the hybrid v1 strategy
-- ----------------------------------------------------------------------------
-- sth_cb.tracker_config : which configuration(s) to track (extras jsonb = SthCbConfig flags)
-- sth_cb.tracker_daily  : one row per close date, rebuilt daily by ef_sth_cb_tracker
--                         (chained from ef_fetch_onchain_pvr after the RB data lands)
-- Read by the Admin UI (On-Chain Charts → "STH CB Hybrid — Strategy Tracker").
-- Security: service-role only tables; browser reads via my_orgs()-guarded RPCs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sth_cb.tracker_config (
  org_id        uuid NOT NULL,
  tracker_key   text NOT NULL,
  label         text NOT NULL,
  start_date    date NOT NULL DEFAULT '2017-01-01',
  upfront_usdt  numeric NOT NULL DEFAULT 1000,
  monthly_usdt  numeric NOT NULL DEFAULT 0,
  fee_plan      text NOT NULL DEFAULT 'management',
  management_fee_pct  numeric NOT NULL DEFAULT 0.01,
  performance_fee_pct numeric NOT NULL DEFAULT 0.10,
  platform_fee_pct    numeric NOT NULL DEFAULT 0.0075,
  maker_bps_trade     numeric NOT NULL DEFAULT 8,
  maker_bps_contrib   numeric NOT NULL DEFAULT 18,
  usdpc_enabled       boolean NOT NULL DEFAULT true,
  usdpc_apy_percent   numeric NOT NULL DEFAULT 10,
  usdpc_conversion_fee_percent numeric NOT NULL DEFAULT 0.1,
  execution_lag_days  integer NOT NULL DEFAULT 1,
  extras        jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, tracker_key)
);

INSERT INTO sth_cb.tracker_config (org_id, tracker_key, label, extras)
VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 'hybrid_v1', 'STH CB Hybrid v1 (optimised 2026-10-25)',
  '{"capBuyRatio":0.75,"capExitRatio":0.95,"trendEnterRatio":1.12,"trendExitRatio":0.97,"momoLength":2,"momoThreshold":-0.02,
    "distributeAtSigma":2.5,"cbSlopeDays":21,"trailingStopPct":0.35,"reentryRocThreshold":0.1,"minHoldDays":15,
    "blockEntryAboveSigma":2.5,"distReentryClearRatio":0.9,"capBuyAtLthSigma":-0.5,"trendReentryRatio":1.02,
    "capBuyRocThreshold":0,"sellTiers":[{"ratio":2,"alloc":0}]}'::jsonb
)
ON CONFLICT (org_id, tracker_key) DO UPDATE SET extras = EXCLUDED.extras, label = EXCLUDED.label, updated_at = now();

CREATE TABLE IF NOT EXISTS sth_cb.tracker_daily (
  org_id            uuid NOT NULL,
  tracker_key       text NOT NULL,
  date              date NOT NULL,            -- close date (signal date)
  price_usd         numeric,
  sth_cost_basis_usd numeric,
  price_to_cb_ratio numeric,
  lth_m050          numeric,                  -- LTH PVR −0.5σ band (capitulation trigger)
  lth_p250          numeric,                  -- LTH PVR +2.5σ band (distribution trigger)
  position_state    text NOT NULL,            -- cash | cap_hold | trend_hold (held after this day's execution)
  signal_in_market  boolean NOT NULL,         -- decision at this close (executed next day)
  signal_rule       text,
  signal_note       text,
  target_alloc      numeric,
  action            text NOT NULL,            -- BUY | SELL | HOLD executed on this date
  rule              text,
  nav_usd           numeric,
  hodl_nav_usd      numeric,
  btc_balance       numeric,
  cash_usd          numeric,                  -- USDT + USDPC value
  roc               numeric,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, tracker_key, date)
);
CREATE INDEX IF NOT EXISTS tracker_daily_key_date_idx ON sth_cb.tracker_daily (org_id, tracker_key, date);

ALTER TABLE sth_cb.tracker_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sth_cb.tracker_daily  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sth_cb.tracker_config, sth_cb.tracker_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON sth_cb.tracker_config, sth_cb.tracker_daily TO service_role;

-- Browser RPCs --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sth_cb_tracker_list()
RETURNS SETOF sth_cb.tracker_config
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM sth_cb.tracker_config c
  WHERE c.org_id IN (SELECT id FROM public.my_orgs()) AND c.is_active
  ORDER BY c.tracker_key;
$$;

CREATE OR REPLACE FUNCTION public.sth_cb_tracker_series(p_tracker_key text DEFAULT 'hybrid_v1', p_from date DEFAULT NULL)
RETURNS SETOF sth_cb.tracker_daily
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT d.* FROM sth_cb.tracker_daily d
  WHERE d.org_id IN (SELECT id FROM public.my_orgs())
    AND d.tracker_key = p_tracker_key
    AND (p_from IS NULL OR d.date >= p_from)
  ORDER BY d.date;
$$;

GRANT EXECUTE ON FUNCTION public.sth_cb_tracker_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sth_cb_tracker_series(text, date) TO authenticated;

COMMENT ON TABLE sth_cb.tracker_daily IS 'Daily paper-trading record of tracked STH_CB configurations; rebuilt by ef_sth_cb_tracker (chained from ef_fetch_onchain_pvr).';
