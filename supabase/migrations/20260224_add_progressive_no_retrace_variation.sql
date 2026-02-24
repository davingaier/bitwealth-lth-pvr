-- Add Progressive No Retrace variation for A/B testing
-- Purpose: Test whether retrace logic improves or degrades performance across different market regimes
-- Context: User discovered retrace=true underperforms on certain date ranges (2022-11 to 2025-10)
--          but performs well on full cycle (2020-2026). Need systematic testing.

INSERT INTO lth_pvr.strategy_variation_templates (
  org_id,
  variation_name,
  display_name,
  description,
  -- Trade size percentages (from Progressive)
  b1, b2, b3, b4, b5,
  b6, b7, b8, b9, b10, b11,
  -- Bear pause thresholds (from Progressive)
  bear_pause_enter_sigma,
  bear_pause_exit_sigma,
  -- Momentum filter (from Progressive)
  momentum_length,
  momentum_threshold,
  -- Retrace configuration (KEY DIFFERENCE)
  enable_retrace,
  retrace_base,
  -- Metadata
  is_production,
  is_active,
  created_at,
  updated_at
)
SELECT 
  org_id,
  'progressive_no_retrace' AS variation_name,
  'Progressive No Retrace (Test Variation)' AS display_name,
  'Progressive variation WITHOUT retrace logic - for A/B testing across market regimes. Identical to Progressive except enable_retrace=false.' AS description,
  -- Copy all trade sizes from Progressive
  b1, b2, b3, b4, b5,
  b6, b7, b8, b9, b10, b11,
  -- Copy bear pause thresholds
  bear_pause_enter_sigma,
  bear_pause_exit_sigma,
  -- Copy momentum settings
  momentum_length,
  momentum_threshold,
  -- DISABLE retrace (this is the experimental variable)
  false AS enable_retrace,
  retrace_base, -- Keep same Base size (won't be used, but maintain consistency)
  -- Not production, but active for testing
  false AS is_production,
  true AS is_active,
  NOW() AS created_at,
  NOW() AS updated_at
FROM lth_pvr.strategy_variation_templates
WHERE variation_name = 'progressive'
  AND is_active = true
LIMIT 1;

-- Verify the new variation was created
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM lth_pvr.strategy_variation_templates
  WHERE variation_name = 'progressive_no_retrace';
  
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Failed to create progressive_no_retrace variation';
  END IF;
  
  RAISE NOTICE 'Successfully created progressive_no_retrace variation (enable_retrace=false)';
END $$;
