# Admin KYC Management Test Cases

**Feature:** Admin KYC Management Workflow  
**Module:** Administration → KYC Management  
**Created:** December 31, 2025  
**Target Launch:** January 10, 2026

---

## Test Environment

**Prerequisites:**
- Admin authenticated in admin portal (Advanced BTC DCA Strategy.html)
- At least one customer with `registration_status = 'prospect'`
- Edge function `ef_approve_kyc` deployed with `--no-verify-jwt`

---

## Test Case KYC1: View Pending Prospects

**Objective:** Verify admin can view list of prospects awaiting KYC approval

**Test Steps:**
1. Navigate to Administration module
2. Scroll to "KYC Management" card
3. Observe the prospects table

**Expected Results:**
- ✅ Table displays prospects with status='prospect'
- ✅ Columns show: ID, Name, Email, Phone, Status, Submitted Date, Action Button
- ✅ "Pending Only" checkbox is checked by default
- ✅ Status badge shows yellow "Pending" for prospects

**Verification Query:**
```sql
SELECT customer_id, first_names, last_name, email, registration_status, created_at
FROM customer_details
WHERE registration_status = 'prospect'
ORDER BY created_at DESC;
```

---

## Test Case KYC2: Search Prospects

**Objective:** Verify search functionality filters prospects

**Test Steps:**
1. In KYC Management card, enter search term in search input
2. Try searching by:
   - First name
   - Last name
   - Email address
3. Clear search

**Expected Results:**
- ✅ Table filters to show only matching prospects
- ✅ Search is case-insensitive
- ✅ Clearing search shows all prospects again

---

## Test Case KYC3: Toggle Pending Only Filter

**Objective:** Verify "Pending Only" checkbox filters by status

**Test Steps:**
1. Uncheck "Pending Only" checkbox
2. Observe table updates
3. Check "Pending Only" again

**Expected Results:**
- ✅ Unchecked: Shows all customers (prospect, kyc, setup, active)
- ✅ Checked: Shows only prospects (status='prospect')
- ✅ Table updates immediately when checkbox changes

---

## Test Case KYC4: Approve KYC (Happy Path)

**Objective:** Verify admin can approve KYC and trigger registration email

**Preconditions:**
- Customer with ID=999 exists with status='prospect'

**Test Steps:**
1. Find customer 999 in prospects table
2. Click "Approve KYC" button
3. Confirm in dialog: "Approve KYC for customer 999? This will update status to 'kyc' and send registration email"
4. Wait for processing

**Expected Results:**
- ✅ Success message displays: "KYC approved for customer 999. Registration email sent to [email]"
- ✅ Customer status updated to 'kyc' in database
- ✅ Customer row disappears from table (if "Pending Only" is checked)
- ✅ Registration URL logged to browser console
- ✅ Email sent with registration link (when email integration complete)

**Verification Query:**
```sql
SELECT customer_id, registration_status, kyc_id_verified_at, kyc_verified_by
FROM customer_details
WHERE customer_id = 999;
-- registration_status should be 'kyc', kyc_id_verified_at should be recent timestamp
```

---

## Test Case KYC5: Approve KYC - Already Approved

**Objective:** Verify proper handling of already-approved customers

**Preconditions:**
- Customer with ID=999 already has status='kyc' or 'setup' or 'active'

**Test Steps:**
1. Uncheck "Pending Only" to see all customers
2. Try to click "Approve KYC" button for customer 999
3. Observe button state

**Expected Results:**
- ❌ "Approve KYC" button should NOT be visible for non-prospect customers
- ✅ Action column shows "-" for approved/registered customers
- ✅ Status badge shows appropriate color (blue for Approved, green for Registered/Active)

---

## Test Case KYC6: Approve KYC - Customer Not Found

**Objective:** Verify error handling for invalid customer ID

**Test Steps:**
1. Open browser console
2. Manually call: `approveKYC(99999)` (non-existent customer)
3. Observe response

**Expected Results:**
- ❌ Error message displays: "Customer not found"
- ❌ Database NOT updated
- ❌ No email sent

---

## Test Case KYC7: Registration URL Format

**Objective:** Verify registration URL contains correct parameters

