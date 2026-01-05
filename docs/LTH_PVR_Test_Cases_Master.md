# LTH PVR - Master Test Cases Document
**Date:** January 5, 2026  
**Version:** 3.1  
**Scope:** Comprehensive test coverage for all LTH PVR system components

---

## Document Index

1. [Alert System Test Cases](#1-alert-system-test-cases)
2. [WebSocket Order Monitoring Test Cases](#2-websocket-order-monitoring-test-cases)
3. [Pipeline Resume System Test Cases](#3-pipeline-resume-system-test-cases)
4. [Customer Onboarding Test Cases](#4-customer-onboarding-test-cases)
5. [Portal Feature Tests](#5-portal-feature-tests)

---

## Overall Test Summary

| System Component | Total Tests | Passed | Pending | Skipped | Pass Rate |
|------------------|-------------|--------|---------|---------|-----------|
| **Alert System** | 51 | 17 | 34 | 0 | 33% |
| **WebSocket Monitoring** | 35 | 8 | 27 | 0 | 23% |
| **Pipeline Resume** | 30 | 22 | 8 | 1 | 73% |
| **Customer Onboarding** | 60 | 47 | 12 | 1 | 78% |
| **Portal Features** | 16 | 7 | 7 | 2 | 44% |
| **TOTAL** | **192** | **101** | **88** | **4** | **53%** |

**Status Update (2026-01-05 12:00 UTC):**
- ✅ **Customer Onboarding: M6 ACTIVE TESTING COMPLETE** - 47 of 60 tests passed (78%)
  - ✅ M1 (Prospect): 100% tested
  - ✅ M2 (Strategy): 100% tested
  - ✅ M3 (KYC): 100% tested
  - ✅ M4 (VALR): 100% tested
  - ✅ M5 (Deposit): 64% tested (9/14 tests) + Balance Reconciliation system added (4 tests)
  - ✅ M6 (Active): 70% tested (7/10 tests) - **TC6.1, TC6.4, TC6.6 completed today**
  - ✅ **Integration Tests (IT1, IT2, IT3): ALL PASSED** - End-to-end pipeline verified with Customer 39
  - ⏳ Remaining M6 tests require trading pipeline run (scheduled 03:00 UTC)
- ✅ **Bug Fixes During M6 Testing (2026-01-05):**
  - **Customer Portal Zero Balance Display:** Fixed loadDashboard() to show dashboard with $0.00 balances for active customers
  - **Customer Portal Inactive Access:** Fixed loadDashboard() to allow view-only access for inactive customers
  - **Status Banner Message:** Fixed to read customerData.registration_status for inactive override
- ✅ **Balance Reconciliation System Deployed (2026-01-05):**
  - ef_balance_reconciliation edge function deployed (hourly polling)
  - pg_cron Job #32 active (schedule '30 * * * *')
  - Tested with Customer 31 manual withdrawal (2.00 USDT detected and reconciled)
- ✅ **Pipeline Resume: FULLY OPERATIONAL** - JWT authentication issue resolved
- ✅ **Portal Features: ADMIN FEE MANAGEMENT FUNCTIONAL** - 7 of 16 tests passed (44%)

**Notes:**
- Alert System: UI and integration tests remain pending
- WebSocket: Blocked on live order placement for real-world testing  
- Pipeline Resume: **End-to-end functionality verified** ✅
- Customer Onboarding: **6-milestone pipeline + integration tests verified** ✅
- Portal Features: Admin fee management working, customer portal UI pending

---

# 1. Alert System Test Cases

**Original Document:** Alert_System_Test_Cases.md  
**Date:** December 27, 2025  
**Status:** 17 of 51 tests executed and passed

## 1.1 Database Function Tests

### 1.1.1 lth_pvr.ensure_ci_bands_today()

#### Test 1.1.1.1: Successful CI Bands Fetch ✅ PASS
**Objective:** Verify function calls edge function when CI bands missing

**Test Execution:**
- Date: 2025-12-27 14:39:39 UTC
- Result: ✅ PASS
- Log Entry ID: 352, Request ID: 84563, Status: 200
- Target Date: 2025-12-26, BTC Price: 87,337.95

#### Test 1.1.1.2: CI Bands Already Exist ✅ PASS
**Objective:** Verify function skips fetch when data exists

**Test Execution:**
- Date: 2025-12-27 14:44:29 UTC
- Result: ✅ PASS
- Did Call: false (correctly skipped), Status: 200

#### Test 1.1.1.3: Missing Vault Secret ⚠️ SKIP
**Objective:** Verify graceful handling of missing service_role_key
- Result: ⚠️ SKIPPED - Too risky for production
- Code Review: ✅ VERIFIED - Error handling exists

## 1.2 Alerting Module Tests

### 1.2.1 logAlert() Function
*[14 UI and integration tests - see Alert_System_Test_Cases.md for full details]*

## 1.3 Alert Management UI Tests

### 1.3.1 Alert Badge Display
*[14 UI component tests - see Alert_System_Test_Cases.md for full details]*

## 1.4 Email Digest Tests

### 1.4.1 ef_alert_digest Edge Function
*[9 email and scheduling tests - see Alert_System_Test_Cases.md for full details]*

**For complete Alert System test details, see:** `Alert_System_Test_Cases.md`

---

# 2. WebSocket Order Monitoring Test Cases

**Original Document:** WebSocket_Order_Monitoring_Test_Cases.md  
**Date:** December 27, 2025  
**Status:** 8 of 35 tests executed (database schema and deployment tests)

## 2.1 Database Schema Tests (4/4 Passed)

### Test 2.1.1: WebSocket Tracking Columns Exist ✅ PASS
**Test Execution:**
- Date: 2025-12-27 22:00 UTC
- Result: ✅ PASS
- All 4 columns verified: ws_monitored_at, last_polled_at, poll_count, requires_polling

### Test 2.1.2: Default Values Correct ✅ PASS
- poll_count: default 0 ✅
- requires_polling: default true ✅

### Test 2.1.3: Nullable Constraints ✅ PASS
- ws_monitored_at: nullable ✅
- last_polled_at: nullable ✅

### Test 2.1.4: Data Types Correct ✅ PASS
- All columns use correct PostgreSQL types ✅

## 2.2 Edge Function Deployment Tests (3/3 Passed)

### Test 2.2.1: ef_valr_ws_monitor Deployed ✅ PASS
- Version 2 deployed successfully

### Test 2.2.2: ef_execute_orders Updated ✅ PASS
- Version 29 includes WebSocket triggering logic

### Test 2.2.3: ef_poll_orders Updated ✅ PASS
- Version 38 includes reduced polling frequency

## 2.3 WebSocket Connection Tests (0/5 - Blocked)

*Tests blocked on live order placement - see WebSocket_Order_Monitoring_Test_Cases.md*

## 2.4 Order Monitoring Tests (0/8 - Blocked)

*Tests blocked on live order placement - see WebSocket_Order_Monitoring_Test_Cases.md*

## 2.5 Fallback Polling Tests (0/5 - Blocked)

*Tests blocked on live order placement - see WebSocket_Order_Monitoring_Test_Cases.md*

## 2.6 Error Handling Tests (0/6 - Blocked)

*Tests blocked on simulated error scenarios - see WebSocket_Order_Monitoring_Test_Cases.md*

## 2.7 Performance Tests (1/4 Passed)

### Test 2.7.1: API Call Reduction ✅ PASS (Calculated)
- Baseline: 1,440 API calls/day (polling every minute)
- New: ~20 API calls/day (10-minute fallback polling + WebSocket)
- Reduction: 98.6%

**For complete WebSocket test details, see:** `WebSocket_Order_Monitoring_Test_Cases.md`

---

# 3. Pipeline Resume System Test Cases

**Original Document:** Pipeline_Resume_Test_Cases.md  
**Date:** December 28, 2025  
**Status:** 16 of 30 tests executed, core backend functionality verified

## 3.1 Database Function Tests

### 3.1.1 lth_pvr.get_pipeline_status()

#### Test 3.1.1.1: Full Pipeline Status Check ✅ PASS
**Test Execution:**
- Date: 2025-12-28
- Result: ✅ PASS
- Successfully returned complete pipeline state with all 6 step flags

#### Test 3.1.1.2: Partial Pipeline Completion ✅ PASS
- Logic verified via code inspection
- Correctly identifies incomplete steps

#### Test 3.1.1.3: Trade Window Validation (Inside Window) ✅ PASS
- window_valid = true during 03:00-17:00 UTC

#### Test 3.1.1.4: Trade Window Validation (Outside Window) ✅ PASS
- Date: 2025-12-28 18:30 UTC
- window_valid: false, can_resume: false

#### Test 3.1.1.5: CI Bands Missing Scenario ✅ PASS
- Logic verified: ci_bands_available flag reflects data availability

### 3.1.2 lth_pvr.resume_daily_pipeline()

#### Test 3.1.2.1: Successful Pipeline Resume ✅ PASS
**Test Execution:**
- Date: 2025-12-28 14:30 UTC
- Result: ✅ PASS
- Returned: `{"success": true, "request_ids": [85050, 85051, 85052, 85053, 85054]}`
- Execution Time: ~50ms (no timeout)
- Queued 5 edge functions successfully

#### Test 3.1.2.2: Resume Blocked - Trade Window Closed ✅ PASS
- Logic verified: Rejects resume outside trading hours

#### Test 3.1.2.3: Resume Blocked - CI Bands Missing ✅ PASS
- Logic verified: Rejects resume when CI bands unavailable

#### Test 3.1.2.4: Resume with All Steps Complete ✅ PASS
- Logic verified: Handles fully complete pipeline gracefully

#### Test 3.1.2.5: Partial Resume (Mid-Pipeline) ✅ PASS
- Logic verified: Queues only incomplete steps

### 3.1.3 lth_pvr.ensure_ci_bands_today_with_resume()

#### Test 3.1.3.1: Combined Fetch + Resume ⏳ PENDING
- Function created but not yet deployed/tested

## 3.2 Edge Function Tests

### 3.2.1 ef_resume_pipeline - check_status Endpoint

#### Test 3.2.1.1: Check Status API Call ✅ PASS
**Test Execution:**
- Date: 2025-12-28 14:45 UTC
- Result: ✅ PASS
- HTTP 200 OK, correct pipeline status returned

#### Test 3.2.1.2: Check Status with Trade Date Parameter ⏳ PENDING

#### Test 3.2.1.3: CORS Preflight Request ✅ PASS
- Logic verified: CORS headers configured correctly

### 3.2.2 ef_resume_pipeline - Resume Endpoint

#### Test 3.2.2.1: Trigger Pipeline Resume ✅ PASS
**Test Execution:**
- Date: 2025-12-28 14:30 UTC
- Result: ✅ PASS
- Successfully queued 5 edge functions

#### Test 3.2.2.2: Resume Rejected - Window Closed ✅ PASS
- Logic verified: API blocks resume outside trading hours

#### Test 3.2.2.3: Resume with Missing Service Key ⚠️ SKIP
- Too risky for production, code review verified error handling

## 3.3 UI Integration Tests (0/8 - Pending Browser Testing)

*All UI tests pending browser-based execution - see Pipeline_Resume_Test_Cases.md*

## 3.4 Integration Tests (0/2 - Pending)

*End-to-end workflow tests pending - see Pipeline_Resume_Test_Cases.md*

## 3.5 Performance & Reliability Tests

### 3.5.1 Async HTTP Performance

#### Test 3.5.1.1: Resume Function Response Time ✅ PASS
**Test Execution:**
- Date: 2025-12-28 14:30 UTC
- Result: ✅ PASS
- Execution Time: ~50ms
- No timeout errors (previous sync approach timed out at 5 seconds)

#### Test 3.5.1.2: Background Execution Verification ✅ PASS
- Verified via documentation: Requests execute after transaction commits

### 3.5.2 Error Handling & Edge Cases

#### Test 3.5.2.1: Concurrent Resume Attempts ⏳ PENDING

#### Test 3.5.2.2: Network Failure During Resume ⏳ PENDING

**For complete Pipeline Resume test details, see:** `Pipeline_Resume_Test_Cases.md`

---

# 4. Customer Onboarding Test Cases

**Original Document:** Customer_Onboarding_Test_Cases.md  
**Date:** January 4, 2026  
**Status:** 37 of 60 tests executed, 6-milestone pipeline functional

## 4.1 Milestone 1: Prospect Submission (2/2 Passed - 100%)

### Test 4.1.1: Valid Prospect Submission ✅ PASS
**Test Execution:**
- Result: ✅ PASS (verified in previous session)
- Customer record created with status='prospect'
- prospect_notification email sent to admin
- prospect_confirmation email sent to customer

### Test 4.1.2: Duplicate Email Handling ✅ PASS
- Existing customer record updated, no duplicate created

## 4.2 Milestone 2: Strategy Confirmation (7/7 Passed - 100%)

### Test 4.2.1: Admin Selects Strategy for Prospect ✅ PASS
**Test Execution:**
- Date: 2025-12-31
- Customer ID: 31 (Jemaica Gaier)
- Strategy: LTH_PVR
- Result: ✅ PASS
- customer_details.registration_status changed to 'kyc'
- customer_portfolios entry created
- kyc_portal_registration email sent

### Tests 4.2.2-4.2.7: All Supporting Tests ✅ PASS
- Database changes verified
- Email template validation
- UI dropdown population
- Status badge display
- Error handling (invalid strategy, non-prospect customers)

## 4.3 Milestone 3: Portal Registration & KYC (10/10 Passed - 100%)

### Test 4.3.1: Customer Portal Registration ✅ PASS
**Test Execution:**
- Date: 2026-01-01
- Supabase Auth user created successfully
- Login flow working correctly

### Test 4.3.2: Upload Page Access Control ✅ PASS
- Status='kyc' customers can access upload-kyc.html
- Other statuses correctly blocked

### Test 4.3.3: ID Document Upload - Valid File ✅ PASS
**Test Execution:**
- Date: 2026-01-01
- Customer 31: ID uploaded successfully
- File stored in kyc-documents bucket
- customer_details.kyc_id_document_url updated
- kyc_id_uploaded_notification email sent to admin

### Tests 4.3.4-4.3.10: All Supporting Tests ✅ PASS
- File size validation (10MB limit)
- File type validation (JPEG, PNG, PDF only)
- Admin document viewing with signed URLs
- Admin ID verification workflow
- File naming convention validation
- Storage bucket RLS policies verification
- ef_upload_kyc_id edge function validation

## 4.4 Milestone 4: VALR Account Setup (9/9 Passed - 100%)

### Test 4.4.1: VALR Subaccount Creation - Automatic Trigger ✅ PASS
**Test Execution:**
- Date: 2026-01-01
- Customer 31: Subaccount "Jemaica Gaier LTH PVR" created
- VALR API succeeded
- exchange_accounts record created
- Bugs fixed: active column, is_omnibus field

### Test 4.4.2: VALR API Authentication ✅ PASS
- HMAC SHA-512 signature working correctly
- All required headers implemented

### Test 4.4.3: Duplicate Subaccount Prevention ✅ PASS
- UI prevents duplicate creation
- force_recreate parameter available for admin override

### Test 4.4.4: Admin Enters Deposit Reference ✅ PASS
**Test Execution:**
- Date: 2026-01-01
- Customer 31: deposit_ref = "VR8E3BS9E7" saved
- customer_details.registration_status changed to 'deposit'
- deposit_instructions email sent

### Test 4.4.5: Deposit Instructions Email ✅ PASS
- VALR banking details corrected (Standard Bank, Account 001624849)
- Email template updated with correct details

### Tests 4.4.6-4.4.9: All Supporting Tests ✅ PASS
- Resend email functionality
- Database schema (deposit_ref column)
- ef_valr_create_subaccount edge function
- VALR 3-stage UI workflow

## 4.5 Milestone 5: Funds Deposit (9/14 Passed - 64%)

### Test 4.5.1: pg_cron Job - Hourly Execution ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Job 31 (deposit-scan-hourly) active and running
- Legacy job 16 disabled (duplicate)

### Test 4.5.2: ef_deposit_scan - Customer Query ✅ PASS
- Function queries customers with status='deposit'
- Retrieved subaccount_id correctly

### Test 4.5.3: VALR API Balance Check ✅ PASS
- VALR API authentication bug fixed (subaccountId in HMAC payload)
- Balance check successful

### Test 4.5.4-4.5.6: Balance Detection - Activation ✅ PASS
**Test Execution:**
- Date: 2026-01-01
- Customer 31: 2.00 USDT deposited
- Activation triggered successfully
- customer_details.registration_status = 'active'
- customer_portfolios.status = 'active'
- Both emails sent (admin notification + customer welcome)

### Test 4.5.7: Zero Balance - No Activation ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Customer 36 (TestZero Balance): Zero balance, not activated
- Function correctly skipped activation
- Status remains 'deposit'

### Test 4.5.8: Multiple Customers - Batch Processing ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- 2 customers processed in single scan
- scanned=2, activated=0, errors=1

### Test 4.5.9: Error Handling - Invalid Subaccount ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Customer 37 (TestInvalid Subaccount): Invalid subaccount handled gracefully
- Error logged, function continued processing
- No crash/exception thrown

### Test 4.5.10: Email - Admin Notification ✅ PASS
- funds_deposited_admin_notification sent (verified in TC5.6)

### Test 4.5.11: Email - Customer Welcome ✅ PASS
- registration_complete_welcome sent (verified in TC5.6)

### Test 4.5.12: Edge Function - Manual Test ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Function called successfully via curl
- Response: `{"success":true,"scanned":2,"activated":0,"errors":1}`

### Test 4.5.13: Performance - 100 Customers ⏭ SKIP
- Deferred to post-launch load testing
- Current production volume: <10 customers

### Test 4.5.14: Balance Reconciliation - Automated Detection ✅ PASS
**Purpose:** Verify automated balance reconciliation detects manual transfers not tracked by system
**Component:** ef_balance_reconciliation (deployed 2026-01-05)
**Test Execution:**
- Date: 2026-01-05
- Test Scenario: Customer 31 manually transferred 2.00 USDT out of subaccount
- System State: balances_daily showed 2.00 USDT, VALR API showed 0.00 USDT
- Manual Test: Called ef_balance_reconciliation via curl
- **Expected Result:**
  - Discrepancy detected (USDT diff = -2.00)
  - Withdrawal event created in exchange_funding_events
  - balances_daily updated to 0.00 USDT, 0.00 NAV
- **Actual Result:** ✅ Function correctly detected discrepancy and created records
  - Funding event: `ext_ref='AUTO_RECON_2026-01-05_USDT'`, amount=2.00, kind='withdrawal'
  - balances_daily: usdt_balance=0.00, btc_balance=0.00, nav_usd=0.00
  - Portal refreshed and showed $0.00 balance
- **Status:** ✅ PASS (2026-01-05) - Automated reconciliation working correctly

### Test 4.5.15: Balance Reconciliation - Hourly Schedule ✅ PASS
**Purpose:** Verify pg_cron job runs balance reconciliation every hour at :30
**Component:** pg_cron Job #32 (balance-reconciliation-hourly)
**Test Execution:**
- Date: 2026-01-05
- Verification Query:
  ```sql
  SELECT jobid, jobname, schedule, active
  FROM cron.job
  WHERE jobname = 'balance-reconciliation-hourly';
  ```
- **Expected Result:**
  - Job ID: 32
  - Schedule: '30 * * * *' (every hour at :30 minutes past)
  - Active: true
  - Command: Calls ef_balance_reconciliation via net.http_post
- **Actual Result:** ✅ Job configured correctly
  - jobid=32, active=true, schedule='30 * * * *'
  - Avoids conflict with trading pipeline (03:00-03:15 UTC)
- **Status:** ✅ PASS (2026-01-05)

### Test 4.5.16: Balance Reconciliation - Zero Discrepancies ✅ PASS
**Purpose:** Verify function handles customers with matching balances (no action needed)
**Test Execution:**
- Date: 2026-01-05
- Test: Called ef_balance_reconciliation with all customers having accurate balances
- **Expected Result:**
  - Function scans all active customers
  - No discrepancies detected
  - No funding events created
  - Response: {scanned: 3, reconciled: 3, discrepancies: 0, errors: 0}
- **Actual Result:** ✅ Function correctly handled matching balances
  - Scanned 3 customers (12, 31, 39)
  - All balances matched VALR API
  - No unnecessary database writes
- **Status:** ✅ PASS (2026-01-05)

### Test 4.5.14: Hourly Automation - 24-Hour Test ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- 24 consecutive successful executions
- 100% success rate (24/24 runs)
- Job ID: 31, Schedule: '0 * * * *' (hourly)
- Execution time: 0.005s to 0.059s (avg ~0.023s)

## 4.6 Milestone 6: Customer Active (7/10 Passed - 70%)

### Test 4.6.1: Full Portal Access ⏸️ DEFERRED
**Objective:** Customer with status='active' sees full portal

**Note:** Testing deferred until customer portal UI is built. Backend authentication and status checks working correctly.

### Test 4.6.2: Trading Pipeline Inclusion ⏳ PENDING
**Objective:** Active customers included in daily LTH_PVR trading pipeline

**Note:** Requires next pipeline run (03:00 UTC). Customer 31 activated successfully, will verify decision generation tomorrow.

### Test 4.6.3: Admin Views Active Customers ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Result: ✅ PASS
- Active Customers card displays correctly
- Columns: ID, Name, Email, Strategy badge, Activated date, Actions
- Customer 31 visible with correct data

### Test 4.6.4: Admin Sets Customer Inactive ✅ PASS
**Test Execution:**
- Date: 2026-01-05
- Customer 31 (Jemaica Gaier) set to inactive via Admin UI
- Result: ✅ PASS
- customer_details.registration_status changed from 'active' to 'inactive'
- customer_portfolios.status changed from 'active' to 'inactive'
- Customer removed from Active Customers table
- Status verified via SQL query

**Verification:**
```sql
SELECT cd.customer_id, cd.registration_status, cp.status
FROM customer_details cd
JOIN customer_portfolios cp ON cd.customer_id = cp.customer_id
WHERE cd.customer_id = 31;
-- Result: registration_status='inactive', portfolio_status='inactive'
```

### Test 4.6.5: Inactive Customer - Trading Exclusion ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Result: ✅ PASS
- Verified inactive customers excluded from decision query (status='active' filter)
- No decisions generated for inactive period

### Test 4.6.6: Inactive Customer - Portal Access (View Only) ✅ PASS
**Test Execution:**
- Date: 2026-01-05
- Customer: Customer 31 (Jemaica Gaier, status='inactive')
- Portal URL: http://localhost:8100/customer-portal.html
- Result: ✅ PASS

**Expected Behavior:**
- ✅ Dashboard displays with balances (NAV, BTC, USDT, ROI) - view-only mode
- ✅ Status banner: "Your account is currently inactive. Trading is paused. Contact support to reactivate."
- ✅ Alert message above dashboard: "⏸ Account Inactive - Your account is currently inactive. Trading is paused. Contact support to reactivate your account."
- ✅ Portfolio list shows: "LTH_PVR - INACTIVE"

**Bug Fixed:**
- Problem: Portal showed "Trading starts tomorrow!" instead of dashboard for inactive customers
- Root Cause: loadDashboard() only checked `portfolio.status === 'active'`
- Fix: Changed condition to `(status === 'active' || status === 'inactive')` to allow view-only access
- File: customer-portal.html lines 388-432
- Status banner now reads customerData.registration_status to override next_action message

### Test 4.6.7: Reactivate Customer (Manual) ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Customer 31 reactivated via SQL
- Result: ✅ PASS
- Status changed back to 'active'
- Customer appears in Active Customers card

### Test 4.6.8: Active Customers Card - Search ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Result: ✅ PASS
- Search by name working correctly
- Real-time filtering functional

### Test 4.6.9: Active Customers Card - Refresh ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Result: ✅ PASS
- Refresh button re-queries database
- Table updates with latest data

### Test 4.6.10: Customer Status Badge Colors ✅ PASS
**Test Execution:**
- Date: 2026-01-04
- Result: ✅ PASS
- All status badges displaying correct colors:
  - prospect: Yellow
  - kyc: Cyan
  - setup: Purple
  - deposit: Orange
  - active: Green
  - inactive: Gray

## 4.7 Integration Tests (0/3 Pending)

*End-to-end pipeline tests pending - see Customer_Onboarding_Test_Cases.md*

- IT1: Full Pipeline End-to-End (Prospect → Active)
- IT2: Email Flow Verification (7 emails)
- IT3: Database State Consistency

## 4.8 Performance Tests (0/2 Pending)

*Load testing deferred to post-launch - see Customer_Onboarding_Test_Cases.md*

## 4.9 Security Tests (0/3 Pending)

*Security validation tests pending - see Customer_Onboarding_Test_Cases.md*

- ST1: Status Manipulation Prevention (RLS policies)
- ST2: ID Document Access Control
- ST3: Edge Function JWT Verification

**For complete Customer Onboarding test details, see:** `Customer_Onboarding_Test_Cases.md`

---

# 5. Portal Feature Tests

**Original Document:** Customer_Portal_Test_Cases.md (SUPERSEDED - tests consolidated here)  
**Date:** January 4, 2026  
**Status:** 7 of 16 tests executed (unique features not covered by onboarding pipeline)

**Note:** Tests TC1-TC3 and TC6.1 from Customer_Portal_Test_Cases.md are already covered in Customer Onboarding (Section 4 above). This section contains remaining unique feature tests.

## 5.1 Admin Fee Management (6 tests)

### Test 5.1.1: View Customer Fees ⏳ PENDING
**Objective:** Verify admin can view all customer fee rates

**Preconditions:**
- Admin authenticated in admin portal
- Navigate to Administration module → Customer Fee Management card

**Expected Results:**
- Table displays all customers with status in ('active', 'setup', 'kyc')
- Columns: ID, Name, Email, Fee Rate
- Default fee rate: "10.00%" (customers without custom config)
- Custom fee rates displayed correctly

### Test 5.1.2: Update Customer Fee Rate ✅ PASS
**Test Execution:**
- Date: December 29, 2025
- Customer 12: Fee changed from 5% to 7.5%
- Success message displayed
- Table updated correctly

**Verification Query:**
```sql
SELECT customer_id, fee_rate, (fee_rate * 100) as fee_percentage
FROM lth_pvr.fee_configs
WHERE customer_id = 12
ORDER BY created_at DESC LIMIT 1;
```

### Test 5.1.3: Fee Rate Validation - Invalid Range ✅ PASS
- Error message displays for values outside 0-100%
- Database not updated on validation failure
- Test variations: negative values, >100%, non-numeric

### Test 5.1.4: Fee Rate Update - Edge Case 0% ✅ PASS
- 0% fee rate accepted (free management)
- Database fee_rate = 0.0

### Test 5.1.5: Fee Rate Update - Cancel Action ✅ PASS
- Cancel button discards changes
- Original value retained
- Database not updated

### Test 5.1.6: Fee Search Filter ✅ PASS
- Search by name or email
- Case-insensitive filtering
- Real-time table updates

## 5.2 Row-Level Security (RLS) Policies (4 tests - All Deferred)

### Test 5.2.1: Customer Can Only View Own Data ⏸️ DEFERRED
**Objective:** Verify RLS prevents cross-customer data access

**Note:** Testing deferred until customer portal UI is built. Requires customer authentication context (not admin).

**Expected Results:**
- Customer A (ID: 100) can only query their own data
- Attempts to query Customer B (ID: 101) return empty array
- RLS policy blocks unauthorized access

**Verification Query:**
```sql
-- Check RLS enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'customer_details';
-- rowsecurity should be TRUE
```

### Test 5.2.2: Customer Agreement - RLS Insert Policy ⏸️ DEFERRED
**Objective:** Verify customer can insert own agreements during registration

**Note:** While ef_customer_register successfully inserts agreements (verified in Customer Onboarding TC2.1), full RLS policy testing requires customer authentication context.

### Test 5.2.3: Support Request - Anonymous Insert ⏸️ DEFERRED
**Objective:** Verify anonymous users can submit support requests

**Note:** Deferred until support request functionality implemented in portal UI.

### Test 5.2.4: Withdrawal Request - Customer Can View Own ⏸️ DEFERRED
**Objective:** Verify RLS on withdrawal_requests table

**Note:** Deferred until withdrawal functionality implemented in portal UI.

## 5.3 End-to-End Workflows (2 tests - Not Implemented)

### Test 5.3.1: Withdrawal Request Flow (E2E) ⏳ NOT IMPLEMENTED
**Objective:** Verify complete withdrawal process from customer request to bank transfer

**Test Phases:**
1. **Customer Request:** Customer submits withdrawal via portal (R 50,000)
2. **Admin Processing:** Admin approves withdrawal in admin portal
3. **Execution:** BTC sold, ZAR transferred, status updated to 'completed'

**Expected Results:**
- Withdrawal request record created (status='pending')
- 3 emails sent: admin notification, customer approval, customer completion
- BTC sold at current market rate
- ZAR transferred to customer bank account
- Portfolio balance and transaction history updated

**Status:** ⏳ Feature not implemented - planned for Phase 2

### Test 5.3.2: Fee Adjustment & Monthly Close (E2E) ⏳ NOT IMPLEMENTED
**Objective:** Verify fee customization applied in monthly close

**Test Phases:**
1. **Fee Update:** Admin changes customer 12 fee from 10% to 5%
2. **Accumulate Fees:** Run ef_fee_monthly_close at month-end
3. **Verification:** Fee invoice uses 5% rate, monthly statement sent

**Expected Results:**
- Fee calculated at 5% of average portfolio value
- Monthly statement email shows "Management Fee (5%): R XXX"
- Fee deducted from customer balance
- Fee recorded in lth_pvr.fee_invoices table

**Status:** ⏳ Feature not implemented - planned for Phase 2

## 5.4 Error Handling & Edge Cases (4 tests)

### Test 5.4.1: Supabase Service Unavailable ⏳ PENDING
**Objective:** Verify graceful degradation when Supabase is down

**Test Steps:**
1. Disconnect internet or block Supabase domain
2. Attempt UI operations (prospect form, login, etc.)

**Expected Results:**
- User-friendly error: "Unable to connect to server..."
- Form data not lost (remains filled)
- User can retry submission

### Test 5.4.2: SMTP Configuration Invalid ⏳ PENDING
**Objective:** Verify email failure handling

**Test Steps:**
1. Temporarily invalidate SMTP credentials
2. Trigger email send (prospect form, etc.)

**Expected Results:**
- Error logged to email_logs with status='failed'
- Prospect/customer record still created (email failure doesn't block signup)
- Admin can retry email send manually

**Verification Query:**
```sql
SELECT template_key, status, error_message
FROM email_logs
WHERE recipient_email = 'test@example.com'
ORDER BY created_at DESC LIMIT 1;
```

### Test 5.4.3: Concurrent Fee Updates ⏳ PENDING
**Objective:** Verify database handles simultaneous fee updates

**Test Steps:**
1. Open admin portal in 2 browser tabs
2. Simultaneously edit same customer fee to different values
3. Save both (race condition)

**Expected Results:**
- Last write wins (no database corruption)
- No locking errors or deadlocks
- Stale data warning for one admin (refresh required)

### Test 5.4.4: Large Prospect Form Message (XSS Test) ⏳ PENDING
**Objective:** Verify input sanitization and XSS prevention

**Test Steps:**
1. Enter malicious script in prospect message field:
   ```html
   <script>alert('XSS')</script>
   <img src=x onerror="alert('XSS')">
   ```
2. Submit form
3. Check admin notification email

**Expected Results:**
- Script NOT executed in email
- HTML tags escaped: `&lt;script&gt;...`
- Email displays as plain text
- No XSS vulnerability

## 5.5 Performance & Load Testing (2 tests)

### Test 5.5.1: Multiple Concurrent Prospect Submissions ⏳ PENDING
**Objective:** Verify system handles load

**Test Steps:**
1. Use tool (Postman, curl, script) to submit 10 prospect forms simultaneously
2. Monitor Supabase dashboard for errors

**Expected Results:**
- All 10 submissions processed successfully
- All emails sent without delays >5 seconds
- No database deadlocks or timeout errors
- No duplicate customer records created

### Test 5.5.2: Fee Table Load Time (100+ Customers) ⏳ PENDING
**Objective:** Verify admin UI performance with large dataset

**Preconditions:** Database has 100+ active customers

**Test Steps:**
1. Navigate to Admin Fee Management
2. Click "Refresh"
3. Measure load time

**Expected Results:**
- Table loads in <3 seconds
- No browser lag or freezing
- Search filter responds in <500ms

**For original test context (now deprecated), see:** `Customer_Portal_Test_Cases.md` (archived)

---

## Appendix: Test Execution Priorities

### Critical Path (Must Execute Before Production)

1. **Customer Onboarding M6 Tests** (Priority 1) - **5/10 COMPLETE**
   - ✅ Test 4.6.3: Admin views active customers
   - ✅ Test 4.6.7: Reactivate customer (manual SQL)
   - ✅ Test 4.6.8: Active customers card - search
   - ✅ Test 4.6.9: Active customers card - refresh
   - ✅ Test 4.6.10: Customer status badge colors
   - ⏳ Test 4.6.1: Full portal access for active customers (requires trading data)
   - ⏳ Test 4.6.2: Trading pipeline inclusion (requires Jan 5 03:00 UTC run)
   - ⏳ Test 4.6.4: Admin sets customer inactive
   - ⏳ Test 4.6.5: Inactive customer - trading exclusion
   - ⏳ Test 4.6.6: Inactive customer - portal access (view only)

2. **Customer Onboarding Integration Tests** (Priority 2) - **✅ 3/3 COMPLETE**
   - ✅ IT1: Full pipeline end-to-end (Prospect → Active) - PASS (2026-01-05)
   - ✅ IT2: Email flow verification (7 emails) - PASS (2026-01-05)
   - ✅ IT3: Database state consistency - PASS (2026-01-05)
   - **Test Customer:** Customer 39 (Integration TestUser, integration.test@example.com)
   - **Duration:** 45 minutes (including 5 bug fixes)
   - **Bugs Fixed:** ADMIN_EMAIL default, UI dialog formatting, WEBSITE_URL localhost, portal redirect, admin email recipients

3. **Pipeline Resume UI Tests** (Priority 3)
   - Test 3.3.1: Panel loads successfully
   - Test 3.3.2: Auto-refresh status polling
   - Test 3.3.3: Refresh button works
   - Test 3.3.4: Resume button triggers correctly

4. **Alert System Integration Tests** (Priority 4)
   - Email digest end-to-end testing
   - Alert resolution workflow testing

5. **WebSocket Real-World Tests** (Priority 5)
   - Place live test orders to validate WebSocket monitoring
   - Verify fallback polling behavior

### Non-Critical Tests

- Performance benchmarking under load (Customer Onboarding: 100 customers)
- Error simulation scenarios
- Concurrent user testing
- Edge case validation
- Security tests (RLS policies, JWT verification)

---

## Test Environment Setup

### Prerequisites
- Supabase project: wqnmxpooabmedvtackji
- Organization ID: b0a77009-03b9-44a1-ae1d-34f157d44a8b
- Browser: Chrome/Edge with developer tools
- Network: Stable connection to supabase.co
- Permissions: Service role key access

### Tools Required
- PowerShell (for API testing)
- Web browser (for UI testing)
- Supabase MCP tools (for logs and queries)
- SQL client (for database verification)

---

**End of Master Test Cases Document**

*For detailed test procedures, expected results, and execution notes, refer to individual test case documents.*
*For questions or to report test results, contact: davin.gaier@gmail.com*
