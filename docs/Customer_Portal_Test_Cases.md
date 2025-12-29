# Customer Portal Test Cases

**Project:** BitWealth Customer Portal MVP  
**Date Created:** December 29, 2025  
**Target Launch:** January 10, 2026  
**Test Environment:** Production (wqnmxpooabmedvtackji.supabase.co)

---

## Test Suite Overview

This document contains comprehensive test cases for the BitWealth Customer Portal, covering:
- Prospect interest submission
- Customer registration and authentication
- Email template rendering and delivery
- Admin fee management
- Row-level security (RLS) policies
- End-to-end onboarding workflows

### Test Environment Setup

**Prerequisites:**
- Supabase project: `wqnmxpooabmedvtackji.supabase.co`
- RESEND_API_KEY configured in Supabase secrets
- All 5 database migrations applied
- All 3 edge functions deployed
- All 12 email templates inserted
- Admin user authenticated in admin portal

**Test Data:**
- Test email: Use a valid email you can access
- Test phone: +27 81 123 4567
- Test amounts: R 10,000 - R 50,000 upfront, R 5,000 - R 10,000 monthly

---

## Test Case 1: Prospect Interest Form Submission

### TC1.1: Valid Prospect Submission (Happy Path) ✅ PASS

**Objective:** Verify prospect can successfully submit interest form and receive confirmation

**Preconditions:**
- Navigate to `https://wqnmxpooabmedvtackji.supabase.co` (or local website/index.html)
- Form is visible and all fields are present

**Test Steps:**
1. Fill in all required fields:
   - First Name: "Test"
   - Surname: "Prospect"
   - Email: "test.prospect@example.com"
   - Country: "South Africa"
   - Phone Country Code: "+27"
   - Phone Number: "811234567"
   - Upfront Investment: "R 10,000 - R 50,000"
   - Monthly Investment: "R 5,000 - R 10,000"
   - Message: "Interested in Bitcoin DCA strategy"
2. Click "Submit Interest" button
3. Wait for response

**Expected Results:**
- ✅ Success message displays: "Thank you! We've received your information..."
- ✅ Form is reset/cleared
- ✅ Two emails are sent:
  - Prospect receives confirmation email (template: prospect_confirmation)
  - Admin receives notification email (template: prospect_notification)
- ✅ Database record created in `customer_details` with status='prospect'

**Verification Queries:**
```sql
-- Check customer record created
SELECT customer_id, first_name, surname, email, status, 
       upfront_investment_amount_range, monthly_investment_amount_range
FROM customer_details
WHERE email = 'test.prospect@example.com'
ORDER BY created_at DESC LIMIT 1;

-- Check email logs
SELECT template_key, recipient_email, status, resend_message_id
FROM email_logs
WHERE recipient_email = 'test.prospect@example.com'
ORDER BY created_at DESC LIMIT 2;
```

**Pass Criteria:**
- Customer record exists with status='prospect'
- 2 email logs with status='sent'
- Both emails received in inbox

---

### TC1.2: Prospect Submission - Missing Required Fields

**Objective:** Verify form validation prevents submission with missing data

**Test Steps:**
1. Leave "Email" field empty
2. Fill other required fields
3. Click "Submit Interest"

**Expected Results:**
- ❌ Browser validation error: "Please fill out this field"
- ❌ Form does NOT submit
- ❌ No database record created
- ❌ No emails sent

**Test Variations:**
- Missing First Name
- Missing Email
- Missing at least one investment amount (both empty)

---

### TC1.3: Prospect Submission - Invalid Email Format

**Objective:** Verify email validation

**Test Steps:**
1. Enter invalid email: "notanemail"
2. Fill other fields
3. Click "Submit Interest"

**Expected Results:**
- ❌ Browser validation error: "Please include an '@' in the email address"
- ❌ Form does NOT submit

---

### TC1.4: Prospect Submission - Duplicate Email

**Objective:** Verify handling of existing customer email

**Preconditions:**
- Customer with email already exists in database (status='active' or 'setup')