**Test Steps:**
1. Approve KYC for customer 999
2. Check browser console for registration URL
3. Verify URL format

**Expected Results:**
- ✅ URL format: `https://wqnmxpooabmedvtackji.supabase.co/website/register.html?customer_id=999&email=test@example.com`
- ✅ customer_id parameter matches customer ID
- ✅ email parameter is URL-encoded
- ✅ URL points to correct registration page

---

## Test Case KYC8: End-to-End Registration Flow

**Objective:** Verify complete flow from KYC approval to customer registration

**Test Steps:**

**Phase 1: Create Prospect**
1. Submit prospect form on website with test email
2. Verify prospect created with status='prospect'

**Phase 2: Admin Approves KYC**
3. Admin navigates to KYC Management
4. Admin clicks "Approve KYC" for test prospect
5. Verify success message

**Phase 3: Customer Registers**
6. Copy registration URL from console
7. Open URL in incognito/private browser window
8. Verify email is pre-filled
9. Enter password and accept agreements
10. Complete registration

**Phase 4: Verification**
11. Verify customer status updated to 'setup'
12. Verify auth user created in Supabase Dashboard → Authentication
13. Verify 3 customer_agreements records created

**Expected Results:**
- ✅ Complete flow from prospect → kyc → setup works end-to-end
- ✅ No errors at any stage
- ✅ Customer can sign in to portal (when portal UI is built)

**Verification Queries:**
```sql
-- Check status progression
SELECT customer_id, registration_status, kyc_id_verified_at, terms_accepted_at
FROM customer_details
WHERE email = 'test.prospect@example.com';

-- Check agreements
SELECT customer_id, agreement_type, agreed_at
FROM customer_agreements
WHERE customer_id = (SELECT customer_id FROM customer_details WHERE email = 'test.prospect@example.com')
ORDER BY agreed_at;
```

---

## Test Case KYC9: Refresh Button

**Objective:** Verify manual refresh updates prospects list

**Test Steps:**
1. Note current prospects in table
2. In another tab, manually update a prospect's status to 'kyc' via SQL
3. Click "Refresh" button in KYC Management
4. Observe table updates

**Expected Results:**
- ✅ "Refresh" button shows "Loading..." while fetching
- ✅ Table updates with new data
- ✅ Button returns to "Refresh" after load completes
- ✅ Updated customer no longer shows in "Pending Only" view

---

## Test Case KYC10: Concurrent Approvals

**Objective:** Verify handling of simultaneous KYC approvals

**Test Steps:**
1. Open admin portal in 2 browser tabs
2. In Tab 1: Click "Approve KYC" for customer 999
3. In Tab 2: Simultaneously click "Approve KYC" for customer 999
4. Observe results

**Expected Results:**
- ✅ Both approvals succeed (idempotent operation)
- ✅ OR second approval shows error: "Customer status is 'kyc'. Only 'prospect' status customers can be approved."
- ✅ No database corruption
- ✅ Only one email sent (when email integration complete)

---

## Email Integration (Future Enhancement)

**Current Status:**
- Edge function `ef_approve_kyc` returns registration URL but doesn't send email yet
- Registration URL logged to console for manual testing
- Email payload prepared but not sent

**TODO:**
- Integrate with existing email sending system (Resend API)
- Call email template function with `kyc_verified_notification` template
- Pass placeholders: `first_name`, `registration_url`, `website_url`
- Update `email_sent` field in response to `true`

**Implementation:**
```typescript
// In ef_approve_kyc/index.ts, replace TODO section with:
const emailResponse = await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(emailPayload),
});

const emailResult = await emailResponse.json();
```

---

## Test Execution Summary

**Status:** Ready for testing  
**Critical Path:** KYC4 (Approve KYC happy path) + KYC8 (End-to-end flow)  
**Estimated Test Time:** 30-45 minutes

**Pass Criteria:**
- All KYC approval operations work correctly
- Registration URLs generated with proper format
- Database status updates persist correctly
- UI updates reflect database changes immediately

---

**Next Steps:**
1. Test KYC4 and KYC8 to verify critical path
2. Integrate email sending functionality
3. Test TC3.3 from Customer_Portal_Test_Cases.md (KYC Verified Email)
4. Document workflow in SDD v0.6.2

