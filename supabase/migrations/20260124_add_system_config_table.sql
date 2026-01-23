-- Migration: Add system_config table for VALR minimum transfer thresholds
-- Date: 2026-01-24
-- Purpose: Store runtime configuration for platform fee accumulation system (v0.6.31)
-- Related: Phase 6, Sub-Phase 6.1 (Platform Fee Accumulation System)

-- Create system_config table
CREATE TABLE IF NOT EXISTS lth_pvr.system_config (
  config_key TEXT PRIMARY KEY,
  config_value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_system_config_key 
ON lth_pvr.system_config(config_key);

-- Insert VALR minimum transfer thresholds
-- NOTE: These are CONSERVATIVE estimates based on:
-- 1. TC1.2 BTC failure at 0.00000058 BTC (5.8 sats)
-- 2. TC1.1 USDT success at 0.05732531 USDT ($0.06)
-- 3. Industry standard thresholds for South African exchanges
-- 4. VALR API documentation (undocumented transfer minimums)

INSERT INTO lth_pvr.system_config (config_key, config_value, description, updated_by) VALUES
  -- BTC minimum: 0.0001 BTC (10,000 satoshis)
  -- Rationale: TC1.2 failed at 5.8 sats, typical exchange minimum is 10,000 sats
  -- Value at $100k BTC: ~$10 USD
  ('valr_min_transfer_btc', '"0.0001"', 
   'VALR minimum BTC transfer amount (10,000 sats). Verified: TC1.2 FAILED at 0.00000058 BTC. 
    Estimated based on industry standards. REQUIRES MANUAL TESTING for exact threshold.',
   'system'),

  -- USDT minimum: 1.00 USDT
  -- Rationale: TC1.1 succeeded at $0.06, setting conservative $1 minimum
  -- Safe buffer above known working amount
  ('valr_min_transfer_usdt', '"1.00"', 
   'VALR minimum USDT transfer amount ($1.00). Verified: TC1.1 SUCCESS at $0.06. 
    Conservative estimate with safety buffer. May be lower in practice.',
   'system'),

  -- ZAR minimum: 100.00 ZAR
  -- Rationale: Industry standard for South African exchanges (R100 = ~$5 USD)
  -- Not actively used in current system (BTC/USDT only)
  ('valr_min_transfer_zar', '"100.00"', 
   'VALR minimum ZAR transfer amount (R100). 
    Estimated based on South African exchange standards. NOT TESTED - ZAR not currently used.',
   'system'),

  -- Platform fee percentage (for reference)
  ('platform_fee_percentage', '"0.0075"', 
   'Platform fee percentage (0.75%). Applied to deposits (BTC and USDT).',
   'system'),

  -- Accumulation batch transfer schedule (cron expression)
  ('accumulation_transfer_schedule', '"0 2 1 * *"', 
   'Monthly batch transfer schedule (cron: 1st of month at 02:00 UTC). 
    Runs BEFORE ef_fee_monthly_close to ensure invoices reflect transferred fees.',
   'system')

ON CONFLICT (config_key) DO NOTHING;

-- Add comment to table
COMMENT ON TABLE lth_pvr.system_config IS 
'Runtime configuration for BitWealth LTH PVR system. 
Stores VALR API thresholds, fee percentages, and system parameters.
Modified via Admin UI or migrations only.';

COMMENT ON COLUMN lth_pvr.system_config.config_key IS 
'Unique configuration key (e.g., valr_min_transfer_btc)';

COMMENT ON COLUMN lth_pvr.system_config.config_value IS 
'JSON value (string, number, boolean, or object). Use JSON for type safety.';

COMMENT ON COLUMN lth_pvr.system_config.description IS 
'Human-readable description with verification notes and rationale';

COMMENT ON COLUMN lth_pvr.system_config.updated_by IS 
'User or system that last modified this config (for audit trail)';

-- Verification query
-- SELECT config_key, config_value, description 
-- FROM lth_pvr.system_config 
-- WHERE config_key LIKE 'valr_min_transfer_%'
-- ORDER BY config_key;
