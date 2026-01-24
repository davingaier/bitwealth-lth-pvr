# Withdrawal Request System - Build Plan

**Feature:** Customer-Initiated Withdrawal Requests with Admin Approval Workflow  
**Version:** v0.7.0  
**Planning Date:** 2026-01-24  
**Estimated Effort:** 6-8 hours  
**Priority:** HIGH (Customer Self-Service)  
**Dependencies:** Balance reconciliation, Performance fee system (TC1.5/TC1.6 withdrawal fee logic)

---

## Business Requirements

### Current State (Manual Process)
1. Customer emails support@bitwealth.co.za requesting withdrawal
2. Admin manually verifies withdrawable balance
3. Admin manually calculates interim performance fee (if applicable)
4. Admin manually processes VALR withdrawal
5. Admin manually updates ledger and balances
6. Admin emails customer confirmation

**Pain Points:**
- Requires admin intervention for every withdrawal
- No self-service for customers
- No audit trail or status tracking
- No validation of withdrawal amounts
- Manual performance fee calculation prone to errors
- Slow turnaround time (24-48 hours)

### Target State (Automated Workflow)
1. Customer submits withdrawal request via portal (amount, banking details)
2. System validates withdrawable balance automatically
3. System calculates interim performance fee automatically
4. Admin reviews request in queue, approves/rejects with notes
5. System processes VALR withdrawal automatically on approval
6. System updates ledger and balances automatically
7. System sends email notifications at each stage
8. Customer tracks request status in real-time

**Benefits:**
- Self-service reduces support burden
- Automated validation prevents errors
- Full audit trail for compliance
- Faster turnaround time (< 4 hours)
- Transparent status tracking for customers
- Consistent fee calculation

---

## Database Schema Design

### Table: `public.withdrawal_requests`

```sql
CREATE TABLE public.withdrawal_requests (
  -- Primary Key
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign Keys
  org_id UUID NOT NULL REFERENCES public.organizations(org_id),
  customer_id BIGINT NOT NULL REFERENCES public.customer_details(customer_id),
  portfolio_id UUID REFERENCES public.customer_portfolios(portfolio_id),
  
  -- Request Details
  currency TEXT NOT NULL CHECK (currency IN ('BTC', 'USDT', 'ZAR')),
  amount_requested NUMERIC(20, 8) NOT NULL CHECK (amount_requested > 0),
  
  -- Banking Details (for ZAR withdrawals)
  bank_name TEXT,
  account_holder TEXT,
  account_number TEXT,
  branch_code TEXT,
  account_type TEXT CHECK (account_type IN ('savings', 'current', 'transmission')),
  
  -- Crypto Details (for BTC withdrawals)
  withdrawal_address TEXT,  -- Bitcoin address for BTC withdrawals
  
  -- Validation Results
  withdrawable_balance_snapshot NUMERIC(20, 8),  -- Balance at time of request
  interim_performance_fee_btc NUMERIC(20, 8) DEFAULT 0,  -- Calculated by ef_calculate_interim_performance_fee
  interim_performance_fee_usdt NUMERIC(20, 8) DEFAULT 0,
  net_amount NUMERIC(20, 8),  -- Amount after fees
  
  -- Workflow Status
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'failed', 'cancelled')),
  
  -- Admin Review
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  admin_notes TEXT,  -- Reason for rejection or special instructions
  
  -- Execution Details
  valr_withdrawal_id TEXT,  -- VALR API withdrawal reference
  valr_response JSONB,  -- Full VALR API response for debugging
  ledger_id UUID REFERENCES lth_pvr.ledger_lines(ledger_id),  -- Link to ledger entry
  
  -- Timestamps
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,  -- When withdrawal executed on VALR
  completed_at TIMESTAMPTZ,  -- When funds received by customer
  
  -- Audit Trail
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_withdrawal_requests_customer ON public.withdrawal_requests(customer_id, requested_at DESC);
CREATE INDEX idx_withdrawal_requests_status ON public.withdrawal_requests(status, requested_at) 
  WHERE status IN ('pending', 'processing');
CREATE INDEX idx_withdrawal_requests_org ON public.withdrawal_requests(org_id, requested_at DESC);

-- RLS Policies
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- Service role bypass
CREATE POLICY service_role_bypass_withdrawals ON public.withdrawal_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Customers can view their own requests
CREATE POLICY customer_view_own_withdrawals ON public.withdrawal_requests
  FOR SELECT
  TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id 
      FROM public.customer_details 
      WHERE user_id = auth.uid()
    )
  );

-- Customers can insert their own requests
CREATE POLICY customer_insert_own_withdrawals ON public.withdrawal_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id IN (
      SELECT customer_id 
      FROM public.customer_details 
      WHERE user_id = auth.uid()
    )
    AND status = 'pending'  -- Can only create pending requests
  );

-- Customers can cancel their own pending requests
CREATE POLICY customer_cancel_own_withdrawals ON public.withdrawal_requests
  FOR UPDATE
  TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id 
      FROM public.customer_details 
      WHERE user_id = auth.uid()
    )
    AND status = 'pending'
  )
  WITH CHECK (status = 'cancelled');

-- Comments
COMMENT ON TABLE public.withdrawal_requests IS 
  'Customer withdrawal requests with admin approval workflow. Supports BTC, USDT, and ZAR withdrawals.';
COMMENT ON COLUMN public.withdrawal_requests.interim_performance_fee_btc IS 
  'Calculated interim performance fee if withdrawal made mid-month (uses existing ef_calculate_interim_performance_fee logic)';
COMMENT ON COLUMN public.withdrawal_requests.net_amount IS 
  'Amount customer receives after interim performance fee deducted';
```

