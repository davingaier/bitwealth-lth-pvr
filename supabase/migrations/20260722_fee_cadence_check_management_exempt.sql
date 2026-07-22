-- ============================================================================
-- Fee-cadence check: exempt the MANAGEMENT plan
-- Date: 2026-07-22
-- Purpose: On the management fee plan the platform fee is NOT charged, so its
--          schedule is irrelevant and must not be considered. The existing
--          customer_strategies_fee_cadence_check enforced
--          rank(platform) <= rank(performance) regardless of plan, which blocked
--          allocating a management-plan strategy whenever the (unused) platform
--          schedule was less frequent than the performance schedule
--          (e.g. platform 'annual' vs performance 'monthly' → constraint fail).
--
-- Fix: skip the cadence comparison when fee_plan = 'management'. The rule still
--      applies in full on the platform plan (where the platform fee is live).
-- ============================================================================

ALTER TABLE public.customer_strategies
  DROP CONSTRAINT IF EXISTS customer_strategies_fee_cadence_check;

ALTER TABLE public.customer_strategies
  ADD CONSTRAINT customer_strategies_fee_cadence_check
    CHECK (
      fee_plan = 'management'
      OR platform_fee_schedule IS NULL
      OR performance_fee_schedule IS NULL
      OR public.fee_schedule_rank(platform_fee_schedule)
         <= public.fee_schedule_rank(performance_fee_schedule)
    );
