-- Migration: Drop obsolete fee_configs table
-- Date: 2026-02-02
-- Purpose: Remove lth_pvr.fee_configs after consolidating to public.customer_strategies
-- Prerequisite: Migration 20260202_consolidate_fee_management_v2.sql applied and tested

-- ============================================================================
-- SAFETY CHECK: Verify customer_strategies has fee data
-- ============================================================================

DO $$
DECLARE
  v_strategies_count INT;
  v_configs_count INT;
BEGIN
  -- Count customer_strategies with fee rates
  SELECT COUNT(*) INTO v_strategies_count
  FROM public.customer_strategies
  WHERE strategy_code = 'LTH_PVR'
    AND (performance_fee_rate IS NOT NULL OR platform_fee_rate IS NOT NULL);

  -- Count old fee_configs
  SELECT COUNT(*) INTO v_configs_count
  FROM lth_pvr.fee_configs;

  -- Log counts for verification
  RAISE NOTICE 'customer_strategies with fees: %, old fee_configs: %', 
    v_strategies_count, v_configs_count;

  -- Safety check: Ensure data was migrated
  IF v_strategies_count = 0 AND v_configs_count > 0 THEN
    RAISE EXCEPTION 'SAFETY CHECK FAILED: customer_strategies has no fee data but fee_configs exists. Run consolidate_fee_management migration first.';
  END IF;
END $$;

-- ============================================================================
-- DROP TABLE: lth_pvr.fee_configs
-- ============================================================================

-- Drop the obsolete fee_configs table
DROP TABLE IF EXISTS lth_pvr.fee_configs CASCADE;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Successfully dropped lth_pvr.fee_configs table. Fee management now uses public.customer_strategies exclusively.';
END $$;

-- ============================================================================
-- VERIFICATION QUERIES (commented out - uncomment to verify)
-- ============================================================================

-- Verify table is gone
-- SELECT EXISTS (
--   SELECT FROM information_schema.tables 
--   WHERE table_schema = 'lth_pvr' 
--   AND table_name = 'fee_configs'
-- ) AS fee_configs_exists;

-- Verify customer_strategies has fee data
-- SELECT 
--   customer_id,
--   performance_fee_rate,
--   platform_fee_rate
-- FROM public.customer_strategies
-- WHERE strategy_code = 'LTH_PVR'
-- ORDER BY customer_id;