---

## Implementation Plan (Sequential Steps)

### Phase 1: Database Schema (1 hour)

**Step 1.1: Create Migration File**
- File: `supabase/migrations/20260124_withdrawal_requests_table.sql`
- Create `withdrawal_requests` table with schema above
- Add indexes for performance
- Enable RLS with policies
- Test migration locally: `supabase db reset`

**Step 1.2: Create RPC Functions**
- `public.list_customer_withdrawal_requests(p_customer_id BIGINT, p_limit INT DEFAULT 20)`
  - Returns withdrawal requests for customer portal
  - Security: SECURITY DEFINER with customer_id filtering
  - Sorts by requested_at DESC
  
- `public.list_pending_withdrawal_requests(p_org_id UUID)`
  - Returns pending/processing requests for admin review
  - Security: SECURITY DEFINER with org_id filtering
  - Joins with customer_details for names/emails
  - Calculates days_pending for SLA tracking

**Validation:**
```sql
-- Test table creation
SELECT * FROM public.withdrawal_requests LIMIT 0;

-- Test RPC functions
SELECT * FROM public.list_customer_withdrawal_requests(47, 10);
SELECT * FROM public.list_pending_withdrawal_requests('b0a77009-03b9-44a1-ae1d-34f157d44a8b');
```

---

### Phase 2: Customer Portal Form (2 hours)

**Step 2.1: UI Component**
- File: `website/customer-portal.html`
- Add "Request Withdrawal" card to dashboard
- Form fields:
  - Currency selector (BTC/USDT/ZAR radio buttons)
  - Amount input with validation
  - Banking details section (ZAR only, collapsible)
  - Bitcoin address input (BTC only)
  - Terms checkbox ("I understand interim performance fees may apply")
  - Submit button with loading state
  
**Step 2.2: Client-Side Validation**
- Fetch withdrawable balance via `lth_pvr.get_withdrawable_balance(customer_id)`
- Validate amount <= withdrawable balance
- Validate banking details format (ZAR):
  - Account number: 10-12 digits
  - Branch code: 6 digits
  - Account holder: alphanumeric + spaces
- Validate Bitcoin address format (BTC):
  - Starts with 1, 3, or bc1
  - Length 26-62 characters
  - Base58/Bech32 format
- Show real-time fee estimate (call `ef_calculate_interim_performance_fee` preview endpoint)

