# Withdrawal Request System - Test Cases

**Feature:** Customer-Initiated Withdrawal Requests with Admin Approval Workflow  
**Version:** v0.7.0  
**Test Plan Created:** 2026-01-24  
**Testing Window:** After Phase 8 deployment (est. 6-8 hours build time)  
**Test Environment:** Production (Customer 47 - DEV TEST account)

---

## Test Strategy

### 3-Layer Testing Approach

**Layer 1: Database & RPC Functions (SQL Testing)**
- Test table constraints and RLS policies
- Validate RPC function outputs
- Test concurrent request scenarios

**Layer 2: Edge Functions (API Testing via curl/PowerShell)**
- Test request validation logic
- Test VALR withdrawal API integration
- Test email notification triggers
- Test error handling and retries

**Layer 3: UI Testing (Manual Browser Testing)**
- Test customer portal request form
- Test admin approval workflow
- Test status tracking and notifications
- Test responsive design (mobile/tablet/desktop)

---

## Prerequisites

### Test Account Setup
- **Customer 47** (DEV TEST account)
  - Current Balance: 0.00006633 BTC + $220 USDT (2026-01-24)
  - High Water Mark: $146.45
  - HWM Threshold: $200.00
  - Portfolio: LTH_PVR strategy active
  - Email: dev.test@bitwealth.co.za

### VALR Test Subaccount
- Subaccount ID: Available via Customer 47's exchange_accounts record
- Balance: 0.00006633 BTC (96.41 ZAR) + 0 USDT
- API Keys: Production credentials (use carefully!)

### Email Testing
- Admin email: info@bitwealth.co.za (real inbox)
- Customer email: dev.test@bitwealth.co.za (test inbox)

---

## LAYER 1: Database & RPC Function Tests

### TC-WR-DB-1: Table Schema Validation ⏳

**Objective:** Verify withdrawal_requests table created correctly with constraints

**Test Steps:**
```sql
-- Step 1: Verify table exists
SELECT table_name, table_schema 
FROM information_schema.tables 
WHERE table_name = 'withdrawal_requests';

-- Expected: 1 row, schema = 'public'

-- Step 2: Verify columns and types
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'withdrawal_requests'
ORDER BY ordinal_position;

-- Expected: All columns from schema (request_id, org_id, customer_id, etc.)

-- Step 3: Test CHECK constraints
INSERT INTO public.withdrawal_requests (
  org_id, customer_id, currency, amount_requested, status
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  47,
  'INVALID',  -- Should fail CHECK constraint
  100,
  'pending'
);
-- Expected: ERROR: CHECK constraint violation (currency)

INSERT INTO public.withdrawal_requests (
  org_id, customer_id, currency, amount_requested, status
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  47,
  'BTC',
  -50,  -- Should fail CHECK constraint (amount > 0)
  'pending'
);
-- Expected: ERROR: CHECK constraint violation (amount)

-- Step 4: Test valid insert
INSERT INTO public.withdrawal_requests (
  org_id, customer_id, currency, amount_requested, status,
  withdrawal_address
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  47,
  'BTC',
  0.00001,
  'pending',
  '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'  -- Genesis block address for testing
);
-- Expected: SUCCESS, 1 row inserted

SELECT * FROM public.withdrawal_requests 
WHERE customer_id = 47 
ORDER BY requested_at DESC 
LIMIT 1;
-- Expected: 1 row with status='pending'
```

**Expected Result:** ✅ Table created, constraints enforced, valid data inserted  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-DB-2: RLS Policy Validation ⏳

**Objective:** Verify customers can only see/modify their own requests

**Test Steps:**
```sql
-- Step 1: Verify RLS enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'withdrawal_requests';
-- Expected: rowsecurity = true

-- Step 2: Test service role bypass (should succeed)
SET ROLE service_role;
SELECT * FROM public.withdrawal_requests;
-- Expected: All rows visible

-- Step 3: Test authenticated customer access (simulate as Customer 47)
-- Note: This requires actual auth token, test via customer portal instead
-- Manual test: Login as Customer 47, view withdrawal history
-- Expected: Only Customer 47's requests visible
```