**Test Steps:**
1. Submit form with existing customer email
2. Wait for response

**Expected Results:**
- ❌ Error message displays: "This email is already registered..."
- ❌ No new customer record created
- ❌ No emails sent

**Verification Query:**
```sql
SELECT COUNT(*) as customer_count
FROM customer_details
WHERE email = 'existing.customer@example.com';
-- Should remain 1, not increase to 2
```

---

### TC1.5: Prospect Submission - Edge Function Error Handling

**Objective:** Verify graceful handling of backend errors

**Test Steps:**
1. Temporarily disable ef_prospect_submit function (or simulate error)
2. Submit valid form
3. Observe response

**Expected Results:**
- ❌ Error message displays with technical details
- ❌ Form remains filled (data not lost)
- ⚠️ User can retry submission

---

## Test Case 2: Customer Registration Flow

### TC2.1: Valid Customer Registration (Happy Path)

**Objective:** Verify KYC-approved customer can create account successfully

**Preconditions:**
- Customer exists with status='kyc' (KYC verified)
- Customer has email: "kyc.approved@example.com"
- Customer ID: 999 (use actual test customer_id)

**Setup Query:**
```sql
-- Create test customer in 'kyc' status
INSERT INTO customer_details (
  first_name, surname, email, status, 
  kyc_verified_at, kyc_verified_by
) VALUES (
  'John', 'KYC', 'kyc.approved@example.com', 'kyc',
  NOW(), 'admin-test'
)
RETURNING customer_id;
```

**Test Steps:**
1. Navigate to registration URL:
   ```
   https://wqnmxpooabmedvtackji.supabase.co/website/register.html?customer_id=999&email=kyc.approved@example.com
   ```
2. Verify email is pre-filled and readonly
3. Enter secure password: "TestPass123!@#"
4. Confirm password: "TestPass123!@#"
5. Check all 3 agreement checkboxes:
   - Terms of Service
   - Privacy Policy
   - Risk Disclaimer
6. Click "Complete Registration"
7. Wait for processing

**Expected Results:**
- ✅ Success message displays
- ✅ Redirect to customer portal (portal.html)
- ✅ Supabase Auth user created with email confirmation
- ✅ customer_details.status updated to 'setup'
- ✅ 3 records created in customer_agreements table
- ✅ customer_details.terms_accepted_at, privacy_accepted_at, disclaimer_signed_at populated

**Verification Queries:**
```sql
-- Check customer status updated
SELECT customer_id, status, terms_accepted_at, 
       privacy_accepted_at, disclaimer_signed_at
FROM customer_details
WHERE email = 'kyc.approved@example.com';

-- Check agreements recorded
SELECT agreement_type, agreed_at
FROM customer_agreements
WHERE customer_id = 999
ORDER BY agreed_at;

-- Check auth user created (use Supabase Dashboard > Authentication)
```

**Pass Criteria:**
- Status changed from 'kyc' to 'setup'
- 3 agreement records with timestamps
- Auth user exists and can sign in
- User metadata contains customer_id (999)

---

### TC2.2: Registration - Weak Password

**Objective:** Verify password strength requirements

**Test Steps:**
1. Enter weak password: "weak"
2. Try to submit

**Expected Results:**
- ❌ Validation error: "Password must be at least 8 characters..."
- ❌ Registration does NOT proceed

**Test Variations:**
- No uppercase: "password123!"
- No number: "Password!!!"
- No special character: "Password123"
- Under 8 characters: "Pass1!"

---

### TC2.3: Registration - Password Mismatch

**Objective:** Verify password confirmation validation

**Test Steps:**
1. Password: "TestPass123!@#"
2. Confirm Password: "DifferentPass456!@#"
3. Click submit

**Expected Results:**
- ❌ Validation error: "Passwords do not match"
- ❌ Registration does NOT proceed

---

### TC2.4: Registration - Missing Agreements

**Objective:** Verify all agreements are required

**Test Steps:**
1. Fill valid password
2. Check only 2 of 3 agreement checkboxes
3. Click submit