**Step 2.3: Submission Handler**
```javascript
async function submitWithdrawalRequest() {
  // 1. Validate form fields
  const currency = document.querySelector('input[name="currency"]:checked').value;
  const amount = parseFloat(document.getElementById('amount').value);
  
  // 2. Get withdrawable balance
  const { data: balance } = await supabase.rpc('get_withdrawable_balance', { p_customer_id });
  
  // 3. Validate amount
  if (amount > balance[`withdrawable_${currency.toLowerCase()}`]) {
    showError('Insufficient balance');
    return;
  }
  
  // 4. Call edge function to create request
  const { data, error } = await supabase.functions.invoke('ef_withdrawal_request_submit', {
    body: {
      customer_id,
      currency,
      amount,
      bank_details: currency === 'ZAR' ? getBankDetails() : null,
      withdrawal_address: currency === 'BTC' ? getWithdrawalAddress() : null
    }
  });
  
  // 5. Show success/error
  if (error) {
    showError(error.message);
  } else {
    showSuccess(`Request submitted! Reference: ${data.request_id}`);
    refreshWithdrawalHistory();
  }
}
```

**Step 2.4: Request History Table**
- Display customer's withdrawal requests below form
- Columns: Date | Currency | Amount | Fee | Net Amount | Status | Actions
- Status badges:
  - Gray: pending (⏳ Awaiting Review)
  - Blue: approved (✓ Approved)
  - Yellow: processing (🔄 Processing)
  - Green: completed (✓ Completed)
  - Red: rejected/failed (✗ Rejected/Failed)
  - Orange: cancelled (⊘ Cancelled)
- Actions:
  - Cancel button (pending requests only)
  - View details button (shows admin notes if rejected)

**Validation:**
- Test form validation with invalid inputs
- Test balance checking (try to withdraw more than available)
- Test request submission with Customer 47
- Verify request appears in history table
- Test cancel functionality

---

### Phase 3: Edge Function - Submit Request (1.5 hours)

**Step 3.1: Create Edge Function**
- File: `supabase/functions/ef_withdrawal_request_submit/index.ts`
- Accepts: `{ customer_id, currency, amount, bank_details?, withdrawal_address? }`
- Validates: Customer exists, has active portfolio, amount > 0
- Calculates: Withdrawable balance, interim performance fee (if applicable)
- Creates: `withdrawal_requests` record with status='pending'
- Sends: Email notification to admin (new request in queue)
- Returns: `{ request_id, status, estimated_fee, net_amount }`

**Step 3.2: Validation Logic**
```typescript
// 1. Verify customer exists and has active strategy
const { data: customer, error: customerErr } = await sb
  .from('customer_details')
  .select('customer_id, first_names, last_name, email')
  .eq('customer_id', customer_id)
  .single();

if (customerErr || !customer) {
  return new Response('Customer not found', { status: 404 });
}

// 2. Get withdrawable balance
const { data: balance } = await sb.rpc('get_withdrawable_balance', { p_customer_id: customer_id });

if (!balance || amount > balance[`withdrawable_${currency.toLowerCase()}`]) {
  return new Response('Insufficient withdrawable balance', { status: 400 });
}

// 3. Calculate interim performance fee (if mid-month withdrawal)
const today = new Date();
const isMonthEnd = today.getDate() >= 28;  // Last 3 days of month = no interim fee

let interimFeeBtc = 0;
let interimFeeUsdt = 0;

if (!isMonthEnd) {
  // Call ef_calculate_interim_performance_fee to get fee estimate
  const { data: feeEstimate } = await sb.functions.invoke('ef_calculate_interim_performance_fee', {
    body: {
      customer_id,
      withdrawal_amount_btc: currency === 'BTC' ? amount : 0,
      withdrawal_amount_usdt: currency === 'USDT' ? amount : 0,
      preview_only: true  // Don't create snapshot, just calculate
    }
  });
  
  if (feeEstimate) {
    interimFeeBtc = feeEstimate.fee_btc;
    interimFeeUsdt = feeEstimate.fee_usdt;
  }
}

// 4. Calculate net amount (amount - fee)
const netAmount = currency === 'BTC' 
  ? amount - interimFeeBtc 
  : amount - interimFeeUsdt;

// 5. Validate banking/address details
if (currency === 'ZAR' && (!bank_details || !bank_details.account_number)) {
  return new Response('Banking details required for ZAR withdrawal', { status: 400 });
}

if (currency === 'BTC' && (!withdrawal_address || !isValidBitcoinAddress(withdrawal_address))) {
  return new Response('Valid Bitcoin address required', { status: 400 });
}

// 6. Create withdrawal request
const { data: request, error: insertErr } = await sb
  .from('withdrawal_requests')
  .insert({
    org_id,
    customer_id,
    currency,
    amount_requested: amount,
    bank_name: bank_details?.bank_name,
    account_holder: bank_details?.account_holder,
    account_number: bank_details?.account_number,
    branch_code: bank_details?.branch_code,
    account_type: bank_details?.account_type,
    withdrawal_address,
    withdrawable_balance_snapshot: balance[`withdrawable_${currency.toLowerCase()}`],
    interim_performance_fee_btc: interimFeeBtc,
    interim_performance_fee_usdt: interimFeeUsdt,
    net_amount: netAmount,
    status: 'pending'
  })
  .select()
  .single();

// 7. Send email notification to admin
await sendAdminNotification(customer, request);

// 8. Return success
return new Response(JSON.stringify({
  success: true,
  request_id: request.request_id,
  status: 'pending',
  estimated_fee_btc: interimFeeBtc,
  estimated_fee_usdt: interimFeeUsdt,
  net_amount: netAmount
}), {
  headers: { 'Content-Type': 'application/json' }
});
```