**Expected Result:** ✅ RLS enabled, service role bypasses, customers see only own requests  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-DB-3: RPC Function - list_customer_withdrawal_requests ⏳

**Objective:** Verify customer withdrawal history RPC returns correct data

**Test Steps:**
```sql
-- Step 1: Create test requests with different statuses
INSERT INTO public.withdrawal_requests (
  org_id, customer_id, currency, amount_requested, 
  status, withdrawal_address, net_amount
) VALUES 
  ('b0a77009-03b9-44a1-ae1d-34f157d44a8b', 47, 'BTC', 0.00001, 'pending', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 0.00001),
  ('b0a77009-03b9-44a1-ae1d-34f157d44a8b', 47, 'USDT', 50, 'approved', NULL, 47.50),
  ('b0a77009-03b9-44a1-ae1d-34f157d44a8b', 47, 'USDT', 100, 'rejected', NULL, 100),
  ('b0a77009-03b9-44a1-ae1d-34f157d44a8b', 47, 'BTC', 0.00002, 'completed', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 0.00002);

-- Step 2: Test RPC function
SELECT * FROM public.list_customer_withdrawal_requests(47, 10);

-- Expected: 4+ rows (all Customer 47 requests)
-- Columns: request_id, currency, amount_requested, net_amount, status, requested_at, etc.
-- Order: requested_at DESC (newest first)

-- Step 3: Test limit parameter
SELECT * FROM public.list_customer_withdrawal_requests(47, 2);
-- Expected: 2 rows only (most recent)

-- Step 4: Test with invalid customer (should return empty)
SELECT * FROM public.list_customer_withdrawal_requests(999, 10);
-- Expected: 0 rows
```

**Expected Result:** ✅ RPC returns correct requests, respects limit, sorted by date DESC  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-DB-4: RPC Function - list_pending_withdrawal_requests ⏳

**Objective:** Verify admin pending queue RPC returns actionable requests

**Test Steps:**
```sql
-- Step 1: Test RPC function (admin view)
SELECT * FROM public.list_pending_withdrawal_requests('b0a77009-03b9-44a1-ae1d-34f157d44a8b');

-- Expected: All requests with status IN ('pending', 'processing')
-- Columns: request_id, customer_id, customer_name, email, currency, amount_requested, 
--          net_amount, status, requested_at, days_pending
-- Includes customer details from JOIN
-- Order: requested_at ASC (oldest first for SLA tracking)

-- Step 2: Verify days_pending calculation
-- For request created 2 days ago:
UPDATE public.withdrawal_requests 
SET requested_at = NOW() - INTERVAL '2 days'
WHERE customer_id = 47 AND status = 'pending'
LIMIT 1;

SELECT request_id, requested_at, 
  EXTRACT(DAY FROM (NOW() - requested_at)) as days_pending
FROM public.withdrawal_requests
WHERE status = 'pending' AND customer_id = 47;

-- Expected: days_pending = 2

-- Step 3: Test filtering (only pending/processing, not completed/rejected)
SELECT * FROM public.list_pending_withdrawal_requests('b0a77009-03b9-44a1-ae1d-34f157d44a8b')
WHERE status NOT IN ('pending', 'processing');
-- Expected: 0 rows
```

**Expected Result:** ✅ RPC returns pending/processing requests with customer details  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

## LAYER 2: Edge Function API Tests

### TC-WR-API-1: Submit Request - Validation Errors ⏳

**Objective:** Verify edge function rejects invalid withdrawal requests

**Test Steps:**
```powershell
# Step 1: Test missing customer_id
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "currency": "BTC",
    "amount": 0.00001
  }'

# Expected: 400 Bad Request, "customer_id required"

# Step 2: Test invalid customer
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 999999,
    "currency": "BTC",
    "amount": 0.00001
  }'

# Expected: 404 Not Found, "Customer not found"

# Step 3: Test amount exceeds balance
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "BTC",
    "amount": 10.0
  }'

# Expected: 400 Bad Request, "Insufficient withdrawable balance"

# Step 4: Test missing Bitcoin address for BTC withdrawal
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "BTC",
    "amount": 0.00001
  }'

# Expected: 400 Bad Request, "Valid Bitcoin address required"

# Step 5: Test invalid Bitcoin address format
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "BTC",
    "amount": 0.00001,
    "withdrawal_address": "invalid-address-123"
  }'

# Expected: 400 Bad Request, "Valid Bitcoin address required"

# Step 6: Test missing banking details for ZAR withdrawal
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "ZAR",
    "amount": 1000
  }'

# Expected: 400 Bad Request, "Banking details required for ZAR withdrawal"
```

