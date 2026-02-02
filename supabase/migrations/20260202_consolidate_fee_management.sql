-- Migration: Consolidate Fee Management to customer_strategies
-- Date: 2026-02-02
-- Purpose: Use public.customer_strategies as single source of truth for fee rates
-- Replaces: lth_pvr.fee_configs (to be dropped after testing)

-- ============================================================================
-- STEP 1: Backfill existing fee_configs data into customer_strategies
-- ============================================================================

-- Update performance_fee_rate in customer_strategies from fee_configs
UPDATE public.customer_strategies cs
SET performance_fee_rate = fc.fee_rate
FROM lth_pvr.fee_configs fc
WHERE cs.customer_id = fc.customer_id
  AND cs.strategy_code = 'LTH_PVR'
  AND fc.fee_rate IS NOT NULL;

-- Set default performance fee rate (10%) for customers without config
UPDATE public.customer_strategies
SET performance_fee_rate = 0.10
WHERE strategy_code = 'LTH_PVR'
  AND performance_fee_rate IS NULL;

-- Set default platform fee rate (0.75%) for customers without config
UPDATE public.customer_strategies
SET platform_fee_rate = 0.0075
WHERE strategy_code = 'LTH_PVR'
  AND platform_fee_rate IS NULL;

-- ============================================================================
-- STEP 2: Create new RPC - update_customer_fee_rates (handles BOTH fees)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_customer_fee_rates(
  p_customer_id BIGINT,
  p_performance_fee_rate NUMERIC DEFAULT NULL,
  p_platform_fee_rate NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, lth_pvr
AS $$
DECLARE
  v_org_id UUID;
  v_current_perf_rate NUMERIC;
  v_current_plat_rate NUMERIC;
  v_result JSONB;
BEGIN
  -- Validate fee rates (0% to 100%)
  IF p_performance_fee_rate IS NOT NULL AND (p_performance_fee_rate < 0 OR p_performance_fee_rate > 1) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Performance fee rate must be between 0.00 (0%) and 1.00 (100%)'
    );
  END IF;

  IF p_platform_fee_rate IS NOT NULL AND (p_platform_fee_rate < 0 OR p_platform_fee_rate > 1) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Platform fee rate must be between 0.00 (0%) and 1.00 (100%)'
    );
  END IF;

  -- Get customer's org_id and verify customer exists
  SELECT org_id INTO v_org_id
  FROM public.customer_details
  WHERE customer_id = p_customer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Customer not found'
    );
  END IF;

  -- Get current fee rates
  SELECT performance_fee_rate, platform_fee_rate
  INTO v_current_perf_rate, v_current_plat_rate
  FROM public.customer_strategies
  WHERE customer_id = p_customer_id
    AND strategy_code = 'LTH_PVR'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Customer strategy not found (LTH_PVR)'
    );
  END IF;

  -- Update fee rates (only update non-NULL parameters)
  UPDATE public.customer_strategies
  SET 
    performance_fee_rate = COALESCE(p_performance_fee_rate, performance_fee_rate),
    platform_fee_rate = COALESCE(p_platform_fee_rate, platform_fee_rate)
  WHERE customer_id = p_customer_id
    AND strategy_code = 'LTH_PVR';

  -- Return success with old and new rates
  v_result := jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'previous_performance_fee_rate', COALESCE(v_current_perf_rate, 0.10),
    'previous_platform_fee_rate', COALESCE(v_current_plat_rate, 0.0075),
    'new_performance_fee_rate', COALESCE(p_performance_fee_rate, v_current_perf_rate, 0.10),
    'new_platform_fee_rate', COALESCE(p_platform_fee_rate, v_current_plat_rate, 0.0075),
    'message', 'Fee rates updated successfully'
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.update_customer_fee_rates IS 
'Update performance and/or platform fee rates for a customer. 
Uses public.customer_strategies as single source of truth.
Pass NULL to keep existing value for either fee type.';