**Step 3.3: Email Notification**
- Template: "New Withdrawal Request - Customer {name}"
- Recipient: support@bitwealth.co.za
- Content:
  - Customer name and ID
  - Amount and currency
  - Withdrawable balance snapshot
  - Estimated interim fee
  - Net amount
  - Link to admin approval page

**Validation:**
- Test with Customer 47 (valid customer)
- Test with invalid customer_id (should reject)
- Test with amount > withdrawable balance (should reject)
- Test with missing banking details for ZAR (should reject)
- Test with invalid Bitcoin address (should reject)
- Verify email sent to admin
- Check withdrawal_requests table for new record

---

### Phase 4: Admin Approval Workflow (2 hours)

**Step 4.1: Admin UI - Pending Requests Queue**
- File: `ui/Advanced BTC DCA Strategy.html`
- Add "Withdrawal Requests" module to Administration section (after Alerts)
- Display pending requests in table:
  - Columns: Date | Customer | Currency | Amount | Fee | Net | Days Pending | Actions
  - Color coding: > 24hr = yellow warning, > 48hr = red alert
  - Actions: Approve button (green), Reject button (red), View details button

**Step 4.2: Request Details Modal**
- Shows full request information:
  - Customer details (name, email, ID)
  - Request date and age
  - Currency and amount
  - Banking details / Bitcoin address
  - Withdrawable balance at time of request
  - Current withdrawable balance (may have changed)
  - Interim performance fee breakdown
  - Net amount customer receives
- Admin input fields:
  - Notes textarea (required for rejection)
  - Approve button (confirms fee calculation, triggers processing)
  - Reject button (updates status, sends rejection email)

**Step 4.3: Approval Handler**
```javascript
async function approveWithdrawalRequest(requestId) {
  // 1. Confirm with admin
  if (!confirm('Approve this withdrawal request? This will trigger VALR withdrawal.')) {
    return;
  }
  
  // 2. Call edge function to approve
  const { data, error } = await supabase.functions.invoke('ef_withdrawal_request_approve', {
    body: {
      request_id: requestId,
      admin_notes: document.getElementById('admin-notes').value
    }
  });
  
  // 3. Show success/error
  if (error) {
    showError(`Approval failed: ${error.message}`);
  } else {
    showSuccess('Request approved! Processing withdrawal...');
    refreshPendingQueue();
  }
}

async function rejectWithdrawalRequest(requestId) {
  const notes = document.getElementById('admin-notes').value;
  
  if (!notes || notes.trim().length < 10) {
    showError('Please provide a reason for rejection (min 10 characters)');
    return;
  }
  
  // Call edge function to reject
  const { data, error } = await supabase.functions.invoke('ef_withdrawal_request_reject', {
    body: {
      request_id: requestId,
      admin_notes: notes
    }
  });
  
  if (error) {
    showError(`Rejection failed: ${error.message}`);
  } else {
    showSuccess('Request rejected. Customer has been notified.');
    refreshPendingQueue();
  }
}
```

