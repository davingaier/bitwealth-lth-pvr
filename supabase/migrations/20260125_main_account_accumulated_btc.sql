-- Migration: Track BTC accumulated in main account (transferred but not yet converted)
-- Purpose: Some platform fee transfers are below VALR's conversion threshold
--          We need to track these until enough accumulates to convert to USDT
-- Pattern: Replicates customer_accumulated_fees pattern for main BitWealth account

-- =============================================================================
-- 1. Create main_account_accumulated_btc table
-- =============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.main_account_accumulated_btc (
  -- Primary Key (singleton - only one row for main account)
  org_id UUID PRIMARY KEY DEFAULT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  
  -- Accumulated Amounts (not yet converted)
  accumulated_btc NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (accumulated_btc >= 0),
  accumulated_usdt NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (accumulated_usdt >= 0),
  
  -- Conversion Tracking
  last_conversion_attempt_at TIMESTAMPTZ,
  conversion_count INTEGER NOT NULL DEFAULT 0,
  
  -- Audit Trail
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

-- Indexes
CREATE INDEX idx_main_accumulated_updated ON lth_pvr.main_account_accumulated_btc(last_updated_at DESC);

-- Comments
COMMENT ON TABLE lth_pvr.main_account_accumulated_btc IS 
  'Tracks platform fees transferred to main account but below conversion threshold. 
   When enough accumulates (>= valr_min_conversion_btc/usdt), triggers alert for conversion.';
COMMENT ON COLUMN lth_pvr.main_account_accumulated_btc.accumulated_btc IS 
  'BTC transferred from customer subaccounts but not yet converted to USDT (below VALR minimum order size)';
COMMENT ON COLUMN lth_pvr.main_account_accumulated_btc.conversion_count IS 
  'Number of successful BTC→USDT conversions performed';

-- =============================================================================
-- 2. Insert initial row for main account
-- =============================================================================

INSERT INTO lth_pvr.main_account_accumulated_btc (org_id, accumulated_btc, accumulated_usdt)
VALUES ('b0a77009-03b9-44a1-ae1d-34f157d44a8b', 0, 0)
ON CONFLICT (org_id) DO NOTHING;

-- =============================================================================
-- 3. Create RPC function to add to accumulation (called by ef_transfer_accumulated_fees)
-- =============================================================================

CREATE OR REPLACE FUNCTION lth_pvr.accumulate_main_account_btc(
  p_btc_amount NUMERIC,
  p_usdt_amount NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = lth_pvr, public
AS $$
BEGIN
  -- Update accumulation (singleton row)
  UPDATE lth_pvr.main_account_accumulated_btc
  SET 
    accumulated_btc = accumulated_btc + p_btc_amount,
    accumulated_usdt = accumulated_usdt + p_usdt_amount,
    last_updated_at = NOW(),
    notes = COALESCE(p_notes, notes)
  WHERE org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  
  -- If no row exists, insert (should never happen due to migration, but safety net)
  IF NOT FOUND THEN
    INSERT INTO lth_pvr.main_account_accumulated_btc (
      org_id, accumulated_btc, accumulated_usdt, notes
    ) VALUES (
      'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
      p_btc_amount,
      p_usdt_amount,
      p_notes
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION lth_pvr.accumulate_main_account_btc IS 
  'Add BTC/USDT to main account accumulation (called when transferred but below conversion threshold)';

-- =============================================================================
-- 4. Create RPC function to clear accumulation (called after successful conversion)
-- =============================================================================

CREATE OR REPLACE FUNCTION lth_pvr.clear_main_account_accumulation(
  p_btc_converted NUMERIC DEFAULT NULL,
  p_usdt_converted NUMERIC DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = lth_pvr, public
AS $$
BEGIN
  UPDATE lth_pvr.main_account_accumulated_btc
  SET 
    accumulated_btc = CASE 
      WHEN p_btc_converted IS NOT NULL THEN GREATEST(accumulated_btc - p_btc_converted, 0)
      ELSE 0 
    END,
    accumulated_usdt = CASE 
      WHEN p_usdt_converted IS NOT NULL THEN GREATEST(accumulated_usdt - p_usdt_converted, 0)
      ELSE 0
    END,
    last_conversion_attempt_at = NOW(),
    conversion_count = conversion_count + 1,
    last_updated_at = NOW(),
    notes = 'Conversion successful'
  WHERE org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
END;
$$;

COMMENT ON FUNCTION lth_pvr.clear_main_account_accumulation IS 
  'Clear BTC/USDT accumulation after successful conversion to USDT';

-- =============================================================================
-- 5. Create RPC function for Admin UI to view main account status
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_main_account_accumulation()
RETURNS TABLE (
  accumulated_btc NUMERIC,
  accumulated_usdt NUMERIC,
  accumulated_btc_usd NUMERIC,
  accumulated_usdt_usd NUMERIC,
  total_usd NUMERIC,
  last_conversion_attempt_at TIMESTAMPTZ,
  conversion_count INTEGER,
  btc_transferable BOOLEAN,
  btc_convertible BOOLEAN,
  usdt_transferable BOOLEAN,
  usdt_convertible BOOLEAN,
  notes TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = lth_pvr, public
AS $$
DECLARE
  v_btc_price NUMERIC;
  v_min_transfer_btc NUMERIC;
  v_min_transfer_usdt NUMERIC;
  v_min_conversion_btc NUMERIC;
  v_min_conversion_usdt NUMERIC;
BEGIN
  -- Get current BTC price (from most recent decision or fallback)
  SELECT COALESCE(
    (SELECT btc_price FROM lth_pvr.decisions_daily ORDER BY signal_date DESC LIMIT 1),
    96000.00  -- Fallback price
  ) INTO v_btc_price;
  
  -- Get thresholds from config
  SELECT 
    COALESCE((SELECT config_value::NUMERIC FROM lth_pvr.system_config WHERE config_key = 'valr_min_transfer_btc'), 0.000001),
    COALESCE((SELECT config_value::NUMERIC FROM lth_pvr.system_config WHERE config_key = 'valr_min_transfer_usdt'), 0.06),
    COALESCE((SELECT config_value::NUMERIC FROM lth_pvr.system_config WHERE config_key = 'valr_min_conversion_btc'), 0.000001),
    COALESCE((SELECT config_value::NUMERIC FROM lth_pvr.system_config WHERE config_key = 'valr_min_conversion_usdt'), 0.52)
  INTO v_min_transfer_btc, v_min_transfer_usdt, v_min_conversion_btc, v_min_conversion_usdt;
  
  RETURN QUERY
  SELECT 
    m.accumulated_btc,
    m.accumulated_usdt,
    m.accumulated_btc * v_btc_price AS accumulated_btc_usd,
    m.accumulated_usdt AS accumulated_usdt_usd,
    (m.accumulated_btc * v_btc_price) + m.accumulated_usdt AS total_usd,
    m.last_conversion_attempt_at,
    m.conversion_count,
    m.accumulated_btc >= v_min_transfer_btc AS btc_transferable,
    m.accumulated_btc >= v_min_conversion_btc AS btc_convertible,
    m.accumulated_usdt >= v_min_transfer_usdt AS usdt_transferable,
    m.accumulated_usdt >= v_min_conversion_usdt AS usdt_convertible,
    m.notes
  FROM lth_pvr.main_account_accumulated_btc m
  WHERE m.org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
END;
$$;

COMMENT ON FUNCTION public.get_main_account_accumulation IS 
  'Admin UI function: Show main account BTC/USDT awaiting conversion with threshold status';

-- =============================================================================
-- 6. Enable RLS (service role bypass only, not for customers)
-- =============================================================================

ALTER TABLE lth_pvr.main_account_accumulated_btc ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_bypass_main_accumulation ON lth_pvr.main_account_accumulated_btc
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 7. Grant permissions
-- =============================================================================

GRANT SELECT ON lth_pvr.main_account_accumulated_btc TO authenticated;
GRANT EXECUTE ON FUNCTION lth_pvr.accumulate_main_account_btc TO service_role;
GRANT EXECUTE ON FUNCTION lth_pvr.clear_main_account_accumulation TO service_role;
GRANT EXECUTE ON FUNCTION public.get_main_account_accumulation TO authenticated;
