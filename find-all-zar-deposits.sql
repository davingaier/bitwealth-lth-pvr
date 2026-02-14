-- Find ALL ZAR deposits for customer 999 (not just recent)
-- Run in Supabase SQL Editor

SELECT 
  funding_id,
  occurred_at AT TIME ZONE 'Africa/Johannesburg' as sa_time,
  amount AS zar_amount,
  metadata,
  ext_ref as valr_tx_id,
  created_at AT TIME ZONE 'Africa/Johannesburg' as synced_at
FROM lth_pvr.exchange_funding_events  
WHERE customer_id = 999
  AND kind = 'zar_deposit'
ORDER BY occurred_at DESC;

-- Expected math for Feb 13-14 period:
-- If Feb 13 deposit = 100 ZAR
-- If converted 30.01 + 75.00 = 105.01 ZAR
-- Then remaining should be -5.01 ZAR (impossible!)
-- But VALR shows 50 ZAR balance
-- 
-- Therefore: Either there's a 155 ZAR deposit we're missing,
-- OR the 75 ZAR conversion came from a different deposit
-- OR VALR's 50 ZAR is from a different source
