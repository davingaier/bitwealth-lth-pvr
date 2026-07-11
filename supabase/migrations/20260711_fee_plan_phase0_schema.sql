-- ============================================================================
-- Fee-Plan Choice — Phase 0 (additive schema, no behaviour change)
-- Date: 2026-07-11
-- Purpose: Introduce the "Management fee (1%) OR Platform fee (0.75%)" choice.
--          Existing clients are GRANDFATHERED onto the platform plan; new
--          clients default to the management plan. Adds a `quarterly` schedule
--          to platform + performance + (new) management fee cadences.
--
-- This migration is PURELY ADDITIVE and safe to run on production:
--   * new columns have defaults (metadata-only on PG11+),
--   * CHECK constraints only EXPAND allowed value sets,
--   * a new effective-dated history table is created + backfilled.
-- No fee is charged differently until Phase 1 wires the accounting logic.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. fee_schedule_rank(): add 'quarterly' (between monthly and annual)
--    Renumber annual 3 -> 4; ordering preserved so the existing
--    customer_strategies_fee_cadence_check (platform rank <= perf rank) holds.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fee_schedule_rank(sched text)
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
AS $function$
  SELECT CASE sched
           WHEN 'immediate' THEN 1
           WHEN 'monthly'   THEN 2
           WHEN 'quarterly' THEN 3
           WHEN 'annual'    THEN 4
           ELSE NULL
         END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. public.customer_strategies — fee-plan discriminator + management columns
-- ----------------------------------------------------------------------------

-- 2a. fee_plan discriminator. ADD with default 'platform' so every EXISTING
--     row is grandfathered onto the platform plan, THEN switch the default to
--     'management' for all future (new-client) rows.
ALTER TABLE public.customer_strategies
  ADD COLUMN IF NOT EXISTS fee_plan text NOT NULL DEFAULT 'platform';

ALTER TABLE public.customer_strategies
  ALTER COLUMN fee_plan SET DEFAULT 'management';

ALTER TABLE public.customer_strategies
  DROP CONSTRAINT IF EXISTS customer_strategies_fee_plan_check;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT customer_strategies_fee_plan_check
    CHECK (fee_plan IN ('platform','management'));

-- 2b. management_fee_rate (default 1.00% p.a.) + management_fee_schedule
ALTER TABLE public.customer_strategies
  ADD COLUMN IF NOT EXISTS management_fee_rate numeric NOT NULL DEFAULT 0.01;

ALTER TABLE public.customer_strategies
  ADD COLUMN IF NOT EXISTS management_fee_schedule text NOT NULL DEFAULT 'monthly';

ALTER TABLE public.customer_strategies
  DROP CONSTRAINT IF EXISTS customer_strategies_management_fee_schedule_check;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT customer_strategies_management_fee_schedule_check
    CHECK (management_fee_schedule IN ('monthly','quarterly','annual'));

-- 2c. Extend fee-rate bounds check to include management_fee_rate
ALTER TABLE public.customer_strategies
  DROP CONSTRAINT IF EXISTS chk_customer_strategies_fee_rates;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT chk_customer_strategies_fee_rates
    CHECK (
      performance_fee_rate >= 0 AND performance_fee_rate <= 1
      AND platform_fee_rate >= 0 AND platform_fee_rate <= 1
      AND management_fee_rate >= 0 AND management_fee_rate <= 1
    );

-- 2d. Add 'quarterly' to platform + performance schedule checks
ALTER TABLE public.customer_strategies
  DROP CONSTRAINT IF EXISTS customer_strategies_platform_fee_schedule_check;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT customer_strategies_platform_fee_schedule_check
    CHECK (platform_fee_schedule IN ('immediate','monthly','quarterly','annual'));

ALTER TABLE public.customer_strategies
  DROP CONSTRAINT IF EXISTS customer_strategies_performance_fee_schedule_check;
ALTER TABLE public.customer_strategies
  ADD CONSTRAINT customer_strategies_performance_fee_schedule_check
    CHECK (performance_fee_schedule IN ('monthly','quarterly','annual'));

COMMENT ON COLUMN public.customer_strategies.fee_plan IS
  'Which BitWealth fee plan applies: platform (0.75% on contributions) OR management (1% p.a. on NAV). Exactly one is charged; performance fee + exchange rebate apply to both.';
COMMENT ON COLUMN public.customer_strategies.management_fee_rate IS
  'Annual management fee rate (default 0.01 = 1% p.a.). Charged as NAV x rate / 12 at period end when fee_plan = management.';
COMMENT ON COLUMN public.customer_strategies.management_fee_schedule IS
  'Management fee cadence: monthly (deduct), quarterly (accrue, calendar quarters), annual (accrue).';

-- ----------------------------------------------------------------------------
-- 3. lth_pvr.ledger_lines — management fee amount column + kinds
-- ----------------------------------------------------------------------------
ALTER TABLE lth_pvr.ledger_lines
  ADD COLUMN IF NOT EXISTS management_fee_usdt numeric NOT NULL DEFAULT 0;