**Step 4.4: Request History View**
- Display all withdrawal requests (completed, rejected, cancelled)
- Filters: Status, Date range, Customer search
- Export to CSV button

**Validation:**
- Test approval workflow with test request
- Test rejection workflow with reason
- Verify status updates in database
- Check email notifications sent

---

### Phase 5: Edge Function - Approve Request (2 hours)

**Step 5.1: Create Edge Function**
- File: `supabase/functions/ef_withdrawal_request_approve/index.ts`
- Accepts: `{ request_id, admin_notes? }`
- Updates: Request status to 'approved', records reviewer details
- Triggers: `ef_process_withdrawal` function (async)
- Returns: `{ success: true, status: 'approved' }`

**Step 5.2: Process Withdrawal Function**
- File: `supabase/functions/ef_process_withdrawal/index.ts`
- Called by: `ef_withdrawal_request_approve` (async trigger)
- Workflow:
  1. Update request status to 'processing'
  2. Calculate interim performance fee (if applicable)
  3. Create performance fee ledger entry (debit customer)
  4. Create withdrawal ledger entry (debit customer)
  5. Execute VALR withdrawal API call
  6. Log VALR response in request record
  7. Update customer balances
  8. Update request status to 'completed' or 'failed'
  9. Send email notification to customer

**Step 5.3: VALR Withdrawal API Integration**
```typescript
// VALR Withdrawal API: POST /v1/wallet/crypto/{currency}/withdraw
// Docs: https://docs.valr.com/#tag/Wallet/operation/withdraw

async function processValrWithdrawal(request: WithdrawalRequest): Promise<ValrResponse> {
  const { currency, net_amount, withdrawal_address } = request;
  
  // Get customer's subaccount details
  const { data: exchangeAccount } = await sb
    .from('exchange_accounts')
    .select('subaccount_id, api_key, api_secret')
    .eq('customer_id', request.customer_id)
    .single();
  
  // Sign VALR API request
  const path = `/v1/wallet/crypto/${currency}/withdraw`;
  const timestamp = Date.now().toString();
  const body = JSON.stringify({
    amount: net_amount.toString(),
    address: withdrawal_address,
    memo: `Withdrawal Request ${request.request_id}`
  });
  
  const signature = await signVALR(timestamp, 'POST', path, body, exchangeAccount.api_secret);
  
  // Make VALR API call
  const response = await fetch(`https://api.valr.com${path}`, {
    method: 'POST',
    headers: {
      'X-VALR-API-KEY': exchangeAccount.api_key,
      'X-VALR-SIGNATURE': signature,
      'X-VALR-TIMESTAMP': timestamp,
      'X-VALR-SUB-ACCOUNT-ID': exchangeAccount.subaccount_id,
      'Content-Type': 'application/json'
    },
    body
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(`VALR withdrawal failed: ${data.message || response.statusText}`);
  }
  
  return {
    withdrawal_id: data.id,
    status: data.status,
    full_response: data
  };
}
```

**Step 5.4: Ledger Entries**
```sql
-- 1. Interim performance fee (if applicable)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, trade_date, kind, 
  amount_btc, amount_usdt, 
  note
) VALUES (
  org_id, customer_id, CURRENT_DATE, 'interim_performance_fee',
  -interim_fee_btc, -interim_fee_usdt,
  'Interim performance fee for mid-month withdrawal'
);

-- 2. Withdrawal
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, trade_date, kind,
  amount_btc, amount_usdt,
  note,
  withdrawal_request_id
) VALUES (
  org_id, customer_id, CURRENT_DATE, 'withdrawal',
  currency = 'BTC' ? -net_amount : 0,
  currency = 'USDT' ? -net_amount : 0,
  'Withdrawal via customer portal',
  request_id
);

