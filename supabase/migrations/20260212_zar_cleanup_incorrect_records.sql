-- Migration: Cleanup incorrect ZAR transaction records for customer 999
-- Date: 2026-02-12
-- Purpose: Remove orphaned zar_withdrawal records created by old experimental code
-- Bug Fix: #2 - Incorrect ZAR Withdrawal Created for Conversions

-- SAFETY: Only delete records for customer 999 (test customer)
-- REASON: These were created by old code (paired_with logic) that no longer exists

-- Step 1: Identify the incorrect records
-- These are zar_withdrawal records where:
-- - customer_id = 999
-- - kind = 'zar_withdrawal'
-- - occurred_at matches a LIMIT_BUY conversion
-- - metadata contains 'paired_with' or 'type' = 'LIMIT_BUY'

DO $$
DECLARE
  v_deleted_count INT;
BEGIN
  -- Delete incorrect zar_withdrawal for second conversion (28 Jan 2026)
  -- This has idempotency_key ending in _ZAR_OUT and metadata.type = 'LIMIT_BUY'
  DELETE FROM lth_pvr.exchange_funding_events
  WHERE customer_id = 999
    AND kind = 'zar_withdrawal'
    AND asset = 'ZAR'
    AND occurred_at >= '2026-01-28'::date
    AND occurred_at < '2026-01-29'::date
    AND (
      idempotency_key LIKE '%_ZAR_OUT'
      OR metadata->>'type' = 'LIMIT_BUY'
      OR metadata ? 'paired_with'
    );
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RAISE NOTICE 'Deleted % incorrect zar_withdrawal record(s) for customer 999', v_deleted_count;
  
  -- Log the cleanup action
  INSERT INTO lth_pvr.alert_events (
    org_id,
    customer_id,
    component,
    severity,
    message,
    context
  ) VALUES (
    'b0a77009-03b9-44a1-ae1d-34f157d44a8b'::uuid,
    999,
    'migration_20260212_cleanup',
    'info',
    'Cleaned up incorrect zar_withdrawal records created by old experimental code',
    jsonb_build_object(
      'deleted_count', v_deleted_count,
      'migration_date', CURRENT_DATE
    )
  );
END $$;

-- Step 2: Verify no orphaned records remain
SELECT 
  funding_id,
  kind,
  amount,
  occurred_at,
  idempotency_key,
  metadata
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND kind = 'zar_withdrawal'
  AND (
    idempotency_key LIKE '%_ZAR_OUT'
    OR metadata->>'type' = 'LIMIT_BUY'
    OR metadata ? 'paired_with'
  )
ORDER BY occurred_at;

-- Expected: 0 rows

COMMENT ON TABLE lth_pvr.exchange_funding_events IS 
'Funding events for customer portfolios. Note: ZAR→USDT conversions should create ONLY deposit records (USDT in), NOT zar_withdrawal records.';