**Expected Result:** ✅ All validation errors return appropriate 400/404 status codes  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-API-2: Submit Request - Valid BTC Withdrawal (Month-End, No Fee) ⏳

**Objective:** Verify successful BTC withdrawal request at month-end (no interim performance fee)

**Test Conditions:**
- Current Date: March 29, 2026 (last 3 days of month)
- Customer 47 Balance: 0.00006633 BTC
- Customer 47 HWM: $146.45 (below $200 threshold, no profit)
- Expected Interim Fee: $0 (month-end exemption)

**Test Steps:**
```powershell
# Step 1: Submit valid BTC withdrawal request
$response = curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "BTC",
    "amount": 0.00001,
    "withdrawal_address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
  }' | ConvertFrom-Json

Write-Host "Response: $($response | ConvertTo-Json -Depth 5)"

# Expected Response:
# {
#   "success": true,
#   "request_id": "uuid",
#   "status": "pending",
#   "estimated_fee_btc": 0,
#   "estimated_fee_usdt": 0,
#   "net_amount": 0.00001
# }

# Step 2: Verify database record created
```

**SQL Validation:**
```sql
SELECT 
  request_id,
  customer_id,
  currency,
  amount_requested,
  interim_performance_fee_btc,
  interim_performance_fee_usdt,
  net_amount,
  status,
  requested_at
FROM public.withdrawal_requests
WHERE customer_id = 47
ORDER BY requested_at DESC
LIMIT 1;

-- Expected:
-- currency = 'BTC'
-- amount_requested = 0.00001
-- interim_performance_fee_btc = 0 (month-end exemption)
-- net_amount = 0.00001 (full amount, no fee)
-- status = 'pending'
```

**Email Validation:**
- Check info@bitwealth.co.za inbox for "New Withdrawal Request - DEV TEST"
- Check dev.test@bitwealth.co.za inbox for "Withdrawal Request Received"

**Expected Result:** ✅ Request created, status=pending, no interim fee, emails sent  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-API-3: Submit Request - Valid USDT Withdrawal (Mid-Month, With Fee) ⏳

**Objective:** Verify USDT withdrawal request mid-month with interim performance fee calculation

**Test Conditions:**
- Current Date: March 15, 2026 (mid-month)
- Customer 47 Balance: $220 USDT
- Customer 47 HWM: $146.45
- Customer 47 HWM Threshold: $200
- Current NAV: ~$220 (assuming BTC price stable)
- Profit above threshold: $220 - $200 = $20
- Expected Interim Fee: 10% of $20 = $2.00

**Test Steps:**
```powershell
# Step 1: Submit $50 USDT withdrawal request mid-month
$response = curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "USDT",
    "amount": 50
  }' | ConvertFrom-Json

Write-Host "Response: $($response | ConvertTo-Json -Depth 5)"

# Expected Response:
# {
#   "success": true,
#   "request_id": "uuid",
#   "status": "pending",
#   "estimated_fee_btc": 0,
#   "estimated_fee_usdt": 2.00,  # 10% of profit above threshold
#   "net_amount": 48.00  # $50 - $2.00 fee
# }
```

**SQL Validation:**
```sql
SELECT 
  request_id,
  currency,
  amount_requested,
  interim_performance_fee_usdt,
  net_amount,
  status
FROM public.withdrawal_requests
WHERE customer_id = 47
  AND currency = 'USDT'
ORDER BY requested_at DESC
LIMIT 1;

-- Expected:
-- amount_requested = 50.00
-- interim_performance_fee_usdt = 2.00 (calculated by ef_calculate_interim_performance_fee)
-- net_amount = 48.00
-- status = 'pending'
```

