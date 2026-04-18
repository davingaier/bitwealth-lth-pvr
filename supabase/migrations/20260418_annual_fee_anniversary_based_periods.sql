-- Migration: Switch annual fee accrual from calendar-year to anniversary-based periods
-- The anniversary date is derived from customer_strategies.effective_from
-- Date: 2026-04-18

-- 1. Add period columns
ALTER TABLE lth_pvr.annual_fee_accrual
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end   DATE;

-- 2. Drop old unique constraint, add new one based on period_start
ALTER TABLE lth_pvr.annual_fee_accrual
  DROP CONSTRAINT IF EXISTS annual_fee_accrual_org_id_customer_id_accrual_year_key;

ALTER TABLE lth_pvr.annual_fee_accrual
  ADD CONSTRAINT annual_fee_accrual_org_customer_period
  UNIQUE (org_id, customer_id, period_start);

-- 3. Drop/recreate indexes for period-based queries
DROP INDEX IF EXISTS lth_pvr.idx_annual_fee_accrual_unsettled;
CREATE INDEX idx_annual_fee_accrual_unsettled
  ON lth_pvr.annual_fee_accrual (period_end, customer_id)
  WHERE settled_at IS NULL;

-- 4. Rewrite accumulate_annual_platform_fee to compute period from effective_from
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
  v_effective_from DATE;
  v_years_elapsed  INT;
  v_period_start   DATE;
  v_period_end     DATE;
  v_accrual_year   INT;
BEGIN
  SELECT effective_from INTO v_effective_from
  FROM public.customer_strategies
  WHERE customer_id = p_customer_id
    AND org_id = p_org_id
    AND status = 'active'
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_effective_from IS NULL THEN
    v_effective_from := make_date(EXTRACT(YEAR FROM CURRENT_DATE)::INT, 1, 1);
  END IF;

  v_years_elapsed := EXTRACT(YEAR FROM age(CURRENT_DATE, v_effective_from))::INT;
  v_period_start := (v_effective_from + (v_years_elapsed || ' years')::INTERVAL)::DATE;

  IF v_period_start > CURRENT_DATE THEN
    v_period_start := (v_period_start - INTERVAL '1 year')::DATE;
  END IF;

  v_period_end   := (v_period_start + INTERVAL '1 year' - INTERVAL '1 day')::DATE;
  v_accrual_year := EXTRACT(YEAR FROM v_period_start)::INT;

  INSERT INTO lth_pvr.annual_fee_accrual (
    org_id, customer_id, accrual_year, period_start, period_end,
    accrued_platform_fee_btc, accrued_platform_fee_usdt
  )
  VALUES (
    p_org_id, p_customer_id, v_accrual_year, v_period_start, v_period_end,
    COALESCE(p_fee_btc, 0), COALESCE(p_fee_usdt, 0)
  )
  ON CONFLICT (org_id, customer_id, period_start)
  DO UPDATE SET
    accrued_platform_fee_btc  = lth_pvr.annual_fee_accrual.accrued_platform_fee_btc  + COALESCE(p_fee_btc, 0),
    accrued_platform_fee_usdt = lth_pvr.annual_fee_accrual.accrued_platform_fee_usdt + COALESCE(p_fee_usdt, 0),
    updated_at = NOW();
END;
$$;

-- 5. Drop and recreate get_annual_fee_accruals with period columns
DROP FUNCTION IF EXISTS lth_pvr.get_annual_fee_accruals(INT);

CREATE OR REPLACE FUNCTION lth_pvr.get_annual_fee_accruals(
  p_accrual_year INT DEFAULT NULL
)
RETURNS TABLE (
  accrual_id          UUID,
  customer_id         BIGINT,
  first_name          TEXT,
  last_name           TEXT,
  accrual_year        INT,
  period_start        DATE,
  period_end          DATE,
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
    cd.first_names,
    cd.last_name,
    afa.accrual_year,
    afa.period_start,
    afa.period_end,
    afa.accrued_platform_fee_btc,
    afa.accrued_platform_fee_usdt,
    afa.accrued_performance_fee_usdt,
    afa.performance_fee_calculated_at,
    afa.settled_at,
    afa.settlement_notes,
    afa.updated_at
  FROM lth_pvr.annual_fee_accrual afa
  JOIN public.customer_details cd ON afa.customer_id = cd.customer_id
  WHERE (p_accrual_year IS NULL OR afa.accrual_year = p_accrual_year)
  ORDER BY afa.period_end DESC, afa.customer_id;
$$;

-- 6. Change cron from "Jan 2 only" to daily at 06:00 UTC
SELECT cron.unschedule('annual-fee-collection');

SELECT cron.schedule(
  'annual-fee-collection',
  '0 6 * * *',
  $$SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_collect_annual_fees',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )$$
);