ALTER TABLE lth_pvr.ledger_lines
  DROP CONSTRAINT IF EXISTS ledger_lines_kind_check;
ALTER TABLE lth_pvr.ledger_lines
  ADD CONSTRAINT ledger_lines_kind_check CHECK (
    kind = ANY (ARRAY[
      'topup'::text,'deposit'::text,'withdrawal'::text,'buy'::text,'sell'::text,
      'fee'::text,'performance_fee'::text,'performance_fee_reversal'::text,
      'management_fee'::text,'management_fee_reversal'::text,
      'transfer'::text,'adjustment'::text,'convert'::text
    ])
  );

COMMENT ON COLUMN lth_pvr.ledger_lines.management_fee_usdt IS
  'Management fee charged in USDT terms (mirrors performance_fee_usdt). Non-zero on kind=management_fee / management_fee_reversal.';

-- ----------------------------------------------------------------------------
-- 4. lth_pvr.customer_state_daily — track last management-fee period charged
-- ----------------------------------------------------------------------------
ALTER TABLE lth_pvr.customer_state_daily
  ADD COLUMN IF NOT EXISTS last_management_fee_period date;

COMMENT ON COLUMN lth_pvr.customer_state_daily.last_management_fee_period IS
  'Last period-end (month/quarter/year end) for which a management fee was charged. Prevents double-charging (mirrors last_perf_fee_month).';

-- ----------------------------------------------------------------------------
-- 5. public.customer_fee_plan_history — effective-dated fee-plan history
--    (plan switches are allowed; statements & fee-calc resolve the plan in
--     force for the relevant period from this table).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_fee_plan_history (
  history_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL,
  customer_id               bigint NOT NULL REFERENCES public.customer_details(customer_id) ON DELETE CASCADE,
  strategy_code             text NOT NULL DEFAULT 'LTH_PVR',
  fee_plan                  text NOT NULL CHECK (fee_plan IN ('platform','management')),
  platform_fee_rate         numeric,
  platform_fee_schedule     text,
  management_fee_rate        numeric,
  management_fee_schedule    text,
  performance_fee_rate       numeric,
  performance_fee_schedule   text,
  effective_from            date NOT NULL,
  effective_to              date,               -- NULL = current
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                text,
  note                      text
);

CREATE INDEX IF NOT EXISTS idx_customer_fee_plan_history_cust
  ON public.customer_fee_plan_history (customer_id, effective_from);

-- Only one open (effective_to IS NULL) row per customer+strategy
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_fee_plan_history_open
  ON public.customer_fee_plan_history (customer_id, strategy_code)
  WHERE effective_to IS NULL;

COMMENT ON TABLE public.customer_fee_plan_history IS
  'Effective-dated history of each customer''s fee plan + rates/schedules. Appended on every change; the open row (effective_to IS NULL) is the current plan. Plan switches take effect at the start of the next calendar month.';

-- 5a. Backfill: one open row per existing LTH_PVR strategy, grandfathered to platform.
INSERT INTO public.customer_fee_plan_history (
  org_id, customer_id, strategy_code, fee_plan,
  platform_fee_rate, platform_fee_schedule,
  management_fee_rate, management_fee_schedule,
  performance_fee_rate, performance_fee_schedule,
  effective_from, effective_to, note
)
SELECT
  cs.org_id, cs.customer_id, cs.strategy_code, 'platform',
  cs.platform_fee_rate, cs.platform_fee_schedule,
  cs.management_fee_rate, cs.management_fee_schedule,
  cs.performance_fee_rate, cs.performance_fee_schedule,
  COALESCE(cs.created_at::date, CURRENT_DATE), NULL,
  'Phase 0 backfill: grandfathered to platform plan'
FROM public.customer_strategies cs
WHERE cs.strategy_code = 'LTH_PVR'
  AND NOT EXISTS (
    SELECT 1 FROM public.customer_fee_plan_history h
    WHERE h.customer_id = cs.customer_id
      AND h.strategy_code = cs.strategy_code
      AND h.effective_to IS NULL
  );

-- ----------------------------------------------------------------------------
-- 6. lth_pvr.annual_fee_accrual — accrue management fee (quarterly/annual)
-- ----------------------------------------------------------------------------
ALTER TABLE lth_pvr.annual_fee_accrual
  ADD COLUMN IF NOT EXISTS accrued_management_fee_usdt numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN lth_pvr.annual_fee_accrual.accrued_management_fee_usdt IS
  'Accrued management fee (USDT) for a quarterly/annual accrual period, settled at period end.';

-- ----------------------------------------------------------------------------
-- 7. lth_pvr.fee_invoices — management fee accumulation/transfer tracking
-- ----------------------------------------------------------------------------
ALTER TABLE lth_pvr.fee_invoices
  ADD COLUMN IF NOT EXISTS management_fees_accumulated_usdt numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS management_fees_accumulated_btc  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS management_fees_transferred_usdt numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS management_fees_transferred_btc  numeric NOT NULL DEFAULT 0;