**Expected Result:** ✅ Request created with interim fee calculated correctly  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-API-4: Approve Request - Execute VALR Withdrawal ⏳

**Objective:** Verify admin approval triggers VALR withdrawal and updates ledger

**Prerequisites:**
- TC-WR-API-2 completed (pending BTC withdrawal request exists)

**Test Steps:**
```powershell
# Step 1: Get pending request ID from TC-WR-API-2
$requestId = "uuid-from-tc-wr-api-2"

# Step 2: Approve withdrawal request
$response = curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_approve" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d "{
    \"request_id\": \"$requestId\",
    \"admin_notes\": \"Approved for testing TC-WR-API-4\"
  }" | ConvertFrom-Json

Write-Host "Response: $($response | ConvertTo-Json -Depth 5)"

# Expected Response:
# {
#   "success": true,
#   "status": "approved"  # Will transition to 'processing' then 'completed'
# }
```

**SQL Validation:**
```sql
-- Step 1: Check request status updated
SELECT 
  request_id,
  status,
  reviewed_by,
  reviewed_at,
  admin_notes,
  valr_withdrawal_id,
  processed_at
FROM public.withdrawal_requests
WHERE request_id = 'uuid-from-tc-wr-api-2';

-- Expected:
-- status = 'completed' (after processing)
-- reviewed_by = admin user UUID
-- admin_notes = 'Approved for testing TC-WR-API-4'
-- valr_withdrawal_id = VALR transaction ID
-- processed_at = timestamp

-- Step 2: Check ledger entries created
SELECT 
  ledger_id,
  trade_date,
  kind,
  amount_btc,
  amount_usdt,
  note
FROM lth_pvr.ledger_lines
WHERE customer_id = 47
  AND trade_date = CURRENT_DATE
  AND kind IN ('withdrawal', 'interim_performance_fee')
ORDER BY created_at DESC;

-- Expected: 1 row for withdrawal (kind='withdrawal', amount_btc=-0.00001)
-- No interim fee row (month-end exemption from TC-WR-API-2)

-- Step 3: Check balances updated
SELECT 
  date,
  btc_balance,
  usdt_balance,
  nav_usd
FROM lth_pvr.balances_daily
WHERE customer_id = 47
  AND date = CURRENT_DATE;

-- Expected:
-- btc_balance reduced by 0.00001 (now 0.00005633)
-- usdt_balance unchanged ($220)
```

**VALR Validation:**
- Login to VALR → Check Customer 47 subaccount
- Verify withdrawal transaction appears with status 'completed'
- Verify amount = 0.00001 BTC
- Verify withdrawal address = 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa

**Email Validation:**
- Check dev.test@bitwealth.co.za for "Withdrawal Request Approved"
- Check dev.test@bitwealth.co.za for "Withdrawal Processing"
- Check dev.test@bitwealth.co.za for "Withdrawal Completed"

**Expected Result:** ✅ Request approved → VALR withdrawal executed → Ledger updated → Emails sent  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-API-5: Reject Request - Send Notification ⏳

**Objective:** Verify admin rejection updates status and notifies customer

**Prerequisites:**
- TC-WR-API-3 completed (pending USDT withdrawal request exists)

**Test Steps:**
```powershell
# Step 1: Get pending request ID from TC-WR-API-3
$requestId = "uuid-from-tc-wr-api-3"

# Step 2: Reject withdrawal request
$response = curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_reject" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d "{
    \"request_id\": \"$requestId\",
    \"admin_notes\": \"Request rejected for testing purposes. Interim fee calculation needs manual review.\"
  }" | ConvertFrom-Json

Write-Host "Response: $($response | ConvertTo-Json -Depth 5)"

# Expected Response:
# {
#   "success": true,
#   "status": "rejected"
# }
```

**SQL Validation:**
```sql
SELECT 
  request_id,
  status,
  reviewed_by,
  reviewed_at,
  admin_notes
FROM public.withdrawal_requests
WHERE request_id = 'uuid-from-tc-wr-api-3';

-- Expected:
-- status = 'rejected'
-- reviewed_by = admin user UUID
-- admin_notes = rejection reason
```

