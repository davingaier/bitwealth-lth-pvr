-- Change bt_params.enable_retrace default from FALSE to TRUE
-- Date: 2026-02-22
-- Issue: Admin UI back-tester doesn't explicitly set enable_retrace,
--        so it uses database default (which was false). This caused
--        Admin UI back-tests to differ from public website and simulator.
-- Solution: Change database default to TRUE to match Progressive variation

ALTER TABLE lth_pvr_bt.bt_params
ALTER COLUMN enable_retrace SET DEFAULT true;

-- Update comment to reflect new default
COMMENT ON COLUMN lth_pvr_bt.bt_params.enable_retrace IS 
'Enable retrace buy logic during price retracements from overbought zones. Default: TRUE (matches Progressive variation)';