**Expected Results:**
- ❌ Error message: "You must accept all agreements..."
- ❌ Registration does NOT proceed

---

### TC2.5: Registration - Invalid Customer Status

**Objective:** Verify only 'kyc' status customers can register

**Preconditions:**
- Customer exists with status='prospect' (not KYC verified yet)

**Test Steps:**
1. Navigate to registration URL with prospect customer_id
2. Attempt registration

**Expected Results:**
- ❌ Error message from ef_customer_register
- ❌ Auth account NOT created
- ❌ Status remains 'prospect'

---

### TC2.6: Registration - Already Registered Customer

**Objective:** Verify duplicate registration prevention

**Preconditions:**
- Customer already has status='setup' or 'active'

**Test Steps:**
1. Navigate to registration URL with existing customer_id
2. Attempt registration

**Expected Results:**
- ❌ Error message: "Customer already registered" or similar
- ❌ No duplicate auth account created

---

## Test Case 3: Email Template Rendering

### TC3.1: Prospect Confirmation Email - Template Rendering

**Objective:** Verify email template placeholders are correctly replaced

**Test Steps:**
1. Submit prospect form with test data
2. Check received email in inbox

**Expected Results:**
- ✅ Email subject: "Thank you for your interest in BitWealth"
- ✅ Email contains correct:
  - First name: "Test"
  - Website URL (no {{placeholder}} visible)
  - BitWealth branding (navy header, gold button)
  - Clickable website link

**Verification Query:**
```sql
-- Get rendered email from logs
SELECT template_key, subject, 
       body_html LIKE '%{{%' as has_unrendered_placeholders
FROM email_logs
WHERE recipient_email = 'test.prospect@example.com'
ORDER BY created_at DESC LIMIT 1;
-- has_unrendered_placeholders should be FALSE
```

---

### TC3.2: Prospect Notification Email - Admin Template

**Objective:** Verify admin receives all prospect details

**Test Steps:**
1. Submit prospect form
2. Check admin email inbox

**Expected Results:**
- ✅ Email subject includes prospect name: "New Prospect: Test Prospect"
- ✅ Email contains table with all submitted data:
  - Name, email, phone, country
  - Upfront and monthly investment ranges
  - Prospect message
  - Submission timestamp
- ✅ "Review in Admin Portal" button links to admin portal

---

### TC3.3: KYC Verified Email - Registration Link

**Objective:** Verify registration link is correctly generated

**Preconditions:**
- Customer ID: 999
- Email: kyc.approved@example.com

**Test Steps:**
1. Manually trigger email send (or use ef_send_email directly):
```sql
-- Simulate sending via SQL (or use Supabase Functions invoke)
SELECT email_templates.body_html
FROM email_templates
WHERE template_key = 'kyc_verified_notification';
```

2. Call ef_send_email with placeholders:
```json
{
  "template_key": "kyc_verified_notification",
  "recipient_email": "kyc.approved@example.com",
  "placeholders": {
    "first_name": "John",
    "registration_url": "https://wqnmxpooabmedvtackji.supabase.co/website/register.html?customer_id=999&email=kyc.approved@example.com",
    "website_url": "https://bitwealth.co.za"
  }
}
```

**Expected Results:**
- ✅ Email received with correct registration URL
- ✅ URL includes customer_id and email parameters
- ✅ Clicking link opens registration page with pre-filled email

---

### TC3.4: All Email Templates - No Missing Placeholders

**Objective:** Verify all templates have no syntax errors

**Test Steps:**
1. Query all email templates
2. Check for common issues

**Verification Query:**
```sql
-- Check for missing placeholders in templates
SELECT template_key, 
       body_html LIKE '%{{%}}%' as has_empty_placeholder,
       body_html LIKE '%undefined%' as has_undefined_text
FROM email_templates;
-- All should be FALSE
```

**Expected Results:**
- ✅ No empty placeholders {{}}
- ✅ No "undefined" text
- ✅ All HTML is well-formed (no unclosed tags)

---

## Test Case 4: Admin Fee Management

### TC4.1: View Customer Fees (Happy Path)