**Email Validation:**
- Check dev.test@bitwealth.co.za for "Withdrawal Request Rejected"
- Email should include rejection reason from admin_notes

**Expected Result:** ✅ Request rejected, status updated, customer notified via email  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

## LAYER 3: UI Tests

### TC-WR-UI-1: Customer Portal - Request Form Validation ⏳

**Objective:** Verify withdrawal form validates inputs and shows errors

**Test Steps:**
1. Login to customer portal as Customer 47
2. Navigate to "Request Withdrawal" card
3. **Test currency selection:**
   - Select BTC radio button → Bitcoin address field appears
   - Select USDT radio button → Banking details section hidden
   - Select ZAR radio button → Banking details section appears
4. **Test amount validation:**
   - Enter amount > withdrawable balance → Error: "Insufficient balance (available: X BTC)"
   - Enter 0 → Error: "Amount must be greater than 0"
   - Enter negative number → Error: "Amount must be positive"
5. **Test Bitcoin address validation (BTC selected):**
   - Leave empty → Error: "Bitcoin address required"
   - Enter "invalid" → Error: "Invalid Bitcoin address format"
   - Enter valid address (1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa) → No error
6. **Test banking details validation (ZAR selected):**
   - Leave account number empty → Error: "Account number required"
   - Enter < 10 digits → Error: "Account number must be 10-12 digits"
   - Enter non-numeric → Error: "Account number must be numeric"
   - Enter valid details → No error
7. **Test fee estimate display:**
   - Enter $50 USDT mid-month → Shows "Estimated fee: $2.00, You will receive: $48.00"
   - Enter 0.00001 BTC month-end → Shows "Estimated fee: $0.00, You will receive: 0.00001 BTC"

**Expected Result:** ✅ All validation rules enforced, error messages clear, fee estimate accurate  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-UI-2: Customer Portal - Submit Request ⏳

**Objective:** Verify customer can submit withdrawal request and see confirmation

**Test Steps:**
1. Login as Customer 47
2. Fill out withdrawal form:
   - Currency: BTC
   - Amount: 0.00001
   - Bitcoin Address: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
3. Check "I understand interim performance fees may apply" checkbox
4. Click "Submit Request" button
5. **Verify success message:**
   - Shows "Request submitted! Reference: [request_id]"
   - Shows "You will be notified via email once reviewed"
6. **Verify request appears in history table:**
   - New row at top of table
   - Status badge shows "⏳ Awaiting Review" (gray)
   - Amount shows 0.00001 BTC
   - Date shows today's date
   - Actions column shows "Cancel" button

**Expected Result:** ✅ Request submitted successfully, confirmation shown, appears in history  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-UI-3: Customer Portal - Request History Display ⏳

**Objective:** Verify withdrawal history table displays all statuses correctly

**Test Steps:**
1. Login as Customer 47 (should have requests from previous tests)
2. Verify history table shows all requests with correct status badges:
   - **Pending:** Gray badge "⏳ Awaiting Review", Cancel button visible
   - **Approved:** Blue badge "✓ Approved", View details button
   - **Processing:** Yellow badge "🔄 Processing", View details button
   - **Completed:** Green badge "✓ Completed", View details button
   - **Rejected:** Red badge "✗ Rejected", View details button (shows reason)
   - **Cancelled:** Orange badge "⊘ Cancelled", View details button
3. Click "View Details" on rejected request:
   - Modal shows admin notes with rejection reason
4. Click "Cancel" on pending request:
   - Confirmation dialog appears
   - After confirm, status updates to "Cancelled"
   - Request refreshes in table

**Expected Result:** ✅ All statuses display correctly, badges color-coded, actions work  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-UI-4: Admin UI - Pending Requests Queue ⏳

**Objective:** Verify admin can view and manage pending withdrawal requests

