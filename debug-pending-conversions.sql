-- Debug pending ZAR conversions for customer 999
-- Run this in Supabase SQL Editor

-- 1. Current pending conversions
SELECT 
  funding_id,
  customer_id,
  zar_amount AS original_zar,
  converted_amount,
  remaining_amount,
  occurred_at,
  conversion_status,
  converted_at
FROM lth_pvr.v_pending_zar_conversions
WHERE customer_id = 999
ORDER BY occurred_at ASC;

-- 2. All ZAR deposits for customer 999
SELECT 
  funding_id,
  kind,
  asset,
  amount,
  occurred_at,
  metadata->>'original_zar_amount' as original_zar,
  created_at
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND kind = 'zar_deposit'
ORDER BY occurred_at DESC
LIMIT 5;

-- 3. Recent ZAR→USDT conversions (last 7 days)
SELECT 
  funding_id,
  kind,
  asset,
  amount,
  occurred_at,
  metadata->>'zar_amount' as zar_amount,
  metadata->>'zar_deposit_id' as linked_deposit,
  metadata->>'is_split_allocation' as is_split,
  metadata->>'split_part' as split_part,
  created_at
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND kind = 'deposit'
  AND asset = 'USDT'
  AND occurred_at >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY occurred_at DESC
LIMIT 10;

-- 4. Check raw pending_zar_conversions table (underlying data)
SELECT 
  funding_id,
  zar_amount,
  converted_amount,
  remaining_amount,
  occurred_at
FROM lth_pvr.pending_zar_conversions
WHERE customer_id = 999;
