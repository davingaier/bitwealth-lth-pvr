-- Migration: Add partial conversion tracking to pending_zar_conversions
-- Date: 2026-02-12
-- Purpose: Track partial conversions so admin UI shows unconverted amounts
-- Bug Fix: #3 - Partial Conversion Trigger Flaw

-- Step 1: Add columns for tracking partial conversions
ALTER TABLE lth_pvr.pending_zar_conversions
ADD COLUMN IF NOT EXISTS converted_amount NUMERIC(15,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2);

-- Step 2: Backfill remaining_amount for existing records
UPDATE lth_pvr.pending_zar_conversions
SET remaining_amount = zar_amount - COALESCE(converted_amount, 0)
WHERE remaining_amount IS NULL;

-- Step 3: Create improved trigger function for partial conversion tracking
CREATE OR REPLACE FUNCTION lth_pvr.on_zar_conversion_resolve_pending()
RETURNS TRIGGER AS $$
DECLARE
  v_zar_deposit_id UUID;
  v_conversion_zar_amount NUMERIC;
  v_remaining NUMERIC;
BEGIN
  -- Only process USDT deposits with ZAR conversion metadata
  IF NEW.kind = 'deposit' 
     AND NEW.asset = 'USDT' 
     AND NEW.metadata ? 'zar_deposit_id' 
     AND NEW.metadata ? 'zar_amount' THEN
    
    v_zar_deposit_id := (NEW.metadata->>'zar_deposit_id')::UUID;
    v_conversion_zar_amount := (NEW.metadata->>'zar_amount')::NUMERIC;
    
    -- Accumulate converted amount and update remaining
    UPDATE lth_pvr.pending_zar_conversions
    SET converted_amount = COALESCE(converted_amount, 0) + v_conversion_zar_amount,
        remaining_amount = zar_amount - (COALESCE(converted_amount, 0) + v_conversion_zar_amount),
        updated_at = CURRENT_TIMESTAMP
    WHERE funding_id = v_zar_deposit_id
    RETURNING remaining_amount INTO v_remaining;
    
    -- Only mark as fully converted if remaining <= 0.01 ZAR (tolerance for rounding)
    IF v_remaining IS NOT NULL AND v_remaining <= 0.01 THEN
      UPDATE lth_pvr.pending_zar_conversions
      SET converted_at = NEW.occurred_at,
          conversion_funding_id = NEW.funding_id,
          updated_at = CURRENT_TIMESTAMP
      WHERE funding_id = v_zar_deposit_id
        AND converted_at IS NULL;
      
      RAISE NOTICE 'Pending ZAR conversion fully converted: funding_id=%, remaining=%', v_zar_deposit_id, v_remaining;
    ELSE
      RAISE NOTICE 'Partial ZAR conversion: funding_id=%, converted=%, remaining=%', 
        v_zar_deposit_id, v_conversion_zar_amount, v_remaining;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Recreate trigger (no change, just ensure it exists)
DROP TRIGGER IF EXISTS trigger_zar_conversion_resolve ON lth_pvr.exchange_funding_events;
CREATE TRIGGER trigger_zar_conversion_resolve
  AFTER INSERT ON lth_pvr.exchange_funding_events
  FOR EACH ROW
  EXECUTE FUNCTION lth_pvr.on_zar_conversion_resolve_pending();

-- Step 5: Add index for efficient queries on remaining_amount
CREATE INDEX IF NOT EXISTS idx_pending_zar_conversions_remaining 
ON lth_pvr.pending_zar_conversions(remaining_amount) 
WHERE converted_at IS NULL;

COMMENT ON COLUMN lth_pvr.pending_zar_conversions.converted_amount IS 
'Accumulated ZAR amount that has been converted to USDT so far';

COMMENT ON COLUMN lth_pvr.pending_zar_conversions.remaining_amount IS 
'Remaining ZAR amount awaiting conversion (zar_amount - converted_amount)';