**Objective:** Verify admin can view all customer fee rates

**Preconditions:**
- Admin authenticated in admin portal
- Navigate to Administration module (#admin-module)

**Test Steps:**
1. Scroll to "Customer Fee Management" card
2. Click "Refresh" button
3. Observe customer table

**Expected Results:**
- ✅ Table displays all customers with status in ('active', 'setup', 'kyc')
- ✅ Columns show: ID, Name, Email, Fee Rate
- ✅ Default fee rate displays as "10.00%" for customers without custom config
- ✅ Custom fee rates display correctly (e.g., "5.00%" for customer 12)

---

### TC4.2: Update Customer Fee Rate (Happy Path)

**Objective:** Verify admin can change customer fee rate

**Preconditions:**
- Customer 12 currently has 5% fee

**Test Steps:**
1. Find customer 12 in fee table
2. Click "Edit" button for customer 12
3. Input field appears with current value "5.00"
4. Change value to "7.50"
5. Click "Save" button
6. Wait for processing

**Expected Results:**
- ✅ Success message displays: "Fee updated successfully for customer 12. Previous: 5.00%, New: 7.50%"
- ✅ Table cell updates to show "7.50%"
- ✅ Edit mode exits (input hidden, "Edit" button returns)

**Verification Query:**
```sql
-- Check fee_configs updated
SELECT customer_id, fee_rate, 
       (fee_rate * 100) as fee_percentage,
       effective_from
FROM lth_pvr.fee_configs
WHERE customer_id = 12
ORDER BY effective_from DESC LIMIT 1;
-- fee_rate should be 0.075
```

**Pass Criteria:**
- Database record updated with new rate
- effective_from set to beginning of current month
- Fee will be used in next monthly close

---

### TC4.3: Fee Rate Validation - Invalid Range

**Objective:** Verify fee rate must be between 0% and 100%

**Test Steps:**
1. Click "Edit" for any customer
2. Enter invalid value: "150"
3. Click "Save"

**Expected Results:**
- ❌ Error message: "Fee rate must be between 0% and 100%"
- ❌ Database NOT updated
- ❌ Edit mode remains active

**Test Variations:**
- Negative value: "-5"
- Above 100: "101"
- Non-numeric: "abc"

---

### TC4.4: Fee Rate Update - Edge Case 0%

**Objective:** Verify 0% fee rate is accepted (free management)

**Test Steps:**
1. Edit customer fee
2. Enter "0"
3. Save

**Expected Results:**
- ✅ Success message displays
- ✅ Fee rate updates to "0.00%"
- ✅ Database fee_rate = 0.0

---

### TC4.5: Fee Rate Update - Cancel Action

**Objective:** Verify cancel button discards changes

**Test Steps:**
1. Click "Edit"
2. Change value from "10.00" to "15.00"
3. Click "Cancel" button (do NOT save)

**Expected Results:**
- ✅ Input hidden
- ✅ Display shows original value "10.00%"
- ❌ Database NOT updated
- ✅ Edit mode exits

---

### TC4.6: Fee Search Filter

**Objective:** Verify search functionality

**Test Steps:**
1. Enter search term in "Search by name or email..." input
2. Try: "Smith" (search by surname)
3. Clear search
4. Try: "@example.com" (search by email domain)

**Expected Results:**
- ✅ Table filters to show only matching customers
- ✅ Non-matching customers hidden
- ✅ Search is case-insensitive
- ✅ Clearing search shows all customers again

---

## Test Case 5: Row-Level Security (RLS) Policies

### TC5.1: Customer Can Only View Own Data

**Objective:** Verify RLS prevents cross-customer data access

**Preconditions:**
- Customer A (ID: 100) authenticated
- Customer B (ID: 101) exists in database

**Test Steps:**
1. Sign in as Customer A
2. Attempt to query Customer B's data via SQL or API:
```javascript
const { data, error } = await supabase
  .from('customer_details')
  .select('*')
  .eq('customer_id', 101); // Different customer
```

**Expected Results:**
- ❌ Query returns empty array (no data)
- ❌ OR Postgres RLS policy blocks access
- ✅ Customer A can ONLY see their own data (customer_id = 100)

---

### TC5.2: Customer Agreement - RLS Insert Policy

**Objective:** Verify customer can insert own agreements during registration

**Preconditions:**
- Customer authenticated with customer_id in JWT metadata

**Test Steps:**
1. During registration, ef_customer_register inserts agreements
2. Verify RLS allows insert for authenticated customer

**Expected Results:**
- ✅ 3 agreement records inserted successfully
- ✅ All have customer_id matching authenticated user

**Verification Query:**
```sql
-- Check agreements exist
SELECT customer_id, agreement_type, agreed_at
FROM customer_agreements
WHERE customer_id = 999;
-- Should return 3 records
```

---

### TC5.3: Support Request - Anonymous Insert

**Objective:** Verify anonymous (unauthenticated) users can submit support requests

**Preconditions:**
- User NOT signed in (no auth session)

**Test Steps:**
1. Call support request endpoint as anonymous user
2. Attempt to insert support request

**Expected Results:**
- ✅ RLS policy allows anonymous insert
- ✅ Support request created successfully
- ⚠️ Customer must authenticate to view their requests

---

### TC5.4: Withdrawal Request - Customer Can View Own

**Objective:** Verify RLS on withdrawal_requests table

**Test Steps:**
1. Sign in as Customer A (ID: 100)
2. Query withdrawal_requests:
```javascript
const { data, error } = await supabase
  .from('withdrawal_requests')
  .select('*');
```

**Expected Results:**
- ✅ Returns only Customer A's withdrawal requests
- ❌ Does NOT return other customers' requests

---

## Test Case 6: End-to-End Workflows

### TC6.1: Complete Onboarding Journey (E2E)

**Objective:** Verify entire customer lifecycle from prospect to active

**Test Steps:**

**Phase 1: Prospect Submission**
1. Submit prospect form on website
2. Verify confirmation email received
3. Verify admin notification received

**Phase 2: KYC Process (Manual)**
4. Admin contacts prospect (simulated)
5. Admin updates customer status to 'kyc':
```sql
UPDATE customer_details 
SET status = 'kyc', 
    kyc_verified_at = NOW(), 
    kyc_verified_by = 'admin-test'
WHERE email = 'e2e.test@example.com';
```
6. Admin manually triggers KYC verified email with registration link

**Phase 3: Account Creation**
7. Customer clicks registration link
8. Completes registration form with valid password
9. Accepts all 3 agreements
10. Submits registration

**Phase 4: Deposit & Activation**
11. Verify customer receives account setup email with deposit reference
12. Simulate deposit by inserting transaction record (or use actual bank deposit)
13. Verify funds deposited notification email sent
14. Verify customer status updates to 'active'

**Phase 5: First Purchase**
15. Run daily pipeline (ef_fetch_ci_bands, ef_generate_decisions, etc.)
16. Verify BTC purchase executed for customer
17. Verify customer portfolio shows BTC balance

**Expected Results:**
- ✅ All emails sent at correct stages (7 total)
- ✅ Status progression: prospect → kyc → setup → active
- ✅ Agreements recorded
- ✅ Auth account created
- ✅ Deposit processed
- ✅ First BTC purchase successful
- ✅ Customer can view portfolio in portal

**Timeline:**
- Estimated test duration: 30-45 minutes (excluding actual bank deposit wait time)

---

### TC6.2: Withdrawal Request Flow (E2E)

**Objective:** Verify complete withdrawal process

**Preconditions:**
- Customer has active portfolio with BTC balance
- Customer authenticated in portal

**Test Steps:**

**Phase 1: Customer Request**
1. Customer navigates to Withdrawals section in portal
2. Enters withdrawal amount: R 50,000
3. Selects withdrawal type: "Full withdrawal" or "Partial"
4. Confirms bank account details
5. Submits request

**Phase 2: Admin Processing**
6. Admin receives notification email
7. Admin reviews request in admin portal
8. Admin approves withdrawal (updates status to 'approved')
9. Customer receives approval email

**Phase 3: Execution**
10. Admin executes BTC sale (via trading module)
11. Admin processes bank transfer
12. Admin updates withdrawal status to 'completed'
13. Customer receives completion email with reference number

**Expected Results:**
- ✅ Withdrawal request record created with status='pending'
- ✅ 3 emails sent: notification (admin), approval (customer), completion (customer)
- ✅ BTC sold at current market rate
- ✅ ZAR transferred to customer bank account
- ✅ Portfolio balance updated
- ✅ Transaction logged in customer history

---

### TC6.3: Fee Adjustment & Monthly Close (E2E)

**Objective:** Verify fee customization is applied in monthly close

**Test Steps:**

**Phase 1: Fee Update**
1. Admin changes customer 12 fee from 10% to 5%
2. Verify update successful via admin UI

**Phase 2: Accumulate Fees**
3. Wait for month-end (or manually trigger ef_fee_monthly_close)
4. Run monthly close process

**Phase 3: Verification**
5. Check fee invoice generated with 5% rate (not 10%)
6. Verify monthly statement email sent to customer 12
7. Verify ZAR balance reduced by correct 5% fee amount

**Expected Results:**
- ✅ Fee calculated at 5% of average portfolio value
- ✅ Monthly statement email shows "Management Fee (5%): R XXX"
- ✅ Fee deducted from customer balance
- ✅ Fee recorded in fee_invoices table

**Verification Query:**
```sql
-- Check fee invoice uses correct rate
SELECT customer_id, fee_rate_applied, 
       base_amount, fee_amount_zar,
       invoice_month
FROM lth_pvr.fee_invoices
WHERE customer_id = 12
ORDER BY invoice_month DESC LIMIT 1;
-- fee_rate_applied should be 0.05
```

---

## Test Case 7: Error Handling & Edge Cases

### TC7.1: Supabase Service Unavailable

**Objective:** Verify graceful degradation when Supabase is down

**Test Steps:**
1. Disconnect internet or block Supabase domain
2. Attempt to submit prospect form

**Expected Results:**
- ❌ User-friendly error message: "Unable to connect to server. Please check your internet connection..."
- ⚠️ Form data NOT lost (remains filled)
- ⚠️ User can retry submission

---

### TC7.2: Resend API Key Invalid

**Objective:** Verify email failure handling

**Preconditions:**
- Temporarily remove or invalidate RESEND_API_KEY

**Test Steps:**
1. Submit prospect form
2. ef_prospect_submit attempts to send email

**Expected Results:**
- ❌ Edge function logs error to email_logs with status='failed'
- ⚠️ Prospect record STILL created (email failure doesn't block signup)
- ⚠️ Admin can retry email send manually

**Verification Query:**
```sql
SELECT template_key, status, error_message
FROM email_logs
WHERE recipient_email = 'test@example.com'
ORDER BY created_at DESC LIMIT 1;
-- status should be 'failed', error_message populated
```

---

### TC7.3: Concurrent Fee Updates

**Objective:** Verify database handles simultaneous fee updates

**Test Steps:**
1. Open admin portal in 2 browser tabs
2. In Tab 1: Start editing customer 12 fee to 6%
3. In Tab 2: Simultaneously edit customer 12 fee to 8%
4. Save both (race condition)

**Expected Results:**
- ✅ Last write wins (either 6% or 8%, whichever saved last)
- ❌ No database corruption or locking errors
- ⚠️ One admin sees stale data warning (refresh required)

---

### TC7.4: Large Prospect Form Message (XSS Test)

**Objective:** Verify input sanitization and XSS prevention

**Test Steps:**
1. Enter malicious script in message field:
```html
<script>alert('XSS')</script>
<img src=x onerror="alert('XSS')">
```
2. Submit form
3. Check admin notification email

**Expected Results:**
- ✅ Script NOT executed in email
- ✅ HTML tags escaped: `&lt;script&gt;...`
- ✅ Email displays as plain text, not rendered HTML
- ✅ No XSS vulnerability

---

## Test Case 8: Performance & Load Testing

### TC8.1: Multiple Concurrent Prospect Submissions

**Objective:** Verify system handles load

**Test Steps:**
1. Use tool (Postman, curl, or script) to submit 10 prospect forms simultaneously
2. Monitor Supabase dashboard for errors

**Expected Results:**
- ✅ All 10 submissions processed successfully
- ✅ All emails sent without delays >5 seconds
- ✅ No database deadlocks or timeout errors
- ✅ No duplicate customer records created

---

### TC8.2: Fee Table Load Time (100+ Customers)

**Objective:** Verify admin UI performance with large dataset

**Preconditions:**
- Database has 100+ active customers

**Test Steps:**
1. Navigate to Admin Fee Management
2. Click "Refresh"
3. Measure load time

**Expected Results:**
- ✅ Table loads in <3 seconds
- ✅ No browser lag or freezing
- ✅ Search filter responds in <500ms

---

## Test Execution Summary

### Test Priority Levels

**P0 (Critical - Must Pass):**
- TC1.1: Valid Prospect Submission
- TC2.1: Valid Customer Registration
- TC3.1, TC3.2: Email Template Rendering
- TC4.2: Update Customer Fee Rate
- TC5.1, TC5.2: RLS Policies
- TC6.1: Complete Onboarding Journey

**P1 (High - Should Pass):**
- TC1.2-TC1.5: Prospect Form Validation
- TC2.2-TC2.6: Registration Validation
- TC4.1, TC4.3-TC4.6: Fee Management Edge Cases
- TC6.2, TC6.3: End-to-End Workflows

**P2 (Medium - Nice to Have):**
- TC5.3, TC5.4: Additional RLS Scenarios
- TC7.1-TC7.4: Error Handling
- TC8.1-TC8.2: Performance Testing

### Test Environment

- **Development:** Local testing with Supabase local dev (if available)
- **Staging:** Not applicable (deploying directly to production)
- **Production:** `wqnmxpooabmedvtackji.supabase.co`

### Test Data Cleanup

After testing, clean up test data:

```sql
-- Delete test prospects
DELETE FROM customer_details 
WHERE email LIKE '%@example.com' 
  AND status = 'prospect';

-- Delete test email logs
DELETE FROM email_logs 
WHERE recipient_email LIKE '%@example.com';

-- Delete test agreements
DELETE FROM customer_agreements 
WHERE customer_id IN (
  SELECT customer_id FROM customer_details 
  WHERE email LIKE '%@example.com'
);

-- Reset test customer fee rates
UPDATE lth_pvr.fee_configs 
SET fee_rate = 0.10 
WHERE customer_id = 12;
```

### Sign-Off

**Tester:** _____________________  
**Date:** _____________________  
**Pass/Fail:** _____________________  
**Notes:**

---

## Known Issues & Limitations

1. **Email Sending:** Resend has rate limits (100 emails/day on free tier). Consider upgrading for production.
2. **Bank Deposits:** Manual deposit reconciliation required (no automated bank integration yet).
3. **Customer Portal UI:** Not yet built (pending Phase 2 development).
4. **Withdrawal Processing:** Requires manual admin intervention (no automated BTC sale/transfer).
5. **Multi-Org Support:** Currently assumes single organization (hardcoded ORG_ID).

## Next Steps After Testing

1. **Fix Critical Bugs:** Address any P0 test failures immediately
2. **Customer Portal UI:** Build dashboard for customers to view portfolio
3. **Withdrawal UI:** Add withdrawal request form to customer portal
4. **Support Request UI:** Add contact form to customer portal
5. **Admin Dashboard Enhancements:** Add customer management, KYC workflow, withdrawal processing
6. **Bank Integration:** Explore automated deposit scanning via bank API
7. **Performance Optimization:** Add caching, pagination for large customer lists
8. **Security Audit:** Third-party penetration testing before full launch
9. **User Acceptance Testing (UAT):** Test with 5-10 real users (soft launch)
10. **Production Launch:** January 10, 2026

---

**End of Test Cases Document**
