-- Fix orphaned R30.01 ZAR conversion
-- This conversion happened on Feb 14 15:20 but wasn't linked to the Feb 13 R100 pending

-- 1. Update the funding event metadata to add zar_deposit_id
UPDATE lth_pvr.exchange_funding_events
SET metadata = metadata || jsonb_build_object(
  'zar_deposit_id', 'd8b23e95-1d78-49f4-b078-3c40b889013e'::uuid
)
WHERE funding_id = 'b3aec50b-c2e8-4de6-861f-7beae6e353e1'::uuid
  AND customer_id = 999;

-- 2. Manually update the pending_zar_conversions table
-- Add R30.00590789 to converted_amount, subtract from remaining
UPDATE lth_pvr.pending_zar_conversions
SET 
  converted_amount = (COALESCE(converted_amount, 0) + 30.00590789),
  remaining_amount = zar_amount - (COALESCE(converted_amount, 0) + 30.00590789)
WHERE funding_id = 'd8b23e95-1d78-49f4-b078-3c40b889013e'::uuid
  AND customer_id = 999;

-- 3. Verify the fix
SELECT 
  funding_id,
  zar_amount AS original,
  converted_amount,
  remaining_amount,
  conversion_status
FROM lth_pvr.v_pending_zar_conversions
WHERE customer_id = 999
ORDER BY occurred_at ASC;

-- Expected result after fix:
-- Feb 13 pending: original=100, converted=50.00577789, remaining=49.99422211 ✅
-- This should match VALR's R50.00 balance
