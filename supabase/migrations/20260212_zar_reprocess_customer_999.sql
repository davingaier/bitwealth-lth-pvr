-- Script: Reprocess Customer 999 Missing Transactions
-- Date: 2026-02-12
-- Purpose: Manually create missing funding events for customer 999's ZAR transactions
-- Then trigger ef_sync_valr_transactions to pick up any new transactions

-- STEP 1: Verify current state
SELECT 
  'Before cleanup' AS stage,
  kind,
  asset,
  amount,
  occurred_at,
  idempotency_key
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date
  AND occurred_at < '2026-01-29'::date
ORDER BY occurred_at;

-- STEP 2: Delete incorrect records (will be rerun by migration)
-- This is safe because we're about to reprocess everything

DELETE FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date
  AND occurred_at < '2026-01-29'::date;

-- STEP 3: Clear pending_zar_conversions for clean reprocess
DELETE FROM lth_pvr.pending_zar_conversions
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date;

-- STEP 4: Trigger transaction sync via edge function
-- This will re-fetch all transactions from VALR and recreate with corrected logic
-- Run this via PowerShell or browser:

/*
$body = @{} | ConvertTo-Json
Invoke-WebRequest `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_sync_valr_transactions" `
  -Method POST `
  -Headers @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
  } `
  -Body $body
*/

-- STEP 5: Verify reprocessed transactions
SELECT 
  'After reprocess' AS stage,
  kind,
  asset,
  amount,
  occurred_at,
  idempotency_key,
  metadata->>'zar_amount' AS zar_amount,
  metadata->>'zar_deposit_id' AS zar_deposit_id
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date
  AND occurred_at < '2026-01-29'::date
ORDER BY occurred_at;

-- Expected results:
-- 1. zar_deposit for 21,000 ZAR (27 Jan 01:54) - NEW
-- 2. deposit for 9.277 USDT (27 Jan 07:44) with metadata.zar_amount = 150 - NEW
-- 3. deposit for 1,300.84 USDT (28 Jan 10:22) with metadata.zar_amount = 20,850
-- NO zar_withdrawal records should exist!

-- STEP 6: Verify pending_zar_conversions
SELECT 
  original_zar_amount,
  converted_amount,
  remaining_amount,
  conversion_status,
  occurred_at
FROM lth_pvr.v_pending_zar_conversions
WHERE customer_id = 999
ORDER BY occurred_at;

-- Expected: 1 row showing 21,000 ZAR deposit with partial conversions tracked

-- STEP 7: Verify platform fee was calculated
SELECT 
  customer_id,
  event_type,
  amount_usdt,
  platform_fee_usdt,
  trade_date,
  note
FROM lth_pvr.ledger_lines
WHERE customer_id = 999
  AND trade_date >= '2026-01-27'::date
  AND trade_date < '2026-01-29'::date
ORDER BY trade_date, created_at;

-- Expected: deposit entries with platform_fee_usdt = 0.75% of deposit amount