GRANT EXECUTE ON FUNCTION public.update_customer_fee_rates TO authenticated;

-- ============================================================================
-- STEP 3: Create new RPC - get_customer_fee_rates (handles BOTH fees)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_fee_rates(
  p_customer_ids BIGINT[] DEFAULT NULL
)
RETURNS TABLE (
  customer_id BIGINT,
  performance_fee_rate NUMERIC,
  performance_fee_percentage NUMERIC,
  platform_fee_rate NUMERIC,
  platform_fee_percentage NUMERIC
) AS $$
BEGIN
  IF p_customer_ids IS NULL OR array_length(p_customer_ids, 1) = 0 THEN
    -- Return all active LTH_PVR customers
    RETURN QUERY
    SELECT 
      cs.customer_id,
      COALESCE(cs.performance_fee_rate, 0.10) as performance_fee_rate,
      COALESCE(cs.performance_fee_rate, 0.10) * 100 as performance_fee_percentage,
      COALESCE(cs.platform_fee_rate, 0.0075) as platform_fee_rate,
      COALESCE(cs.platform_fee_rate, 0.0075) * 100 as platform_fee_percentage
    FROM public.customer_strategies cs
    WHERE cs.strategy_code = 'LTH_PVR'
      AND cs.status = 'active'
    ORDER BY cs.customer_id;
  ELSE
    -- Return specified customers
    RETURN QUERY
    SELECT 
      cs.customer_id,
      COALESCE(cs.performance_fee_rate, 0.10) as performance_fee_rate,
      COALESCE(cs.performance_fee_rate, 0.10) * 100 as performance_fee_percentage,
      COALESCE(cs.platform_fee_rate, 0.0075) as platform_fee_rate,
      COALESCE(cs.platform_fee_rate, 0.0075) * 100 as platform_fee_percentage
    FROM public.customer_strategies cs
    WHERE cs.customer_id = ANY(p_customer_ids)
      AND cs.strategy_code = 'LTH_PVR'
    ORDER BY cs.customer_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.get_customer_fee_rates IS 
'Get performance and platform fee rates for one or more customers.
Uses public.customer_strategies as single source of truth.
Pass NULL or empty array to get all active LTH_PVR customers.';

GRANT EXECUTE ON FUNCTION public.get_customer_fee_rates TO authenticated;

-- ============================================================================
-- STEP 4: Deprecate old RPCs (keep for backward compatibility, but redirect)
-- ============================================================================

-- Redirect old update_customer_fee_rate to new function
CREATE OR REPLACE FUNCTION public.update_customer_fee_rate(
  p_customer_id BIGINT,
  p_new_fee_rate NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Redirect to new function (performance fee only)
  RETURN public.update_customer_fee_rates(
    p_customer_id,
    p_new_fee_rate,
    NULL  -- Don't update platform fee
  );
END;
$$;

COMMENT ON FUNCTION public.update_customer_fee_rate IS 
'DEPRECATED: Use update_customer_fee_rates instead.
Kept for backward compatibility. Updates performance fee only.';

-- ============================================================================
-- VERIFICATION QUERIES (commented out - uncomment to test)
-- ============================================================================

-- Verify backfill
-- SELECT customer_id, performance_fee_rate, platform_fee_rate 
-- FROM public.customer_strategies 
-- WHERE strategy_code = 'LTH_PVR' 
-- ORDER BY customer_id;

-- Test new get function
-- SELECT * FROM public.get_customer_fee_rates(ARRAY[12, 31, 44, 45, 47]);

-- Test new update function (performance fee)
-- SELECT public.update_customer_fee_rates(12, 0.08, NULL);

-- Test new update function (platform fee)
-- SELECT public.update_customer_fee_rates(12, NULL, 0.01);

-- Test new update function (both fees)
-- SELECT public.update_customer_fee_rates(12, 0.08, 0.01);