**Test Steps:**
1. Login to Admin UI
2. Navigate to Administration → Withdrawal Requests module
3. **Verify pending queue displays:**
   - Table with columns: Date | Customer | Currency | Amount | Fee | Net | Days Pending | Actions
   - Rows sorted by requested_at ASC (oldest first)
   - Days pending color-coded:
     - < 24hr: White/gray (normal)
     - 24-48hr: Yellow (warning)
     - > 48hr: Red (alert)
4. **Test request details modal:**
   - Click "View Details" on pending request
   - Modal shows:
     - Customer name, email, ID
     - Request date and age
     - Currency and amount
     - Banking details or Bitcoin address
     - Withdrawable balance (current and at request time)
     - Interim fee calculation breakdown
     - Net amount customer receives
   - Admin notes textarea visible
   - Approve button (green) and Reject button (red) visible

**Expected Result:** ✅ Pending queue shows all requests, details modal comprehensive  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-UI-5: Admin UI - Approve Workflow ⏳

**Objective:** Verify admin can approve withdrawal request and trigger processing

**Test Steps:**
1. Open pending request details modal (from TC-WR-UI-4)
2. Enter admin notes: "Approved - all validations passed"
3. Click "Approve" button
4. **Verify confirmation dialog:**
   - Shows "Approve this withdrawal request? This will trigger VALR withdrawal."
   - Cancel and Confirm buttons
5. Click "Confirm"
6. **Verify success notification:**
   - Shows "Request approved! Processing withdrawal..."
7. **Verify request disappears from pending queue**
8. **Verify request appears in history view with status "Processing" or "Completed"**

**Expected Result:** ✅ Approval successful, request processed, status updated  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-UI-6: Admin UI - Reject Workflow ⏳

**Objective:** Verify admin can reject withdrawal request with reason

**Test Steps:**
1. Open pending request details modal
2. Leave admin notes empty, click "Reject" button
3. **Verify validation error:**
   - Shows "Please provide a reason for rejection (min 10 characters)"
4. Enter admin notes: "Rejected - balance verification failed, please contact support"
5. Click "Reject" button
6. **Verify success notification:**
   - Shows "Request rejected. Customer has been notified."
7. **Verify request disappears from pending queue**
8. **Verify request appears in history view with status "Rejected"**
9. **Verify customer receives rejection email with reason**

**Expected Result:** ✅ Rejection successful, reason required, customer notified  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

## Edge Case Tests

### TC-WR-EDGE-1: Balance Changed During Review ⏳

**Objective:** Verify system handles balance changes between request and approval

**Test Scenario:**
1. Customer 47 submits $100 USDT withdrawal on March 15 (balance = $220)
2. On March 30, monthly performance fee charged: $10 (reduces balance to $210)
3. On March 31, admin approves the $100 withdrawal
4. Expected: System detects balance changed, re-validates withdrawable amount

**Test Steps:**
```sql
-- Step 1: Create withdrawal request with snapshot
INSERT INTO public.withdrawal_requests (
  org_id, customer_id, currency, amount_requested,
  withdrawable_balance_snapshot, net_amount, status
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  47,
  'USDT',
  100,
  220.00,  -- Balance at request time
  100.00,
  'pending'
);

-- Step 2: Simulate monthly fee charge (reduces balance)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, trade_date, kind,
  amount_usdt, note
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  47,
  '2026-03-30',
  'performance_fee',
  -10.00,
  'Monthly performance fee - March 2026'
);

-- Recalculate balances
-- Now balance = $210

-- Step 3: Try to approve request
```

**Expected Behavior:**
- Option A: Approval succeeds (balance still sufficient: $210 > $100)
- Option B: System warns admin "Balance has changed from $220 to $210, please confirm"
- Option C: System auto-adjusts net_amount if interim fee changed

**Expected Result:** ✅ System handles balance changes gracefully  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-EDGE-2: VALR API Failure ⏳

**Objective:** Verify system handles VALR API errors gracefully

**Test Scenario:**
- Admin approves withdrawal
- VALR API returns error (e.g., insufficient balance, API down, rate limit)

**Expected Behavior:**
1. Request status set to 'failed'
2. VALR error message stored in request record
3. Admin receives alert email "ALERT: Withdrawal Failed - DEV TEST"
4. Request remains in admin queue for manual processing
5. Customer NOT notified (failure is internal, not customer-facing)

