-- Data Cleanup Script: Remove Duplicate INTERNAL_TRANSFER Withdrawal Events
-- Date: 2026-01-26
-- Issue: INTERNAL_TRANSFER transactions incorrectly recorded as customer withdrawals

-- =============================================================================
-- STEP 1: Backup affected data (for rollback if needed)
-- =============================================================================

-- Create backup table
CREATE TABLE IF NOT EXISTS lth_pvr.exchange_funding_events_backup_20260126 AS
SELECT *
FROM lth_pvr.exchange_funding_events
WHERE idempotency_key LIKE 'VALR_TX_%'
  AND kind = 'withdrawal'
  AND created_at >= '2026-01-24';

-- Verify backup count
SELECT 
  COUNT(*) as backed_up_records,
  SUM(CASE WHEN asset = 'BTC' THEN ABS(amount) ELSE 0 END) as total_btc_withdrawn,
  SUM(CASE WHEN asset = 'USDT' THEN ABS(amount) ELSE 0 END) as total_usdt_withdrawn
FROM lth_pvr.exchange_funding_events_backup_20260126;

-- =============================================================================
-- STEP 2: Identify affected funding events (INTERNAL_TRANSFER withdrawals)
-- =============================================================================

-- These are the duplicate withdrawal events we need to remove
SELECT 
  customer_id,
  COUNT(*) as withdrawal_count,
  SUM(ABS(amount)) as total_withdrawn_btc
FROM lth_pvr.exchange_funding_events
WHERE idempotency_key LIKE 'VALR_TX_%'
  AND kind = 'withdrawal'
  AND asset = 'BTC'
  AND occurred_at >= '2026-01-24'
  AND org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
GROUP BY customer_id
ORDER BY withdrawal_count DESC;

-- =============================================================================
-- STEP 3: Delete duplicate VALR_TX_ withdrawal funding events
-- =============================================================================

-- WARNING: This will permanently delete the duplicate withdrawal events
-- Make sure you have verified the backup first!

DELETE FROM lth_pvr.exchange_funding_events
WHERE idempotency_key LIKE 'VALR_TX_%'
  AND kind = 'withdrawal'
  AND occurred_at >= '2026-01-24'
  AND org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';

-- Verify deletion
SELECT COUNT(*) as remaining_valr_tx_withdrawals
FROM lth_pvr.exchange_funding_events
WHERE idempotency_key LIKE 'VALR_TX_%'
  AND kind = 'withdrawal'
  AND occurred_at >= '2026-01-24';

-- =============================================================================
-- STEP 4: Recalculate affected ledger_lines
-- =============================================================================

-- The duplicate funding events created duplicate ledger entries
-- We need to delete ledger entries that reference the deleted funding events

-- First, identify affected ledger entries
SELECT 
  customer_id,
  trade_date,
  COUNT(*) as ledger_entries,
  SUM(amount_btc) as total_btc_withdrawn
FROM lth_pvr.ledger_lines
WHERE kind = 'withdrawal'
  AND trade_date >= '2026-01-24'
  AND org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
  -- Look for entries that reference non-existent funding events
  AND NOT EXISTS (
    SELECT 1 
    FROM lth_pvr.exchange_funding_events efe
    WHERE efe.funding_id = ledger_lines.ref_funding_id
  )
GROUP BY customer_id, trade_date
ORDER BY trade_date DESC, customer_id;

-- Delete orphaned ledger entries (ones that reference deleted funding events)
DELETE FROM lth_pvr.ledger_lines
WHERE kind = 'withdrawal'
  AND trade_date >= '2026-01-24'
  AND org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
  AND NOT EXISTS (
    SELECT 1 
    FROM lth_pvr.exchange_funding_events efe
    WHERE efe.funding_id = ledger_lines.ref_funding_id
  );

-- =============================================================================
-- STEP 5: Recalculate daily balances
-- =============================================================================

-- Delete affected daily balances so they can be recalculated
DELETE FROM lth_pvr.balances_daily
WHERE trade_date >= '2026-01-24'
  AND org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';

-- Trigger recalculation by calling ef_post_ledger_and_balances
-- This will be done via edge function call (see next step)

-- =============================================================================
-- STEP 6: Verification Queries
-- =============================================================================

-- Check customer 47 balance after cleanup
SELECT 
  customer_id,
  trade_date,
  balance_btc,
  balance_usdt,
  withdrawable_btc,
  withdrawable_usdt
FROM lth_pvr.balances_daily
WHERE customer_id = 47
  AND org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
  AND trade_date >= '2026-01-24'
ORDER BY trade_date DESC;

-- Compare with VALR actual balances
-- (Manual verification required via VALR UI or API)

-- Check ledger entries for customer 47
SELECT 
  trade_date,
  kind,
  amount_btc,
  amount_usdt,
  platform_fee_btc,
  platform_fee_usdt,
  note
FROM lth_pvr.ledger_lines
WHERE customer_id = 47
  AND org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
  AND trade_date >= '2026-01-24'
ORDER BY trade_date, created_at;

-- =============================================================================
-- ROLLBACK SCRIPT (if cleanup goes wrong)
-- =============================================================================

/*
-- Restore from backup
INSERT INTO lth_pvr.exchange_funding_events
SELECT * FROM lth_pvr.exchange_funding_events_backup_20260126;

-- Re-run ef_post_ledger_and_balances to restore ledger and balances
*/

-- =============================================================================
-- CLEANUP (after verification complete)
-- =============================================================================

/*
-- Drop backup table (only after confirming everything works correctly)
DROP TABLE IF EXISTS lth_pvr.exchange_funding_events_backup_20260126;
*/
