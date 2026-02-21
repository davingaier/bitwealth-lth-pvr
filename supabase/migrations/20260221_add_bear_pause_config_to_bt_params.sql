-- Migration: Add bear pause and retrace configuration columns to bt_params
-- Date: 2026-02-21
-- Purpose: Support configurable strategy variations in back-testing

-- Add bear pause threshold columns
ALTER TABLE lth_pvr_bt.bt_params
ADD COLUMN IF NOT EXISTS bear_pause_enter_sigma NUMERIC DEFAULT 2.0,
ADD COLUMN IF NOT EXISTS bear_pause_exit_sigma NUMERIC DEFAULT -1.0,
ADD COLUMN IF NOT EXISTS retrace_base INT DEFAULT 3;

-- Add column comments for documentation
COMMENT ON COLUMN lth_pvr_bt.bt_params.bear_pause_enter_sigma IS 
  'Sigma threshold to ENTER bear pause (e.g., 2.0 = +2.0σ). Default: 2.0';

COMMENT ON COLUMN lth_pvr_bt.bt_params.bear_pause_exit_sigma IS 
  'Sigma threshold to EXIT bear pause (e.g., -1.0 = -1.0σ for Progressive, -0.75 for Balanced, 0.0 for Conservative). Default: -1.0';

COMMENT ON COLUMN lth_pvr_bt.bt_params.retrace_base IS 
  'Which Base to use for retrace buys (1-5 for B1-B5). Default: 3 (uses B.B3 order size)';
