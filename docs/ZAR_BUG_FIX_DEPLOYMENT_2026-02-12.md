# ZAR Transaction Support - Bug Fix Deployment Guide

**Date:** 2026-02-12  
**Version:** v0.6.38 (Bug Fixes #1-#5)  
**Status:** Ready for Deployment  

---

## Executive Summary

This deployment fixes **5 critical bugs** in ZAR transaction support identified during customer 999 testing on 27-28 Jan 2026:

1. **Bug #1:** ZAR deposits not detected (only SIMPLE_BUY handled, FIAT_DEPOSIT missed)
2. **Bug #2:** Incorrect zar_withdrawal records created (orphaned experimental code)
3. **Bug #3:** Partial conversion marks entire deposit as converted
4. **Bug #4:** Global sync timestamp misses transactions (no per-customer windows)
5. **Bug #5:** Admin UI hides partial conversions

**Plus improvement:** Per-customer sync windows with 1-hour safety buffer

---

## Changes Summary

### Edge Function Changes

**ef_sync_valr_transactions (v25 → v26)**
- ✅ Per-customer sync windows (replaces global timestamp)
- ✅ 1-hour safety buffer to catch late-reporting transactions
- ✅ 72-hour first-run window (was 24 hours)
- ✅ FIAT_DEPOSIT detection (in addition to SIMPLE_BUY)
- ✅ Enhanced logging with sync window details

### Database Schema Changes

**Migration 1: `20260212_zar_partial_conversion_tracking.sql`**
- Adds `converted_amount NUMERIC(15,2) DEFAULT 0` to `pending_zar_conversions`
- Adds `remaining_amount NUMERIC(15,2)` (calculated column)
- Rewrites `on_zar_conversion_resolve_pending()` trigger:
  - Accumulates conversions instead of marking complete immediately
  - Only marks complete when `remaining_amount <= 0.01 ZAR`
- Creates index on `remaining_amount` for performance

**Migration 2: `20260212_zar_admin_view_partial_conversions.sql`**
- Replaces `v_pending_zar_conversions` view
- Adds `original_zar_amount`, `converted_amount`, `remaining_amount`, `conversion_status` columns
- Updates WHERE clause: `(converted_at IS NULL OR remaining_amount > 0.01)`
- Shows partial conversions in Admin UI

**Migration 3: `20260212_zar_cleanup_incorrect_records.sql`**
- Deletes orphaned `zar_withdrawal` records for customer 999
- Targets records with `idempotency_key LIKE '%_ZAR_OUT'` or `metadata->>'type' = 'LIMIT_BUY'`
- Logs cleanup action to `alert_events`

**Migration 4: `20260212_zar_reprocess_customer_999.sql`**
- Manual reprocessing script (not auto-applied)
- Clears customer 999's 27-28 Jan transactions
- Triggers `ef_sync_valr_transactions` to refetch from VALR

---

## Pre-Deployment Verification

### 1. Verify Current Deployment State

```powershell
# Check deployed edge function version
curl -X GET "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_sync_valr_transactions" `
  -H "Authorization: Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
```

Expected: v25 deployed

### 2. Backup Current Data

```sql
-- Backup customer 999 funding events (27-28 Jan)
CREATE TABLE lth_pvr.exchange_funding_events_backup_20260212 AS
SELECT * FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date
  AND occurred_at < '2026-01-29'::date;

-- Backup pending conversions
CREATE TABLE lth_pvr.pending_zar_conversions_backup_20260212 AS
SELECT * FROM lth_pvr.pending_zar_conversions
WHERE customer_id = 999;
```

### 3. Verify Environment Variables

```powershell
# Check required variables exist
$env:SUPABASE_SERVICE_ROLE_KEY
$env:SUPABASE_URL
$env:VALR_API_KEY
$env:VALR_API_SECRET
```

---

## Deployment Steps

### Phase 1: Apply Database Migrations (5 minutes)

**Step 1.1: Apply Partial Conversion Tracking**
```powershell
# Navigate to project root
cd c:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr

# Apply migration 1
supabase db push --include supabase/migrations/20260212_zar_partial_conversion_tracking.sql
```

**Verification:**
```sql
-- Check columns added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'lth_pvr'
  AND table_name = 'pending_zar_conversions'
  AND column_name IN ('converted_amount', 'remaining_amount');

-- Expected: 2 rows returned
```

**Step 1.2: Apply Admin View Update**
```powershell
supabase db push --include supabase/migrations/20260212_zar_admin_view_partial_conversions.sql
```

**Verification:**
```sql
-- Check view columns
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'lth_pvr'
  AND table_name = 'v_pending_zar_conversions';

-- Expected: original_zar_amount, converted_amount, remaining_amount, conversion_status
```

**Step 1.3: Apply Data Cleanup**
```powershell
supabase db push --include supabase/migrations/20260212_zar_cleanup_incorrect_records.sql
```

**Verification:**
```sql
-- Check no incorrect records remain
SELECT COUNT(*) AS incorrect_records
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND kind = 'zar_withdrawal'
  AND (idempotency_key LIKE '%_ZAR_OUT' OR metadata->>'type' = 'LIMIT_BUY');

-- Expected: 0
```

---

### Phase 2: Deploy Edge Function (2 minutes)

**Step 2.1: Deploy ef_sync_valr_transactions v26**
```powershell
supabase functions deploy ef_sync_valr_transactions --no-verify-jwt --project-ref wqnmxpooabmedvtackji
```

**Verification:**
```powershell
# Test edge function
$response = Invoke-WebRequest `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_sync_valr_transactions" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
    "Content-Type" = "application/json"
  } `
  -Body '{}'

$response.Content
```

**Expected Output:**
```json
{
  "success": true,
  "message": "Per-customer sync windows configured for N customers"
}
```

---

### Phase 3: Reprocess Customer 999 Data (5 minutes)

**Step 3.1: Run Reprocess Script**
```sql
-- Execute in Supabase SQL Editor
-- File: supabase/migrations/20260212_zar_reprocess_customer_999.sql

-- STEP 1: Verify current state
SELECT 
  'Before cleanup' AS stage,
  kind,
  asset,
  amount,
  occurred_at
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date
  AND occurred_at < '2026-01-29'::date
ORDER BY occurred_at;

-- STEP 2: Delete incorrect records
DELETE FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date
  AND occurred_at < '2026-01-29'::date;

-- STEP 3: Clear pending conversions
DELETE FROM lth_pvr.pending_zar_conversions
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date;
```

**Step 3.2: Trigger Transaction Sync**
```powershell
# Reprocess transactions from VALR
Invoke-WebRequest `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_sync_valr_transactions" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
    "Content-Type" = "application/json"
  } `
  -Body '{}'
```

**Step 3.3: Verify Reprocessed Data**
```sql
-- STEP 5: Check funding events
SELECT 
  'After reprocess' AS stage,
  kind,
  asset,
  amount,
  occurred_at,
  metadata->>'zar_amount' AS zar_amount
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date
  AND occurred_at < '2026-01-29'::date
ORDER BY occurred_at;

-- EXPECTED RESULTS:
-- 1. zar_deposit for 21,000 ZAR (27 Jan 01:54) - NEW
-- 2. deposit for 9.277 USDT (27 Jan 07:44) with zar_amount = 150 - NEW
-- 3. deposit for 1,300.84 USDT (28 Jan 10:22) with zar_amount = 20,850

-- STEP 6: Check pending conversions
SELECT 
  original_zar_amount,
  converted_amount,
  remaining_amount,
  conversion_status
FROM lth_pvr.v_pending_zar_conversions
WHERE customer_id = 999
ORDER BY occurred_at;

-- EXPECTED: 1 row showing 21,000 ZAR with 21,000 converted (0 remaining)
```

---

### Phase 4: Smoke Test (10 minutes)

**Test 4.1: New ZAR Deposit Detection**
1. Deposit small amount (e.g., R100) via EFT to customer 999's VALR subaccount
2. Wait 5 minutes for VALR processing
3. Run sync (or wait for 30-minute cron job)
4. Verify `zar_deposit` created in database
5. Verify pending conversion appears in Admin UI

**Test 4.2: Partial Conversion**
1. Convert R20 to USDT on VALR
2. Click "Mark Done" in Admin UI
3. Verify pending conversion still shows with R80 remaining
4. Verify `conversion_status = 'partial'`

**Test 4.3: Complete Conversion**
1. Convert remaining R80 to USDT
2. Click "Mark Done"
3. Verify pending conversion disappears from Admin UI
4. Verify `converted_at` timestamp set

---

## Rollback Plan

### If Edge Function Fails

**Rollback to v25:**
```powershell
# Redeploy previous version
git checkout <previous_commit_hash> supabase/functions/ef_sync_valr_transactions/index.ts
supabase functions deploy ef_sync_valr_transactions --no-verify-jwt
```

### If Migrations Fail

**Restore from backup:**
```sql
-- Restore funding events
DELETE FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
  AND occurred_at >= '2026-01-27'::date
  AND occurred_at < '2026-01-29'::date;

INSERT INTO lth_pvr.exchange_funding_events
SELECT * FROM lth_pvr.exchange_funding_events_backup_20260212;

-- Restore pending conversions
DELETE FROM lth_pvr.pending_zar_conversions WHERE customer_id = 999;
INSERT INTO lth_pvr.pending_zar_conversions
SELECT * FROM lth_pvr.pending_zar_conversions_backup_20260212;
```

**Revert migrations:**
```sql
-- Revert migration 2 (view)
DROP VIEW IF EXISTS lth_pvr.v_pending_zar_conversions;
CREATE VIEW lth_pvr.v_pending_zar_conversions AS
SELECT 
  pzc.id,
  cd.customer_name,
  pzc.customer_id,
  pzc.zar_amount AS original_zar_amount,
  pzc.occurred_at,
  pzc.converted_at,
  cb.balance_usdt AS current_usdt_balance
FROM lth_pvr.pending_zar_conversions pzc
LEFT JOIN public.customer_details cd ON cd.customer_id = pzc.customer_id
LEFT JOIN lth_pvr.customer_balances cb ON cb.customer_id = pzc.customer_id
WHERE pzc.converted_at IS NULL; -- OLD LOGIC

-- Revert migration 1 (columns)
ALTER TABLE lth_pvr.pending_zar_conversions
DROP COLUMN IF EXISTS converted_amount,
DROP COLUMN IF EXISTS remaining_amount;

-- Drop trigger
DROP TRIGGER IF EXISTS on_zar_conversion_resolve ON lth_pvr.exchange_funding_events;
DROP FUNCTION IF EXISTS lth_pvr.on_zar_conversion_resolve_pending();

-- Recreate old trigger (basic version)
CREATE OR REPLACE FUNCTION lth_pvr.on_zar_conversion_resolve_pending()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE lth_pvr.pending_zar_conversions
  SET converted_at = NEW.occurred_at
  WHERE zar_deposit_id = (NEW.metadata->>'zar_deposit_id')::uuid
    AND converted_at IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_zar_conversion_resolve
AFTER INSERT ON lth_pvr.exchange_funding_events
FOR EACH ROW
WHEN (NEW.kind = 'deposit' AND NEW.metadata ? 'zar_deposit_id')
EXECUTE FUNCTION lth_pvr.on_zar_conversion_resolve_pending();
```

---

## Post-Deployment Monitoring

### Key Metrics to Watch (First 48 Hours)

1. **Alert Events**
```sql
SELECT component_name, severity, message, COUNT(*)
FROM lth_pvr.alert_events
WHERE created_at >= '2026-02-12'::date
GROUP BY component_name, severity, message
ORDER BY COUNT(*) DESC;
```

2. **Transaction Detection Rate**
```sql
-- Count transactions by type
SELECT kind, COUNT(*)
FROM lth_pvr.exchange_funding_events
WHERE occurred_at >= '2026-02-12'::date
GROUP BY kind;
```

3. **Pending Conversions**
```sql
SELECT conversion_status, COUNT(*)
FROM lth_pvr.v_pending_zar_conversions
GROUP BY conversion_status;
```

### Expected Behavior

- ✅ ZAR deposits detected within 30 minutes (sync interval)
- ✅ Partial conversions remain visible in Admin UI
- ✅ Per-customer sync windows in logs
- ✅ No zar_withdrawal records created for conversions
- ✅ Platform fees calculated correctly (0.75%)

---

## Documentation Updates

**Files to update after successful deployment:**

1. **DEPLOYMENT_COMPLETE.md**
   - Add "v0.6.38 - ZAR Transaction Bug Fixes (2026-02-12)" to changelog

2. **docs/SDD_v0.6.md**
   - Update "ZAR Transaction Support" section with bug fix notes
   - Add "Known Issues Resolved" subsection

3. **README.md** (if exists)
   - Note partial conversion tracking capability
   - Update sync window behavior

---

## Test Case Execution

**Execute comprehensive test plan:** See [ZAR_TRANSACTION_SUPPORT_TEST_CASES.md](./ZAR_TRANSACTION_SUPPORT_TEST_CASES.md)

**Critical tests (minimum):**
- [ ] TC-ZAR-001: FIAT_DEPOSIT Detection
- [ ] TC-ZAR-003: Small Partial Conversion
- [ ] TC-ZAR-005: Full Conversion Completion
- [ ] TC-ZAR-011: Reprocess Customer 999 Transactions
- [ ] TC-ZAR-014: Complete ZAR→USDT Flow

---

## Success Criteria

**Deployment considered successful when:**

- ✅ All 3 migrations applied without errors
- ✅ ef_sync_valr_transactions v26 deployed successfully
- ✅ Customer 999 data reprocessed correctly (3 expected transactions)
- ✅ Smoke tests pass (new deposit + partial conversion)
- ✅ No critical alerts in first 24 hours
- ✅ At least 5 test cases from comprehensive plan PASS

---

## Support & Troubleshooting

### Common Issues

**Issue:** "Relation 'converted_amount' does not exist"  
**Cause:** Migration 1 not applied  
**Fix:** Run `20260212_zar_partial_conversion_tracking.sql`

**Issue:** "Edge function returns 401"  
**Cause:** JWT verification enabled  
**Fix:** Redeploy with `--no-verify-jwt` flag

**Issue:** "Pending conversion not showing in Admin UI"  
**Cause:** View not updated or remaining_amount = 0  
**Fix:** Check migration 2 applied, verify remaining_amount > 0.01

**Issue:** "Multiple zar_deposit records for same transaction"  
**Cause:** Idempotency key failure  
**Fix:** Check VALR transaction_id format, verify unique constraint

### Contact

**Technical Owner:** Davin Gaier  
**Deployment Date:** 2026-02-12  
**Documentation:** [docs/ZAR_TRANSACTION_SUPPORT_TEST_CASES.md](./ZAR_TRANSACTION_SUPPORT_TEST_CASES.md)

---

## Deployment Sign-Off

- [ ] **Pre-Deployment Checks Complete**
  - [ ] Current state verified (v25 deployed)
  - [ ] Backups created
  - [ ] Environment variables checked

- [ ] **Phase 1: Migrations Applied**
  - [ ] Migration 1: Partial conversion tracking
  - [ ] Migration 2: Admin view update
  - [ ] Migration 3: Data cleanup

- [ ] **Phase 2: Edge Function Deployed**
  - [ ] ef_sync_valr_transactions v26 deployed
  - [ ] Verification test passed

- [ ] **Phase 3: Data Reprocessed**
  - [ ] Customer 999 transactions cleaned
  - [ ] Sync triggered
  - [ ] Expected records verified

- [ ] **Phase 4: Smoke Tests Passed**
  - [ ] New ZAR deposit detected
  - [ ] Partial conversion tested
  - [ ] Complete conversion tested

- [ ] **Post-Deployment**
  - [ ] Monitoring alerts configured
  - [ ] Documentation updated
  - [ ] Test plan executed (minimum 5 tests)

**Deployed By:** __________  
**Date:** __________  
**Time:** __________  
**Result:** ⬜ SUCCESS / ⬜ PARTIAL / ⬜ ROLLBACK