**Test Steps:**
```powershell
# Simulate VALR API failure by temporarily disabling API keys
# Or use invalid withdrawal address to trigger VALR error

$response = curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "BTC",
    "amount": 0.00001,
    "withdrawal_address": "invalid-btc-address-to-trigger-valr-error"
  }' | ConvertFrom-Json

# Then approve this request and observe error handling
```

**Expected Result:** ✅ Failure logged, admin alerted, request marked failed, retry possible  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

### TC-WR-EDGE-3: Concurrent Withdrawal Requests ⏳

**Objective:** Verify system prevents double-spending via concurrent requests

**Test Scenario:**
- Customer 47 has $100 USDT withdrawable balance
- Customer submits two $60 requests simultaneously
- Expected: Second request should fail validation

**Test Steps:**
```powershell
# Open two PowerShell terminals, execute simultaneously

# Terminal 1:
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "USDT",
    "amount": 60
  }'

# Terminal 2 (execute within 1 second):
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_withdrawal_request_submit" `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "customer_id": 47,
    "currency": "USDT",
    "amount": 60
  }'
```

**Expected Behavior:**
- Option A: Both requests succeed if balance checked independently (admin reviews sequentially)
- Option B: Second request fails "Insufficient balance" if database lock prevents race condition
- Option C: System allows both, admin rejects second during review

**Decision:** Allow both requests, admin reviews balance at approval time (safer than complex locking)

**Expected Result:** ✅ Concurrent requests handled gracefully, no double-spending  
**Actual Result:** _[To be filled during testing]_  
**Status:** ⏳ PENDING

---

## Test Summary Template

### Test Execution Tracker

| Test ID | Test Name | Status | Pass/Fail | Notes | Date Tested |
|---------|-----------|--------|-----------|-------|-------------|
| TC-WR-DB-1 | Table Schema Validation | ⏳ | - | - | - |
| TC-WR-DB-2 | RLS Policy Validation | ⏳ | - | - | - |
| TC-WR-DB-3 | RPC - list_customer_withdrawal_requests | ⏳ | - | - | - |
| TC-WR-DB-4 | RPC - list_pending_withdrawal_requests | ⏳ | - | - | - |
| TC-WR-API-1 | Submit Request - Validation Errors | ⏳ | - | - | - |
| TC-WR-API-2 | Submit Request - BTC (No Fee) | ⏳ | - | - | - |
| TC-WR-API-3 | Submit Request - USDT (With Fee) | ⏳ | - | - | - |
| TC-WR-API-4 | Approve Request - Execute VALR | ⏳ | - | - | - |
| TC-WR-API-5 | Reject Request - Send Notification | ⏳ | - | - | - |
| TC-WR-UI-1 | Customer Portal - Form Validation | ⏳ | - | - | - |
| TC-WR-UI-2 | Customer Portal - Submit Request | ⏳ | - | - | - |
| TC-WR-UI-3 | Customer Portal - Request History | ⏳ | - | - | - |
| TC-WR-UI-4 | Admin UI - Pending Queue | ⏳ | - | - | - |
| TC-WR-UI-5 | Admin UI - Approve Workflow | ⏳ | - | - | - |
| TC-WR-UI-6 | Admin UI - Reject Workflow | ⏳ | - | - | - |
| TC-WR-EDGE-1 | Balance Changed During Review | ⏳ | - | - | - |
| TC-WR-EDGE-2 | VALR API Failure | ⏳ | - | - | - |
| TC-WR-EDGE-3 | Concurrent Withdrawal Requests | ⏳ | - | - | - |

---

**Total Test Cases:** 18  
**Status:** ⏳ READY FOR EXECUTION (after build complete)  
**Estimated Testing Time:** 2-3 hours  
**Prerequisites:** Build Plan phases 1-8 complete, Customer 47 with sufficient balance

---

**Document Status:** Test Plan Ready  
**Next Step:** Complete build plan phases 1-8, then execute test cases  
**Last Updated:** 2026-01-24