-- 3. Update balances_daily
-- Run ef_post_ledger_and_balances to recalculate
```

**Validation:**
- Test with Customer 47 BTC withdrawal (0.00001 BTC)
- Test with Customer 47 USDT withdrawal ($10)
- Verify ledger entries created correctly
- Verify VALR withdrawal executed
- Check email notifications sent
- Verify balances updated

---

### Phase 6: Edge Function - Reject Request (30 minutes)

**Step 6.1: Create Edge Function**
- File: `supabase/functions/ef_withdrawal_request_reject/index.ts`
- Accepts: `{ request_id, admin_notes }`
- Updates: Request status to 'rejected', records reviewer details and notes
- Sends: Email notification to customer with rejection reason
- Returns: `{ success: true, status: 'rejected' }`

**Step 6.2: Rejection Email Template**
- Subject: "Withdrawal Request Rejected - BitWealth"
- Content:
  - Customer name
  - Request reference
  - Amount and currency
  - Reason for rejection (admin notes)
  - Contact support link
  - Next steps guidance

**Validation:**
- Test rejection with test request
- Verify email sent to customer
- Check admin notes saved correctly

---

### Phase 7: Email Notifications (1 hour)

**Templates to Create:**

1. **Customer: Request Submitted**
   - Subject: "Withdrawal Request Received - BitWealth"
   - Trigger: Request created
   - Content: Confirmation, reference number, estimated processing time

2. **Admin: New Request in Queue**
   - Subject: "New Withdrawal Request - {Customer Name}"
   - Trigger: Request created
   - Content: Customer details, amount, link to admin approval

3. **Customer: Request Approved**
   - Subject: "Withdrawal Request Approved - BitWealth"
   - Trigger: Admin approval
   - Content: Confirmation, net amount, estimated arrival time

4. **Customer: Request Rejected**
   - Subject: "Withdrawal Request Rejected - BitWealth"
   - Trigger: Admin rejection
   - Content: Reason, next steps, contact support

5. **Customer: Withdrawal Processing**
   - Subject: "Withdrawal Processing - BitWealth"
   - Trigger: VALR API call successful
   - Content: Transaction ID, estimated arrival

6. **Customer: Withdrawal Completed**
   - Subject: "Withdrawal Completed - BitWealth"
   - Trigger: Status = completed
   - Content: Transaction details, updated balance

7. **Admin: Withdrawal Failed**
   - Subject: "ALERT: Withdrawal Failed - {Customer Name}"
   - Trigger: VALR API error
   - Content: Error message, customer details, action required

**Implementation:**
- Store templates in `lth_pvr.email_templates` table (extend existing)
- Use shared `sendEmail()` function from alerting module
- Template variables: {{customer_name}}, {{amount}}, {{currency}}, {{request_id}}, {{reason}}, etc.

---

### Phase 8: Testing & Deployment (1 hour)

**End-to-End Test Scenarios:**

1. **Happy Path: BTC Withdrawal (No Interim Fee)**
   - Customer 47 requests 0.00001 BTC withdrawal on March 29 (month-end)
   - Admin approves
   - VALR withdrawal executes
   - Customer receives BTC
   - Expected: No interim fee, full amount withdrawn

2. **Happy Path: USDT Withdrawal (With Interim Fee)**
   - Customer 47 requests $50 USDT withdrawal on March 15 (mid-month)
   - System calculates 10% interim performance fee = $2.50
   - Net amount: $47.50
   - Admin approves
   - VALR withdrawal executes
   - Expected: $47.50 sent to customer, $2.50 fee logged

3. **Rejection Path**
   - Customer 47 requests $1000 withdrawal (exceeds balance)
   - Admin rejects with reason "Insufficient balance"
   - Customer receives rejection email
   - Expected: Request marked rejected, no VALR call

4. **Cancellation Path**
   - Customer 47 creates withdrawal request
   - Customer cancels before admin review
   - Expected: Status = cancelled, no processing

5. **Edge Case: Balance Changed During Review**
   - Customer 47 requests $100 withdrawal
   - Before admin approval, $90 performance fee charged (month-end)
   - Admin approves
   - System detects insufficient balance
   - Expected: Approval fails with error "Balance has changed, please re-submit"

**Deployment Checklist:**
- [ ] Migration applied to production
- [ ] All 3 edge functions deployed
- [ ] RPC functions created
- [ ] Email templates configured
- [ ] Admin UI updated
- [ ] Customer portal updated
- [ ] Test with Customer 47 in production
- [ ] Monitor alert logs for errors
- [ ] Update SDD with v0.7.0 changes

---

## File Manifest

**New Files Created:**
```
supabase/
  migrations/
    20260124_withdrawal_requests_table.sql (NEW)
  functions/
    ef_withdrawal_request_submit/
      index.ts (NEW)
      client.ts (NEW)
    ef_withdrawal_request_approve/
      index.ts (NEW)
      client.ts (NEW)
    ef_withdrawal_request_reject/
      index.ts (NEW)
      client.ts (NEW)
    ef_process_withdrawal/
      index.ts (NEW)
      client.ts (NEW)

