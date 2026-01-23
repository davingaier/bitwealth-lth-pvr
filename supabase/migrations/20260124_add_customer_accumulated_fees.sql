-- Migration: Add customer_accumulated_fees table and RPC functions
-- Date: 2026-01-24
-- Purpose: Platform fee accumulation system (v0.6.31, Phase 6, Sub-Phase 6.2)
-- Related: VALR minimum transfer thresholds, batch transfer system

-- ============================================================================
-- 1. CREATE customer_accumulated_fees TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.customer_accumulated_fees (
  customer_id BIGINT NOT NULL REFERENCES public.customer_details(customer_id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  
  -- Accumulated platform fees (below VALR minimum transfer thresholds)
  accumulated_btc NUMERIC(38,8) NOT NULL DEFAULT 0,
  accumulated_usdt NUMERIC(38,8) NOT NULL DEFAULT 0,
  accumulated_zar NUMERIC(38,2) NOT NULL DEFAULT 0,
  
  -- Audit trail
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_transfer_attempt_at TIMESTAMPTZ, -- Last time batch transfer attempted
  transfer_count INT NOT NULL DEFAULT 0, -- Number of successful batch transfers
  
  -- Metadata
  notes TEXT,
  
  CONSTRAINT customer_accumulated_fees_pk PRIMARY KEY (customer_id, org_id),
  CONSTRAINT customer_accumulated_fees_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Ensure accumulated amounts are non-negative
  CONSTRAINT accumulated_btc_non_negative CHECK (accumulated_btc >= 0),
  CONSTRAINT accumulated_usdt_non_negative CHECK (accumulated_usdt >= 0),
  CONSTRAINT accumulated_zar_non_negative CHECK (accumulated_zar >= 0)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_customer_accumulated_fees_customer 
ON lth_pvr.customer_accumulated_fees(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_accumulated_fees_org 
ON lth_pvr.customer_accumulated_fees(org_id);

-- Index for finding customers with fees >= threshold (for batch transfer job)
CREATE INDEX IF NOT EXISTS idx_customer_accumulated_fees_btc 
ON lth_pvr.customer_accumulated_fees(accumulated_btc) 
WHERE accumulated_btc > 0;

CREATE INDEX IF NOT EXISTS idx_customer_accumulated_fees_usdt 
ON lth_pvr.customer_accumulated_fees(accumulated_usdt) 
WHERE accumulated_usdt > 0;

-- Table comments
COMMENT ON TABLE lth_pvr.customer_accumulated_fees IS 
'Tracks platform fees too small to transfer immediately (below VALR minimums). 
Fees accumulate until >= threshold, then batch-transferred monthly via ef_transfer_accumulated_fees.';

COMMENT ON COLUMN lth_pvr.customer_accumulated_fees.accumulated_btc IS 
'BTC platform fees below 0.0001 BTC threshold, awaiting batch transfer';

COMMENT ON COLUMN lth_pvr.customer_accumulated_fees.accumulated_usdt IS 
'USDT platform fees below $1.00 threshold, awaiting batch transfer';

COMMENT ON COLUMN lth_pvr.customer_accumulated_fees.last_transfer_attempt_at IS 
'Timestamp of last ef_transfer_accumulated_fees attempt (success or failure)';

COMMENT ON COLUMN lth_pvr.customer_accumulated_fees.transfer_count IS 
'Number of successful batch transfers for this customer (audit counter)';

-- ============================================================================
-- 2. ENHANCE fee_invoices TABLE
-- ============================================================================

-- Add columns to track transferred vs accumulated platform fees
ALTER TABLE lth_pvr.fee_invoices 
ADD COLUMN IF NOT EXISTS platform_fees_transferred_btc NUMERIC(38,8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS platform_fees_transferred_usdt NUMERIC(38,8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS platform_fees_accumulated_btc NUMERIC(38,8) DEFAULT 0,
ADD COLUMN IF NOT EXISTS platform_fees_accumulated_usdt NUMERIC(38,8) DEFAULT 0;

-- Column comments
COMMENT ON COLUMN lth_pvr.fee_invoices.platform_fees_transferred_btc IS 
'Platform fees successfully transferred to BitWealth main account (BTC)';

COMMENT ON COLUMN lth_pvr.fee_invoices.platform_fees_transferred_usdt IS 
'Platform fees successfully transferred to BitWealth main account (USDT)';

COMMENT ON COLUMN lth_pvr.fee_invoices.platform_fees_accumulated_btc IS 
'Platform fees accumulated (below threshold, not yet transferred) (BTC)';

COMMENT ON COLUMN lth_pvr.fee_invoices.platform_fees_accumulated_usdt IS 
'Platform fees accumulated (below threshold, not yet transferred) (USDT)';

-- ============================================================================
-- 3. CREATE RPC: lth_pvr.get_withdrawable_balance
-- ============================================================================

CREATE OR REPLACE FUNCTION lth_pvr.get_withdrawable_balance(
  p_customer_id BIGINT
)
RETURNS TABLE (
  customer_id BIGINT,
  recorded_btc NUMERIC(38,8),
  recorded_usdt NUMERIC(38,8),
  accumulated_btc NUMERIC(38,8),
  accumulated_usdt NUMERIC(38,8),
  withdrawable_btc NUMERIC(38,8),
  withdrawable_usdt NUMERIC(38,8),
  total_usd NUMERIC(38,2),
  withdrawable_usd NUMERIC(38,2)
) AS $$
DECLARE
  v_org_id UUID;
  v_btc_price NUMERIC(38,2);
BEGIN
  -- Get org_id for customer
  SELECT cd.org_id INTO v_org_id
  FROM public.customer_details cd
  WHERE cd.customer_id = p_customer_id;
  
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;
  
  -- Get latest BTC price for USD conversion
  SELECT price_usd INTO v_btc_price
  FROM lth_pvr.ci_bands_daily
  ORDER BY date DESC
  LIMIT 1;
  
  IF v_btc_price IS NULL THEN
    v_btc_price := 100000; -- Fallback price if no data
  END IF;
  
  -- Return withdrawable balance calculation
  RETURN QUERY
  SELECT 
    p_customer_id,
    COALESCE(bd.btc_balance, 0) AS recorded_btc,
    COALESCE(bd.usdt_balance, 0) AS recorded_usdt,
    COALESCE(caf.accumulated_btc, 0) AS accumulated_btc,
    COALESCE(caf.accumulated_usdt, 0) AS accumulated_usdt,
    -- Withdrawable = Recorded - Accumulated (customer's money only)
    COALESCE(bd.btc_balance, 0) - COALESCE(caf.accumulated_btc, 0) AS withdrawable_btc,
    COALESCE(bd.usdt_balance, 0) - COALESCE(caf.accumulated_usdt, 0) AS withdrawable_usdt,
    -- Total balance in USD
    (COALESCE(bd.btc_balance, 0) * v_btc_price) + COALESCE(bd.usdt_balance, 0) AS total_usd,
    -- Withdrawable balance in USD
    ((COALESCE(bd.btc_balance, 0) - COALESCE(caf.accumulated_btc, 0)) * v_btc_price) + 
    (COALESCE(bd.usdt_balance, 0) - COALESCE(caf.accumulated_usdt, 0)) AS withdrawable_usd
  FROM lth_pvr.balances_daily bd
  LEFT JOIN lth_pvr.customer_accumulated_fees caf 
    ON caf.customer_id = p_customer_id AND caf.org_id = v_org_id
  WHERE bd.customer_id = p_customer_id
    AND bd.org_id = v_org_id
  ORDER BY bd.date DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION lth_pvr.get_withdrawable_balance(BIGINT) IS 
'Calculate withdrawable balance for customer (recorded balance minus accumulated fees).
Prevents customer from withdrawing BitWealth''s accumulated platform fees.
Used by withdrawal request validation and customer portal balance display.';

-- ============================================================================
-- 4. CREATE RPC: lth_pvr.accumulate_platform_fee
-- ============================================================================

CREATE OR REPLACE FUNCTION lth_pvr.accumulate_platform_fee(
  p_customer_id BIGINT,
  p_org_id UUID,
  p_currency TEXT,
  p_amount NUMERIC(38,8)
)
RETURNS TABLE (
  customer_id BIGINT,
  currency TEXT,
  previous_accumulated NUMERIC(38,8),
  added_amount NUMERIC(38,8),
  new_accumulated NUMERIC(38,8),
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  v_previous_btc NUMERIC(38,8) := 0;
  v_previous_usdt NUMERIC(38,8) := 0;
  v_previous_zar NUMERIC(38,2) := 0;
  v_new_btc NUMERIC(38,8);
  v_new_usdt NUMERIC(38,8);
  v_new_zar NUMERIC(38,2);
BEGIN
  -- Validate currency
  IF p_currency NOT IN ('BTC', 'USDT', 'ZAR') THEN
    RAISE EXCEPTION 'Invalid currency: %. Must be BTC, USDT, or ZAR', p_currency;
  END IF;
  
  -- Validate amount is positive
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive: %', p_amount;
  END IF;
  
  -- Get current accumulated amounts (if exists)
  SELECT 
    COALESCE(accumulated_btc, 0),
    COALESCE(accumulated_usdt, 0),
    COALESCE(accumulated_zar, 0)
  INTO v_previous_btc, v_previous_usdt, v_previous_zar
  FROM lth_pvr.customer_accumulated_fees
  WHERE customer_accumulated_fees.customer_id = p_customer_id
    AND customer_accumulated_fees.org_id = p_org_id;
  
  -- Calculate new amounts based on currency
  v_new_btc := v_previous_btc + CASE WHEN p_currency = 'BTC' THEN p_amount ELSE 0 END;
  v_new_usdt := v_previous_usdt + CASE WHEN p_currency = 'USDT' THEN p_amount ELSE 0 END;
  v_new_zar := v_previous_zar + CASE WHEN p_currency = 'ZAR' THEN p_amount ELSE 0 END;
  
  -- Upsert (insert or update)
  INSERT INTO lth_pvr.customer_accumulated_fees (
    customer_id,
    org_id,
    accumulated_btc,
    accumulated_usdt,
    accumulated_zar,
    last_updated_at
  ) VALUES (
    p_customer_id,
    p_org_id,
    v_new_btc,
    v_new_usdt,
    v_new_zar,
    NOW()
  )
  ON CONFLICT (customer_id, org_id) DO UPDATE SET
    accumulated_btc = v_new_btc,
    accumulated_usdt = v_new_usdt,
    accumulated_zar = v_new_zar,
    last_updated_at = NOW();
  
  -- Return result based on currency
  RETURN QUERY
  SELECT 
    p_customer_id,
    p_currency,
    CASE 
      WHEN p_currency = 'BTC' THEN v_previous_btc
      WHEN p_currency = 'USDT' THEN v_previous_usdt
      WHEN p_currency = 'ZAR' THEN v_previous_zar::NUMERIC(38,8)
    END AS previous_accumulated,
    p_amount AS added_amount,
    CASE 
      WHEN p_currency = 'BTC' THEN v_new_btc
      WHEN p_currency = 'USDT' THEN v_new_usdt
      WHEN p_currency = 'ZAR' THEN v_new_zar::NUMERIC(38,8)
    END AS new_accumulated,
    NOW() AS updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION lth_pvr.accumulate_platform_fee(BIGINT, UUID, TEXT, NUMERIC) IS 
'Accumulate platform fee for customer when amount is below VALR minimum transfer threshold.
Called by ef_post_ledger_and_balances when fee < minimum.
Upserts customer_accumulated_fees table, returns previous and new totals.';

-- ============================================================================
-- 5. CREATE RPC: public.list_accumulated_fees (Admin View)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_accumulated_fees(
  p_org_id UUID DEFAULT NULL
)
RETURNS TABLE (
  customer_id BIGINT,
  customer_name TEXT,
  email TEXT,
  accumulated_btc NUMERIC(38,8),
  accumulated_usdt NUMERIC(38,8),
  accumulated_zar NUMERIC(38,2),
  total_usd NUMERIC(38,2),
  last_updated_at TIMESTAMPTZ,
  last_transfer_attempt_at TIMESTAMPTZ,
  transfer_count INT
) AS $$
DECLARE
  v_org_id UUID;
  v_btc_price NUMERIC(38,2);
BEGIN
  -- Use provided org_id or get from environment
  v_org_id := COALESCE(p_org_id, (SELECT org_id FROM public.organizations LIMIT 1));
  
  -- Get latest BTC price for USD conversion
  SELECT price_usd INTO v_btc_price
  FROM lth_pvr.ci_bands_daily
  ORDER BY date DESC
  LIMIT 1;
  
  IF v_btc_price IS NULL THEN
    v_btc_price := 100000; -- Fallback
  END IF;
  
  RETURN QUERY
  SELECT 
    caf.customer_id,
    cd.first_names || ' ' || cd.last_name AS customer_name,
    cd.email,
    caf.accumulated_btc,
    caf.accumulated_usdt,
    caf.accumulated_zar,
    -- Total accumulated in USD
    (caf.accumulated_btc * v_btc_price) + caf.accumulated_usdt + (caf.accumulated_zar / 18.5) AS total_usd,
    caf.last_updated_at,
    caf.last_transfer_attempt_at,
    caf.transfer_count
  FROM lth_pvr.customer_accumulated_fees caf
  JOIN public.customer_details cd ON caf.customer_id = cd.customer_id
  WHERE caf.org_id = v_org_id
    AND (caf.accumulated_btc > 0 OR caf.accumulated_usdt > 0 OR caf.accumulated_zar > 0)
  ORDER BY total_usd DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.list_accumulated_fees(UUID) IS 
'Admin view: List all customers with accumulated platform fees (below transfer threshold).
Sorted by total USD value (highest first).
Used by Admin UI "Accumulated Fees" panel.';

-- ============================================================================
-- 6. VERIFICATION QUERIES
-- ============================================================================

-- Verify customer_accumulated_fees table
-- SELECT * FROM lth_pvr.customer_accumulated_fees LIMIT 10;

-- Test get_withdrawable_balance for Customer 47
-- SELECT * FROM lth_pvr.get_withdrawable_balance(47);

-- Test accumulate_platform_fee (dry run - comment out to execute)
-- SELECT * FROM lth_pvr.accumulate_platform_fee(
--   47, -- customer_id
--   '018f8f3c-a928-7c27-b2b3-c47ca81e3ac5', -- org_id
--   'BTC',
--   0.00000058
-- );

-- List all accumulated fees (admin view)
-- SELECT * FROM public.list_accumulated_fees();
