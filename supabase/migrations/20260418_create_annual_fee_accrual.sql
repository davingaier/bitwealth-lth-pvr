-- Migration: Create annual fee accrual table + RPC functions
-- Purpose: Track accrued platform and performance fees for customers on annual billing schedules
-- Date: 2026-04-18

-- ─────────────────────────────────────────────────────────────
-- 1. Table: lth_pvr.annual_fee_accrual
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lth_pvr.annual_fee_accrual (
  accrual_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL,
  customer_id       BIGINT NOT NULL REFERENCES public.customer_details(customer_id),
  accrual_year      INT NOT NULL,

  -- Platform fees: accumulated throughout the year from ef_post_ledger_and_balances
  accrued_platform_fee_btc   NUMERIC(38,8) NOT NULL DEFAULT 0,
  accrued_platform_fee_usdt  NUMERIC(38,8) NOT NULL DEFAULT 0,

  -- Performance fee: calculated at year-end by ef_collect_annual_fees
  accrued_performance_fee_usdt  NUMERIC(38,8) NOT NULL DEFAULT 0,
  performance_fee_calculated_at TIMESTAMPTZ,

  -- Settlement tracking
  settled_at              TIMESTAMPTZ,           -- NULL until all fees collected
  settlement_ledger_ids   UUID[],                -- references to ledger_lines entries
  settlement_transfer_ids UUID[],                -- references to valr_transfer_log entries
  settlement_notes        TEXT,

  -- Timestamps
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per customer per year
  UNIQUE(org_id, customer_id, accrual_year)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_annual_fee_accrual_unsettled
  ON lth_pvr.annual_fee_accrual (accrual_year, customer_id)
  WHERE settled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_annual_fee_accrual_customer
  ON lth_pvr.annual_fee_accrual (customer_id, accrual_year);

-- ─────────────────────────────────────────────────────────────
-- 2. RPC: Accumulate a single platform fee amount (called by ef_post_ledger)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lth_pvr.accumulate_annual_platform_fee(
  p_org_id       UUID,
  p_customer_id  BIGINT,
  p_fee_btc      NUMERIC DEFAULT 0,
  p_fee_usdt     NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
BEGIN
  INSERT INTO lth_pvr.annual_fee_accrual (
    org_id, customer_id, accrual_year,
    accrued_platform_fee_btc, accrued_platform_fee_usdt
  )
  VALUES (
    p_org_id, p_customer_id, v_year,
    COALESCE(p_fee_btc, 0), COALESCE(p_fee_usdt, 0)
  )
  ON CONFLICT (org_id, customer_id, accrual_year)
  DO UPDATE SET
    accrued_platform_fee_btc  = lth_pvr.annual_fee_accrual.accrued_platform_fee_btc  + COALESCE(p_fee_btc, 0),
    accrued_platform_fee_usdt = lth_pvr.annual_fee_accrual.accrued_platform_fee_usdt + COALESCE(p_fee_usdt, 0),
    updated_at = NOW();
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC: Get accrual summary for Admin UI
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lth_pvr.get_annual_fee_accruals(
  p_accrual_year INT DEFAULT NULL
)
RETURNS TABLE (
  accrual_id          UUID,
  customer_id         BIGINT,
  first_name          TEXT,
  last_name           TEXT,
  accrual_year        INT,
  accrued_platform_fee_btc   NUMERIC,
  accrued_platform_fee_usdt  NUMERIC,
  accrued_performance_fee_usdt NUMERIC,
  performance_fee_calculated_at TIMESTAMPTZ,
  settled_at          TIMESTAMPTZ,
  settlement_notes    TEXT,
  updated_at          TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    afa.accrual_id,
    afa.customer_id,
    cd.first_names AS first_name,
    cd.last_name,
    afa.accrual_year,
    afa.accrued_platform_fee_btc,
    afa.accrued_platform_fee_usdt,
    afa.accrued_performance_fee_usdt,
    afa.performance_fee_calculated_at,
    afa.settled_at,
    afa.settlement_notes,
    afa.updated_at
  FROM lth_pvr.annual_fee_accrual afa
  JOIN public.customer_details cd ON afa.customer_id = cd.customer_id
  WHERE afa.accrual_year = COALESCE(p_accrual_year, EXTRACT(YEAR FROM CURRENT_DATE)::INT)
  ORDER BY afa.customer_id;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. Add 'annual_platform_fee' and 'annual_performance_fee' to
--    valr_transfer_log.transfer_type CHECK constraint
-- ─────────────────────────────────────────────────────────────
ALTER TABLE lth_pvr.valr_transfer_log
  DROP CONSTRAINT IF EXISTS valr_transfer_log_transfer_type_check;

ALTER TABLE lth_pvr.valr_transfer_log
  ADD CONSTRAINT valr_transfer_log_transfer_type_check
  CHECK (transfer_type IN (
    'platform_fee', 'performance_fee', 'manual',
    'fee_batch', 'platform_fee_batch',
    'annual_platform_fee', 'annual_performance_fee'
  ));

-- ─────────────────────────────────────────────────────────────
-- 5. Cron job: Annual fee collection on Jan 2 at 06:00 UTC
--    (day after year-end, after all Dec 31 pipeline processing)
-- ─────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'annual-fee-collection',
  '0 6 2 1 *',
  $$SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_collect_annual_fees',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )$$
);

COMMENT ON TABLE lth_pvr.annual_fee_accrual IS
  'Tracks accrued platform and performance fees for customers on annual billing schedules. '
  'Platform fees are accumulated throughout the year by ef_post_ledger_and_balances. '
  'Performance fees are calculated at year-end by ef_collect_annual_fees. '
  'Settlement (collection) is triggered by the annual-fee-collection cron job on Jan 2.';
