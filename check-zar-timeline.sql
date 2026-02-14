-- Timeline of ZAR deposits and conversions for customer 999
-- Run in Supabase SQL Editor

SET TIME ZONE 'Africa/Johannesburg';

-- Complete timeline of ZAR-related transactions
SELECT 
  occurred_at AT TIME ZONE 'Africa/Johannesburg' as sa_time,
  kind,
  asset,
  amount,
  CASE 
    WHEN kind = 'zar_deposit' THEN metadata->>'original_zar_amount'
    WHEN kind = 'deposit' AND asset = 'USDT' THEN metadata->>'zar_amount'
    ELSE NULL
  END as zar_amount,
  metadata->>'zar_deposit_id' as linked_to_deposit,
  ext_ref as valr_tx_id,
  idempotency_key,
  created_at AT TIME ZONE 'Africa/Johannesburg' as synced_at
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND (
    kind = 'zar_deposit' 
    OR (kind = 'deposit' AND asset = 'USDT' AND metadata ? 'zar_amount')
  )
  AND occurred_at >= '2026-02-12'
ORDER BY occurred_at DESC;

-- Summary: Expected vs Actual
WITH deposits AS (
  SELECT COALESCE(SUM((metadata->>'original_zar_amount')::numeric), 0) as total_deposited
  FROM lth_pvr.exchange_funding_events
  WHERE customer_id = 999
    AND kind = 'zar_deposit'
    AND occurred_at >= '2026-02-12'
),
conversions AS (
  SELECT COALESCE(SUM((metadata->>'zar_amount')::numeric), 0) as total_converted
  FROM lth_pvr.exchange_funding_events
  WHERE customer_id = 999
    AND kind = 'deposit'
    AND asset = 'USDT'
    AND metadata ? 'zar_amount'
    AND occurred_at >= '2026-02-12'
)
SELECT 
  d.total_deposited as zar_deposited,
  c.total_converted as zar_converted,
  d.total_deposited - c.total_converted as should_be_pending,
  50.00 as valr_balance_reported,
  (d.total_deposited - c.total_converted) - 50.00 as discrepancy
FROM deposits d, conversions c;
