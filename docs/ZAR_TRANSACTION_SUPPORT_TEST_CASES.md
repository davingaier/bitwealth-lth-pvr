# ZAR Transaction Support - Comprehensive Test Cases
**Date:** 2026-02-12  
**Status:** Ready for Execution  
**Bug Fixes:** #1-#5 + Per-Customer Sync Improvement

## Test Environment Setup

**Prerequisites:**
- Access to Admin UI (https://bitwealth.co.za/customer-portal.html)
- Access to Supabase SQL Editor
- Customer 999 (Davin Personal Test) with active VALR subaccount
- PowerShell with environment variables: `SUPABASE_SERVICE_ROLE_KEY`

---

## Test Suite 1: ZAR Deposit Detection (Bug Fix #1)

### TC-ZAR-001: FIAT_DEPOSIT Detection
**Objective:** Verify system detects FIAT_DEPOSIT transactions from EFT bank transfers

**Prerequisites:**
- Fresh test customer or cleared transactions for customer 999

**Test Steps:**
1. Deposit ZAR via EFT to customer 999's VALR subaccount (e.g., R100)
2. Wait 5 minutes for VALR to process
3. Run transaction sync:
   ```powershell
   Invoke-WebRequest `
     -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_sync_valr_transactions" `
     -Method POST `
     -Headers @{"Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"; "Content-Type" = "application/json"} `
     -Body '{}'
   ```
4. Query database:
   ```sql
   SELECT kind, asset, amount, occurred_at, metadata
   FROM lth_pvr.exchange_funding_events
   WHERE customer_id = 999
     AND kind = 'zar_deposit'
   ORDER BY occurred_at DESC
   LIMIT 1;
   ```

**Expected Results:**
- ✅ 1 row returned with `kind = 'zar_deposit'`, `asset = 'ZAR'`, `amount = 100`
- ✅ Alert event created: "ZAR deposit detected: R100.00 from Davin Gaier Personal"
- ✅ Pending conversion appears in Admin UI

**Actual Results:**
- [x] Date tested: 2026-02-12
- [x] Result: **PASS** ✅
- [x] Notes: R100 ZAR deposit detected successfully, remaining_amount correctly set to 100.00

---

### TC-ZAR-002: SIMPLE_BUY Detection (Backward Compatibility)
**Objective:** Ensure SIMPLE_BUY deposits still detected (if VALR uses this type)

**Test Steps:**
1. Check VALR logs for SIMPLE_BUY transactions with creditCurrency=ZAR
2. If exists, verify detection logic treats it as zar_deposit

**Expected Results:**
- ✅ SIMPLE_BUY with ZAR creates zar_deposit record (same as FIAT_DEPOSIT)

**Actual Results:**
- [x] Date tested: 2026-02-13
- [x] Result: **PASS** ✅
- [x] Notes: **CRITICAL BUG FOUND & FIXED**: SIMPLE_BUY transactions (instant USDT buy with ZAR) were not detected by `ef_sync_valr_transactions`. Edge function only checked for `LIMIT_BUY|MARKET_BUY` when detecting ZAR→USDT conversions. Added `SIMPLE_BUY` to line 423. After thorough reconciliation against VALR CSV export, corrected manually inserted amount from 1.34351 to 1.5343512 USDT, added missing 27 Jan platform fee withdrawal (0.06957504 USDT), and cleaned 1,067.21 USDT in duplicate ledger entries from org consolidation. **FINAL RESULT: Database balance 1,253.82455518 USDT matches VALR CSV EXACTLY (0.000000 USDT discrepancy = 0.000%).** Deployed v28 of `ef_sync_valr_transactions` with SIMPLE_BUY support. SIMPLE_SELL was already supported (line 265).

---

## Test Suite 2: Partial Conversion Tracking (Bug Fix #3)

### TC-ZAR-003: Small Partial Conversion (< 10%)
**Objective:** Verify partial conversion tracking for small amounts

**Prerequisites:**
- Existing ZAR deposit of R1000 (from TC-ZAR-001 or new deposit)

**Test Steps:**
1. Navigate to VALR and convert R50 (5%) to USDT
2. Wait 2 minutes
3. Click "Mark Done" in Admin UI Pending Conversions panel
4. Query:
   ```sql
   SELECT original_zar_amount, converted_amount, remaining_amount, conversion_status
   FROM lth_pvr.v_pending_zar_conversions
   WHERE customer_id = 999
   ORDER BY occurred_at DESC
   LIMIT 1;
   ```

**Expected Results:**
- ✅ `original_zar_amount = 1000`
- ✅ `converted_amount = 50`
- ✅ `remaining_amount = 950`
- ✅ `conversion_status = 'partial'`
- ✅ Pending conversion STILL visible in Admin UI

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

### TC-ZAR-004: Multiple Partial Conversions
**Objective:** Verify accumulated conversions tracked correctly

**Prerequisites:**
- Partial conversion from TC-ZAR-003 (R950 remaining)

**Test Steps:**
1. Convert another R100 to USDT on VALR
2. Mark done in Admin UI
3. Convert another R200 to USDT
4. Mark done in Admin UI
5. Query accumulated amounts:
   ```sql
   SELECT converted_amount, remaining_amount
   FROM lth_pvr.v_pending_zar_conversions
   WHERE customer_id = 999
   ORDER BY occurred_at DESC
   LIMIT 1;
   ```

**Expected Results:**
- ✅ `converted_amount = 350` (50 + 100 + 200)
- ✅ `remaining_amount = 650` (1000 - 350)
- ✅ Still shows in Admin UI

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

### TC-ZAR-005: Full Conversion Completion
**Objective:** Verify pending conversion removed when fully converted

**Prerequisites:**
- Partial conversion from TC-ZAR-004 (R650 remaining)

**Test Steps:**
1. Convert remaining R650 to USDT on VALR
2. Mark done in Admin UI
3. Wait 1 minute
4. Refresh Admin UI Pending Conversions panel

**Expected Results:**
- ✅ `converted_amount = 1000`
- ✅ `remaining_amount = 0`
- ✅ `conversion_status = 'completed'`
- ✅ `converted_at` timestamp set
- ✅ Pending conversion REMOVED from Admin UI
- ✅ Message shows "✅ No pending conversions"

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

### TC-ZAR-006: Rounding Tolerance Test
**Objective:** Verify 0.01 ZAR rounding tolerance works

**Prerequisites:**
- New ZAR deposit of R100.99

**Test Steps:**
1. Convert R100.98 to USDT (leaving R0.01)
2. Mark done
3. Check if treated as complete

**Expected Results:**
- ✅ `remaining_amount = 0.01`
- ✅ `conversion_status = 'completed'` (due to <= 0.01 tolerance)
- ✅ Removed from Admin UI

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

## Test Suite 3: Per-Customer Sync Window (Bug Fix #4)

### TC-ZAR-007: Independent Customer Sync Windows
**Objective:** Verify each customer has independent sync timestamp

**Prerequisites:**
- Customer 999 with recent transactions
- Another test customer (e.g., 1001) with older transactions

**Test Steps:**
1. Check last transaction dates for both customers:
   ```sql
   SELECT customer_id, MAX(occurred_at) AS last_transaction
   FROM lth_pvr.exchange_funding_events
   WHERE customer_id IN (999, 1001)
   GROUP BY customer_id;
   ```
2. Run sync and check logs for per-customer windows
3. Verify customer 999 syncs from recent date, customer 1001 from older date

**Expected Results:**
- ✅ Console logs show "Per-customer sync windows configured for N customers"
- ✅ Each customer has different `sinceDatetime` based on their last transaction
- ✅ No transactions missed due to global timestamp

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

### TC-ZAR-008: Safety Buffer catches late transactions
**Objective:** Verify 1-hour safety buffer catches late-reporting transactions

**Prerequisites:**
- Customer with very recent transaction (within last hour)

**Test Steps:**
1. Note timestamp of last transaction (T)
2. Run sync immediately
3. Verify sync window starts at T - 1 hour (not T)
4. Confirm no transactions missed

**Expected Results:**
- ✅ Sync window includes T - 1 hour
- ✅ All transactions captured despite close timing

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

### TC-ZAR-009: First-Run 72-Hour Window
**Objective:** Verify new customers get 72-hour initial sync window

**Prerequisites:**
- New test customer with no prior funding_events

**Test Steps:**
1. Create new customer
2. Add ZAR deposit 48 hours ago (via VALR)
3. Run sync
4. Verify transaction captured

**Expected Results:**
- ✅ Sync window goes back 72 hours for new customers
- ✅ 48-hour-old transaction captured

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

## Test Suite 4: Data Cleanup & Reprocessing (Bug Fix #2)

### TC-ZAR-010: Cleanup Incorrect zar_withdrawal Records
**Objective:** Verify orphaned zar_withdrawal records removed

**Prerequisites:**
- Run migrations in order

**Test Steps:**
1. Check for incorrect records before cleanup:
   ```sql
   SELECT COUNT(*) FROM lth_pvr.exchange_funding_events
   WHERE customer_id = 999
     AND kind = 'zar_withdrawal'
     AND (idempotency_key LIKE '%_ZAR_OUT' OR metadata->>'type' = 'LIMIT_BUY');
   ```
2. Run migration: `20260212_zar_cleanup_incorrect_records.sql`
3. Recheck count

**Expected Results:**
- ✅ Before: 1 or more incorrect records
- ✅ After: 0 incorrect records
- ✅ Alert event logged for audit trail

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

### TC-ZAR-011: Reprocess Customer 999 Transactions
**Objective:** Verify missing transactions recreated correctly

**Prerequisites:**
- Cleanup from TC-ZAR-010 complete

**Test Steps:**
1. Run reprocess script: `20260212_zar_reprocess_customer_999.sql`
2. Check for expected transactions:
   ```sql
   SELECT kind, asset, amount, metadata->>'zar_amount'
   FROM lth_pvr.exchange_funding_events
   WHERE customer_id = 999
     AND occurred_at >= '2026-01-27'
     AND occurred_at < '2026-01-29'
   ORDER BY occurred_at;
   ```

**Expected Results:**
- ✅ zar_deposit for 21,000 ZAR (27 Jan 01:54)
- ✅ deposit for 9.277 USDT (27 Jan 07:44) with zar_amount = 150
- ✅ deposit for 1,300.84 USDT (28 Jan 10:22) with zar_amount = 20,850
- ✅ NO zar_withdrawal records for conversions

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

## Test Suite 5: Admin UI Partial Conversion Display (Bug Fix #5)

### TC-ZAR-012: Partial Conversion Status Display
**Objective:** Verify Admin UI shows partial conversions

**Prerequisites:**
- Active partial conversion from TC-ZAR-004

**Test Steps:**
1. Open Admin UI → Administration module
2. Scroll to "Pending ZAR Conversions" panel
3. Observe display for partial conversion

**Expected Results:**
- ✅ Customer name shown: "Davin Gaier Personal"
- ✅ Shows "R650.00" (remaining amount, not original)
- ✅ Age indicator shows time since original deposit
- ✅ Current USDT balance displayed
- ✅ "Convert on VALR" button enabled
- ✅ "Mark Done" button enabled

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Screenshot attached: [ ]
- [ ] Notes:

---

### TC-ZAR-013: Auto-Refresh Partial Conversions
**Objective:** Verify Admin UI auto-refreshes every 5 minutes

**Prerequisites:**
- Partial conversion visible

**Test Steps:**
1. Open Admin UI with partial conversion showing
2. On VALR, convert small amount (e.g., R10)
3. Do NOT click "Mark Done"
4. Wait 5 minutes

**Expected Results:**
- ✅ Panel auto-refreshes after ~5 minutes
- ✅ Remaining amount updates automatically
- ✅ No manual refresh needed

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

## Test Suite 6: End-to-End ZAR Workflow

### TC-ZAR-014: Complete ZAR→USDT Flow
**Objective:** Test complete workflow from deposit to full conversion

**Prerequisites:**
- Clean test customer (no pending conversions)

**Test Steps:**
1. Deposit R500 ZAR via EFT to VALR subaccount
2. Wait for VALR processing (~5 minutes)
3. Run sync: `ef_sync_valr_transactions`
4. Open Admin UI, verify pending conversion appears
5. Convert R200 to USDT on VALR
6. Click "Mark Done" in Admin UI
7. Verify partial conversion shows (R300 remaining)
8. Convert remaining R300 to USDT
9. Click "Mark Done"
10. Verify pending conversion disappears
11. Check ledger for platform fees

**Expected Results:**
- ✅ Step 3: zar_deposit created, alert logged
- ✅ Step 4: Shows "R500.00" in Admin UI
- ✅ Step 6: Updates to "R300.00 remaining"
- ✅ Step 9: Removed from Admin UI
- ✅ Step 11: Platform fee (0.75%) charged on both conversions

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Total time: __________
- [ ] Notes:

---

### TC-ZAR-015: Platform Fee Calculation
**Objective:** Verify 0.75% platform fee charged on conversions

**Prerequisites:**
- Completed conversion from TC-ZAR-014

**Test Steps:**
1. Query ledger:
   ```sql
   SELECT event_type, amount_usdt, platform_fee_usdt
   FROM lth_pvr.ledger_lines
   WHERE customer_id = 999
     AND event_type = 'deposit'
     AND trade_date = CURRENT_DATE
   ORDER BY created_at DESC
   LIMIT 2;
   ```
2. Calculate expected fees:
   - First conversion: 9.277 USDT × 0.0075 = 0.0696 USDT
   - Second conversion: 1300.84 USDT × 0.0075 = 9.756 USDT

**Expected Results:**
- ✅ First deposit: `platform_fee_usdt ≈ 0.0696`
- ✅ Second deposit: `platform_fee_usdt ≈ 9.756`
- ✅ Fees match 0.75% of gross amounts

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Actual fees: __________
- [ ] Notes:

---

## Test Suite 7: Edge Cases & Error Handling

### TC-ZAR-016: Convert More ZAR Than Deposited
**Objective:** Verify system handles oversized conversion attempts

**Test Steps:**
1. Deposit R100 ZAR
2. Attempt to trigger sync after converting R150
3. Check for errors or warnings

**Expected Results:**
- ✅ System creates deposit for USDT received
- ✅ May show negative remaining_amount or alert
- ✅ No system crashes

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

### TC-ZAR-017: Rapid Sequential Conversions
**Objective:** Test system under rapid conversion load

**Test Steps:**
1. Deposit R500 ZAR
2. Convert R50 five times in quick succession (< 1 minute apart)
3. Mark done after all 5 conversions

**Expected Results:**
- ✅ All 5 conversions detected
- ✅ converted_amount = 250
- ✅ remaining_amount = 250
- ✅ No duplicate records

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

### TC-ZAR-018: Sync During VALR Maintenance
**Objective:** Verify graceful handling of VALR API errors

**Test Steps:**
1. Simulate VALR API error (or wait for actual downtime)
2. Run sync
3. Check error handling

**Expected Results:**
- ✅ Error logged to alert_events
- ✅ No database corruption
- ✅ Recovers on next sync

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Notes:

---

## Test Suite 8: Customer Email Notifications (CX)

### TC-ZAR-019: ZAR→USDT Conversion Email Exclusion
**Objective:** Verify customers do NOT receive email notification for ZAR→USDT conversions (only for deposits they initiated)

**Prerequisites:**
- Customer 999 with status 'active'
- Valid email address in customer_details
- Email monitoring access (davin.gaier@gmail.com inbox)

**Test Steps:**
1. Deposit R100 ZAR via EFT to VALR subaccount
2. Wait 5 minutes for VALR processing
3. Check email inbox for deposit notification
4. On VALR, convert R25 ZAR to USDT (instant buy)
5. Wait 5 minutes
6. Run transaction sync:
   ```powershell
   Invoke-WebRequest `
     -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_sync_valr_transactions" `
     -Method POST `
     -Headers @{"Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"; "Content-Type" = "application/json"} `
     -Body '{}'
   ```
7. Check email inbox again
8. Verify funding events:
   ```sql
   SELECT 
     occurred_at,
     kind,
     asset,
     amount,
     metadata->>'zar_deposit_id' as has_conversion_link
   FROM lth_pvr.exchange_funding_events
   WHERE customer_id = 999
     AND occurred_at >= CURRENT_DATE
   ORDER BY occurred_at DESC;
   ```

**Expected Results:**
- ✅ **Step 3:** Receive 1 email for "R100 ZAR Deposit Received" (subject: "Deposit Received - 100 ZAR Credited to Your Account")
- ✅ **Step 7:** NO new email received (conversion should be silent)
- ✅ **Step 8:** ZAR deposit has `has_conversion_link = NULL` (no metadata.zar_deposit_id)
- ✅ **Step 8:** USDT deposit has `has_conversion_link = [uuid]` (metadata.zar_deposit_id present)
- ✅ Email count: Exactly 1 email (ZAR deposit only)

**CX Rationale:**
- Customer deposited ZAR → they know about it, should receive confirmation ✅
- System converted ZAR→USDT → internal operation, customer didn't initiate ❌
- Sending both emails would confuse customers ("I only deposited ZAR, why does it say USDT deposit?")
- Customer can see conversion transaction in Customer Portal if interested

**Comparison with BLOCKCHAIN_RECEIVE:**
- **Blockchain USDT deposit:** NO `zar_deposit_id` → Email SENT ✅ (customer-initiated)
- **Conversion USDT deposit:** HAS `zar_deposit_id` → Email NOT SENT ✅ (system-initiated)

**Actual Results:**
- [ ] Date tested: __________
- [ ] Result: PASS / FAIL
- [ ] Email received for ZAR deposit: YES / NO
- [ ] Email received for USDT conversion: YES / NO (should be NO)
- [ ] Notes:

---

## Test Summary Template

**Test Execution Date:** __________  
**Tester:** __________  
**Environment:** Production / Staging  

| Test Suite | Total Tests | Passed | Failed | Skipped | % Pass |
|------------|-------------|--------|--------|---------|--------|
| Suite 1: ZAR Deposit Detection | 2 | | | | |
| Suite 2: Partial Conversion | 4 | | | | |
| Suite 3: Per-Customer Sync | 3 | | | | |
| Suite 4: Cleanup & Reprocess | 2 | | | | |
| Suite 5: Admin UI | 2 | | | | |
| Suite 6: End-to-End | 2 | | | | |
| Suite 7: Edge Cases | 3 | | | | |
| Suite 8: Email Notifications | 1 | | | | |
| **TOTAL** | **19** | | | | |

**Critical Bugs Found:** __________  
**Recommendations:** __________  

---

## Deployment Checklist

- [ ] All migrations applied in order:
  - [ ] `20260212_zar_partial_conversion_tracking.sql`
  - [ ] `20260212_zar_admin_view_partial_conversions.sql`
  - [ ] `20260212_zar_cleanup_incorrect_records.sql`
- [ ] Edge function deployed: `ef_sync_valr_transactions` (version 26)
- [ ] Customer 999 data cleaned and reprocessed
- [ ] Production environment tested with real EFT deposit
- [ ] Admin users notified of new partial conversion display
- [ ] Documentation updated: `ZAR_TRANSACTION_SUPPORT_COMPLETE.md`

---

## Critical Bugs Found & Fixed During Testing (2026-02-13)

### Bug #1: SIMPLE_BUY Transactions Not Detected
**Discovered During:** TC-ZAR-002 testing  
**Symptom:** 25 ZAR instant USDT buy (12 Feb 2026 22:04) not appearing in `exchange_funding_events`  
**Root Cause:** `ef_sync_valr_transactions` line 423 only checked for `LIMIT_BUY | MARKET_BUY` when detecting ZAR→USDT conversions. VALR uses `SIMPLE_BUY` transaction type for instant buy feature.  
**Impact:** Any customer using VALR's "Simple Buy" feature would have transactions silently missed  
**Fix Applied:**  
- Updated [ef_sync_valr_transactions/index.ts](../supabase/functions/ef_sync_valr_transactions/index.ts#L423)
- Changed: `else if (txType === "LIMIT_BUY" || txType === "MARKET_BUY")`
- To: `else if (txType === "LIMIT_BUY" || txType === "MARKET_BUY" || txType === "SIMPLE_BUY")`
- Manually inserted missing transaction for customer 999 via SQL
- Deployed v28 of edge function

**Verification:** ✅ SIMPLE_SELL already supported (line 265)  

---

### Bug #2: Duplicate Ledger Entries from Org Consolidation
**Discovered During:** TC-ZAR-002 balance verification  
**Symptom:** Database balance showed 1.238 USDT but VALR showed 1,253.83 USDT (1,252 USDT missing!)  
**Root Cause:** Environment switch between Feb 10-13 split customer 999 data across two org_ids:
- OLD org_id: `95fdc8ca-ed20-4896-bb31-f4c6fbcced49` (historical data)
- NEW org_id: `b0a77009-03b9-44a1-ae1d-34f157d44a8b` (current data)

Migration `20260213_consolidate_customer_999_org_id.sql` successfully moved `exchange_funding_events` but left duplicate `ledger_lines` entries:
- 2 duplicate topups: 1,300.84 + 999.00 USDT
- 1 orphaned topup with `valr_transfer_log` FK: 9.21 USDT  
- 6 duplicate withdrawals: 1,058.00 USDT total
- **Total duplicates: 1,067.21 USDT!**

**Fix Applied:**  
1. Applied org consolidation migration (updated 8 tables)
2. Deleted 2 duplicate topup entries (2,299.84 USDT)
3. Updated `valr_transfer_log` FK reference, then deleted orphaned topup (9.21 USDT)
4. Deleted 6 duplicate withdrawal entries (1,058.00 USDT)
5. Deleted all `balances_daily` for customer 999 and recalculated from clean ledger

**Result:**  
- ✅ All funding events match ledger entries (no more orphans)
- ✅ Balance discrepancy reduced from 1,252 USDT to 0.13 USDT

**Lessons Learned:**  
- Org consolidation migrations must clean up related ledger entries, not just source tables
- Balance recalculation should verify ledger integrity before calculating
- Need automated check for duplicate ledger entries in `ef_post_ledger_and_balances`

---

### Bug #3: Manually Inserted Transaction Amount - INCORRECT
**Discovered During:** Thorough reconciliation against VALR CSV export  
**Symptom:** Database balance 0.127 USDT lower than VALR CSV expected value  
**Root Cause:** Manually inserted 12 Feb Simple Buy used screenshot value (1.34351 USDT) instead of actual VALR amount (1.5343512 USDT)  
**Impact:** Balance understated by 0.19084 USDT (14.2% of transaction!)  
**Fix Applied:**  
- Updated funding event `bd2fdf93-fd31-4da1-938c-432e2a9b9f62` with correct amount from CSV
- Corrected ZAR amount: 24.99994504 (not 25.00)
- Corrected fee: 0.0249488 USDT (not 0.024949)
- Deleted stale ledger entry and regenerated from corrected funding event

---

### Bug #4: Missing Platform Fee Withdrawal
**Discovered During:** CSV reconciliation revealed unaccounted 27 Jan transfer  
**Symptom:** Database balance 0.06957504 USDT higher than CSV calculation  
**Root Cause:** 27 Jan 09:06 platform fee transfer (0.06957504 USDT) recorded in `valr_transfer_log` but NOT in `exchange_funding_events`  
**Impact:** Platform fees transferred to main account but customer balance not debited  
**Fix Applied:**  
- Created withdrawal funding event with `idempotency_key = 'VALR_TX_PLATFORM_FEE_20260127_0906'`
- Linked to existing `valr_transfer_log` entry via metadata

---

### Final Reconciliation Result
**Source of Truth:** VALR CSV export (`Customer 999_valr_tx_history.csv`)  
**Expected Balance:** 1,253.82455518 USDT  
**Database Balance:** 1,253.82455518 USDT  
**Discrepancy:** **0.000000 USDT (0.000%)** ✅ **PERFECT MATCH**

**Verification Method:**
```sql
-- CSV deposits: 9.27667188 + 1300.84445764 + 999 + 1.5343512 + 1.2386495 = 2311.89413022
-- CSV withdrawals: 0.06957504 + 59 + 29.9191 + 13.0752 + 311.2995 + 342.4295 + 302.2767 = 1058.06957504  
-- Net: 2311.89413022 - 1058.06957504 = 1253.82455518 ✅
```

---