website/
  customer-portal.html (MODIFIED - add withdrawal form and history)

ui/
  Advanced BTC DCA Strategy.html (MODIFIED - add withdrawal requests module)

docs/
  WITHDRAWAL_REQUEST_SYSTEM_BUILD_PLAN.md (THIS FILE)
  WITHDRAWAL_REQUEST_SYSTEM_TEST_CASES.md (NEXT FILE)
```

**Modified Files:**
```
docs/SDD_v0.6.md (ADD v0.7.0 changelog entry)
docs/POST_LAUNCH_ENHANCEMENTS.md (UPDATE Week 3 status)
```

---

## Dependencies & Integrations

**Existing Systems:**
1. **Balance Reconciliation:** Uses `lth_pvr.get_withdrawable_balance()` to validate amounts
2. **Performance Fee System:** Uses `ef_calculate_interim_performance_fee` for mid-month withdrawals
3. **VALR Integration:** Uses existing `signVALR()` helper and subaccount routing
4. **Email System:** Uses existing Resend API integration from alerting module
5. **Ledger System:** Creates ledger entries in `lth_pvr.ledger_lines`

**External APIs:**
1. **VALR Wallet API:** `POST /v1/wallet/crypto/{currency}/withdraw`
2. **Resend Email API:** For customer and admin notifications

---

## Risk Assessment

**Technical Risks:**
1. **VALR API Failures:** Withdrawal may fail due to insufficient balance, API downtime, or rate limits
   - Mitigation: Retry logic, alert admin on failure, allow manual processing
   
2. **Balance Race Conditions:** Customer balance may change between request and approval
   - Mitigation: Store snapshot at request time, re-validate at approval time
   
3. **Interim Fee Calculation Errors:** Complex logic with HWM and thresholds
   - Mitigation: Reuse existing tested function, add preview mode for validation

**Business Risks:**
1. **Customer Disputes:** Interim fee may surprise customers
   - Mitigation: Show fee estimate on request form, clear terms acceptance
   
2. **Admin Bottleneck:** Manual approval may slow down withdrawals
   - Mitigation: Auto-approval for small amounts (future enhancement)

---

## Future Enhancements (Post-v0.7.0)

1. **Auto-Approval for Small Amounts**
   - Withdrawals < $100 auto-approved if requested at month-end
   - Reduces admin burden for routine withdrawals

2. **Recurring Withdrawals**
   - Monthly auto-withdrawal schedule
   - Useful for customers using BitWealth as income source

3. **Multi-Currency Withdrawals**
   - Allow partial BTC + partial USDT in one request
   - More flexibility for customers

4. **KYC Verification for Withdrawals**
   - Require KYC completion before first withdrawal
   - Compliance with AML regulations

5. **Withdrawal Limits**
   - Daily/monthly withdrawal caps per customer tier
   - Fraud prevention

---

**Document Status:** Planning Document  
**Next Step:** Create test case document, then begin Phase 1 implementation  
**Last Updated:** 2026-01-24
