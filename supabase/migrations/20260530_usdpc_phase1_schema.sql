-- USDPC yield-stablecoin feature — Phase 1: schema
-- Adds USDPC tracking to the live ledger/balances, the funding-event asset set,
-- a daily USDPC market-price table, and back-test parameter/result columns.
-- All changes are additive & backward-compatible (COALESCE(...,0) defaults).

-- ── Live ledger ──────────────────────────────────────────────────────────────
ALTER TABLE lth_pvr.ledger_lines
  ADD COLUMN IF NOT EXISTS amount_usdpc numeric(38, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_usdpc    numeric(38, 8) NOT NULL DEFAULT 0;

-- Allow the new 'convert' kind for USDPC<->USDT conversions.
ALTER TABLE lth_pvr.ledger_lines DROP CONSTRAINT IF EXISTS ledger_lines_kind_check;
ALTER TABLE lth_pvr.ledger_lines ADD CONSTRAINT ledger_lines_kind_check CHECK (
  kind = ANY (ARRAY[
    'topup'::text, 'deposit'::text, 'withdrawal'::text, 'buy'::text, 'sell'::text,
    'fee'::text, 'performance_fee'::text, 'performance_fee_reversal'::text,
    'transfer'::text, 'adjustment'::text, 'convert'::text
  ])
);

-- ── Live daily balances ──────────────────────────────────────────────────────
ALTER TABLE lth_pvr.balances_daily
  ADD COLUMN IF NOT EXISTS usdpc_balance   numeric(38, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usdpc_price_usd numeric(38, 8);

COMMENT ON COLUMN lth_pvr.balances_daily.usdpc_balance IS
  'End-of-day USDPC units held. Valued at usdpc_price_usd and included in nav_usd.';
COMMENT ON COLUMN lth_pvr.balances_daily.usdpc_price_usd IS
  'USDPC/USDT market price used to value usdpc_balance on this date (NULL before feature enabled).';

-- ── Funding events: allow USDPC asset + internal conversion kind ──────────────
ALTER TABLE lth_pvr.exchange_funding_events DROP CONSTRAINT IF EXISTS exchange_funding_events_asset_check;
ALTER TABLE lth_pvr.exchange_funding_events ADD CONSTRAINT exchange_funding_events_asset_check
  CHECK (asset = ANY (ARRAY['USDT'::text, 'BTC'::text, 'ZAR'::text, 'USDPC'::text]));

ALTER TABLE lth_pvr.exchange_funding_events DROP CONSTRAINT IF EXISTS exchange_funding_events_kind_check;
ALTER TABLE lth_pvr.exchange_funding_events ADD CONSTRAINT exchange_funding_events_kind_check
  CHECK (kind = ANY (ARRAY[
    'deposit'::text, 'withdrawal'::text,
    'zar_deposit'::text, 'zar_balance'::text, 'zar_withdrawal'::text,
    'conversion'::text
  ]));

-- ── Daily USDPC market price (live valuation source) ──────────────────────────
CREATE TABLE IF NOT EXISTS lth_pvr.usdpc_prices_daily (
  date        date NOT NULL,
  price_usd   numeric(38, 8) NOT NULL,
  source      text NOT NULL DEFAULT 'valr',
  fetched_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT usdpc_prices_daily_pkey PRIMARY KEY (date)
);

COMMENT ON TABLE lth_pvr.usdpc_prices_daily IS
  'Daily USDPC/USDT market price from VALR, used to value USDPC holdings in NAV.';

-- ── Back-test parameters (fixed-APY model) ───────────────────────────────────
ALTER TABLE lth_pvr_bt.bt_params
  ADD COLUMN IF NOT EXISTS usdpc_enabled                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usdpc_apy_percent            numeric NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS usdpc_conversion_fee_percent numeric NOT NULL DEFAULT 0.1;

-- ── Back-test daily results ──────────────────────────────────────────────────
ALTER TABLE lth_pvr_bt.bt_results_daily
  ADD COLUMN IF NOT EXISTS usdpc_balance             numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usdpc_price_usd           numeric,
  ADD COLUMN IF NOT EXISTS usdpc_yield_usdt          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usdpc_conversion_fee_usdt numeric NOT NULL DEFAULT 0;
