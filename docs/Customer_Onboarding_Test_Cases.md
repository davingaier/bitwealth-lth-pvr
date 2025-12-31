# Customer Onboarding Test Cases (6-Milestone Pipeline)

**Document Version:** 1.0  
**Last Updated:** 2025-12-31  
**Status:** In Progress

## Testing Overview

This document replaces the previous Admin_KYC_Workflow_Test_Cases.md to reflect the new 6-milestone customer onboarding pipeline.

### Test Environment
- **Project:** wqnmxpooabmedvtackji.supabase.co
- **Test Date:** 2025-12-31
- **Tester:** System

## Milestone 1: Prospect Submission

**Status:** ✅ COMPLETE (tested in previous session)

### TC1.1: Valid Prospect Submission
- **Description:** Customer submits interest form on website
- **Steps:**
  1. Navigate to website/index.html
  2. Fill in: first_names, last_name, email, phone
  3. Click "Submit"
- **Expected Result:**
  - Record created in customer_details with status='prospect'
  - prospect_notification email sent to admin
  - prospect_confirmation email sent to customer
- **Actual Result:** PASS
- **Status:** ✅ VERIFIED

### TC1.2: Duplicate Email Handling
- **Description:** Same email submits twice
- **Expected Result:** Existing customer record updated, no duplicate created
- **Status:** ✅ VERIFIED

## Milestone 2: Strategy Confirmation

**Status:** ✅ COMPLETE (tested 2025-12-31)

### TC2.1: Admin Selects Strategy for Prospect
- **Description:** Admin logs into portal, selects strategy for prospect
- **Test Data:** 
  - customer_id: 31 (Jemaica Gaier)
  - strategy_code: LTH_PVR
  - admin_email: admin@bitwealth.co.za
- **Steps:**
  1. Load admin portal → Customer Management module
  2. Find customer with status='prospect'
  3. Select strategy from dropdown (LTH_PVR or ADV_DCA)
  4. Click "Confirm" button
- **Expected Result:**
  - Success message displayed
  - customer_details.registration_status changes to 'kyc'
  - customer_portfolios entry created:
    * portfolio_id: UUID
    * customer_id: 31
    * strategy_code: LTH_PVR
    * status: 'pending'
    * label: "Jemaica Gaier - LTH PVR BTC DCA"
  - kyc_portal_registration email sent to customer
  - Email contains registration URL with customer_id + email params
- **Actual Result:** 
  ```json
  {
    "success": true,
    "message": "Strategy confirmed for Jemaica Gaier",
    "customer_id": 31,
    "portfolio_id": "24ee10ac-35e4-4486-a265-848e6f0faf56",
    "strategy_code": "LTH_PVR",
    "strategy_name": "LTH PVR BTC DCA",
    "email": "jemaicagaier@gmail.com",
    "registration_url": "https://wqnmxpooabmedvtackji.supabase.co/website/register.html?customer_id=31&email=jemaicagaier%40gmail.com",
    "email_sent": true
  }
  ```
- **Status:** ✅ PASS

### TC2.2: Verify Database Changes
- **Description:** Confirm database state after strategy confirmation
- **Steps:**
  ```sql
  -- Check customer status
  SELECT customer_id, registration_status FROM customer_details WHERE customer_id = 31;
  -- Expected: registration_status='kyc'
  
  -- Check portfolio entry
  SELECT portfolio_id, strategy_code, status, label FROM customer_portfolios WHERE customer_id = 31;
  -- Expected: status='pending', strategy_code='LTH_PVR', label='Jemaica Gaier - LTH PVR BTC DCA'
  ```
- **Actual Result:**
  - customer_details.registration_status = 'kyc' ✅
  - customer_portfolios.portfolio_id = '24ee10ac-35e4-4486-a265-848e6f0faf56' ✅
  - customer_portfolios.status = 'pending' ✅
  - customer_portfolios.label = 'Jemaica Gaier - LTH PVR BTC DCA' ✅
- **Status:** ✅ PASS

### TC2.3: Email Template Verification
- **Description:** Verify kyc_portal_registration email template exists and is valid
- **Steps:**
  ```sql
  SELECT template_key, name, subject, active FROM email_templates WHERE template_key = 'kyc_portal_registration';
  ```
- **Expected Result:**
  - template_key: 'kyc_portal_registration'
  - name: 'KYC Portal Registration'
  - subject: 'Welcome to BitWealth - Create Your Portal Account'
  - active: true
  - Placeholders: {{first_name}}, {{strategy_name}}, {{registration_url}}, {{website_url}}
- **Actual Result:** ✅ Template exists with all required placeholders
- **Status:** ✅ PASS

### TC2.4: Reject Non-Prospect Customers
- **Description:** Attempt to confirm strategy for customer with status != 'prospect'
- **Test Data:** Customer with status='kyc' or 'active'
- **Expected Result:** Error: "Only 'prospect' status customers can have strategy confirmed"
- **Status:** ⏳ TO TEST

### TC2.5: Invalid Strategy Code
- **Description:** Attempt to confirm with non-existent strategy_code
- **Test Data:** strategy_code='INVALID_STRATEGY'
- **Expected Result:** Error: "Strategy not found"
- **Status:** ⏳ TO TEST

### TC2.6: UI - Strategy Dropdown Population
- **Description:** Verify admin UI populates strategy dropdown from database
- **Steps:**
  1. Load Customer Management module
  2. Check dropdown options
- **Expected Result:**
  - Dropdown shows 2 strategies:
    * ADV_DCA - Advanced BTC DCA
    * LTH_PVR - LTH PVR BTC DCA
  - Default: "Select Strategy..."
- **Status:** ⏳ TO TEST (requires UI testing)

### TC2.7: UI - Status Badge Display
- **Description:** Verify milestone status badges display correctly
- **Expected Result:**
  - prospect: Yellow "M1: Prospect"
  - kyc: Cyan "M3: KYC"
  - setup: Purple "M4: Setup"
  - deposit: Orange "M5: Deposit"
  - active: Green "M6: Active"
  - inactive: Gray "Inactive"
- **Status:** ⏳ TO TEST (requires UI testing)

## Milestone 3: Portal Registration & KYC

**Status:** ⏳ NOT STARTED

### TC3.1: Customer Registration
- **Description:** Customer clicks registration link from email and creates account
- **Steps:**
  1. Click registration URL from email
  2. Create password
  3. Verify email
- **Expected Result:**
  - Supabase Auth user created
  - Customer logged into portal
  - Limited UI shown (ID upload only)
- **Status:** ⏳ TO BUILD

### TC3.2: ID Document Upload
- **Description:** Customer uploads ID to Supabase Storage
- **Steps:**
  1. Customer logs in with status='kyc'
  2. Shown ID upload page only (no other tabs)
  3. Select file (image or PDF, max 10MB)
  4. Upload to kyc-documents bucket
- **Expected Result:**
  - File uploaded: {ccyy-mm-dd}_{last_name}_{first_names}_id.pdf
  - customer_details.kyc_id_document_url updated
  - kyc_id_uploaded_notification email sent to admin
- **Status:** ⏳ TO BUILD

### TC3.3: Admin ID Verification
- **Description:** Admin views uploaded ID and verifies it
- **Steps:**
  1. Admin opens Customer Management → KYC Verification section
  2. See customers with status='kyc' and kyc_id_document_url populated
  3. Click "View ID" to see document
  4. Click "Verify ID" button
- **Expected Result:**
  - customer_details.registration_status changes to 'setup'
  - customer_details.kyc_verified_at = NOW()
  - customer_details.kyc_verified_by = admin_email
- **Status:** ⏳ TO BUILD

### TC3.4: File Naming Validation
- **Description:** Verify uploaded files follow naming convention
- **Expected Format:** `{ccyy-mm-dd}_{last_name}_{first_names}_id.pdf`
- **Example:** `2025-12-31_Gaier_Jemaica_id.pdf`
- **Status:** ⏳ TO BUILD

### TC3.5: Storage Bucket Security
- **Description:** Verify kyc-documents bucket has correct RLS policies
- **Expected Policies:**
  - Admins: Full access (read/write/delete)
  - Customers: Can only upload their own ID (write), can view their own (read)
  - No public access
- **Status:** ⏳ TO BUILD

## Milestone 4: VALR Account Setup

**Status:** ⏳ NOT STARTED

### TC4.1: Auto-Create VALR Subaccount
- **Description:** When status changes to 'setup', VALR subaccount auto-created
- **Steps:**
  1. Admin verifies ID (status='kyc' → 'setup')
  2. Background job triggers VALR API call
- **Expected Result:**
  - POST to VALR API: /v1/account/subaccounts
  - Label: "{first_names} {last_name} - {strategy_code}"
  - exchange_accounts entry created with subaccount_id
- **Status:** ⏳ TO BUILD

### TC4.2: Admin Enters Deposit Reference
- **Description:** Admin copies deposit_ref from VALR web UI and enters in portal
- **Steps:**
  1. Admin navigates to Customer Management → VALR Setup section
  2. Find customer with status='setup' and subaccount_id populated
  3. Enter deposit_ref in text field
  4. Click "Save Deposit Reference"
- **Expected Result:**
  - exchange_accounts.deposit_ref updated
  - customer_details.registration_status changes to 'deposit'
  - deposit_instructions email sent to customer
- **Status:** ⏳ TO BUILD

### TC4.3: Deposit Instructions Email
- **Description:** Verify deposit_instructions email contains banking details
- **Expected Placeholders:**
  - {{first_name}}
  - {{deposit_ref}}
  - {{account_details}} (VALR banking info)
- **Status:** ⏳ TO BUILD

### TC4.4: Database Column Addition
- **Description:** Verify deposit_ref column added to exchange_accounts
- **Migration:**
  ```sql
  ALTER TABLE public.exchange_accounts ADD COLUMN deposit_ref TEXT;
  ```
- **Status:** ⏳ TO BUILD

## Milestone 5: Funds Deposit

**Status:** ⏳ NOT STARTED

### TC5.1: Hourly Deposit Scan
- **Description:** ef_deposit_scan runs hourly via pg_cron
- **Steps:**
  1. Create pg_cron job for hourly execution
  2. Wait for scheduled run
- **Expected Result:**
  - Job runs every hour at :00
  - Queries VALR API for all customers with status='deposit'
  - Checks ZAR, BTC, USDT balances
- **Status:** ⏳ TO BUILD

### TC5.2: Balance Detection - Activation
- **Description:** When ANY balance > 0, customer becomes active
- **Test Data:**
  - Customer with status='deposit'
  - VALR subaccount receives ZAR deposit
- **Expected Result:**
  - customer_details.registration_status changes to 'active'
  - customer_portfolios.status changes to 'active'
  - funds_deposited_admin_notification email sent
  - registration_complete_welcome email sent to customer
- **Status:** ⏳ TO BUILD

### TC5.3: Zero Balance - No Change
- **Description:** Customers with zero balance remain in 'deposit' status
- **Expected Result:** No status change, no emails sent
- **Status:** ⏳ TO BUILD

### TC5.4: Email Templates
- **Description:** Verify both email templates exist
- **Templates:**
  1. funds_deposited_admin_notification (to admin)
  2. registration_complete_welcome (to customer)
- **Status:** ⏳ TO BUILD

## Milestone 6: Customer Active

**Status:** ⏳ NOT STARTED

### TC6.1: Full Portal Access
- **Description:** Customer with status='active' sees full portal
- **Steps:**
  1. Customer logs in with status='active'
  2. Check available tabs/modules
- **Expected Result:**
  - Dashboard: Portfolio summary, NAV, performance chart
  - Transactions: Ledger view
  - Statements: Monthly PDF generation
  - All features accessible
- **Status:** ⏳ TO BUILD

### TC6.2: Trading Pipeline Inclusion
- **Description:** Active customers included in daily LTH_PVR trading pipeline
- **Expected Result:**
  - ef_generate_decisions includes customer
  - ef_create_order_intents creates orders for customer
  - ef_execute_orders places orders on VALR subaccount
- **Status:** ⏳ TO BUILD

### TC6.3: Admin Sets Inactive
- **Description:** Admin can pause customer trading by setting status='inactive'
- **Steps:**
  1. Admin opens Customer Management module
  2. Find customer with status='active'
  3. Click "Set Inactive" button
- **Expected Result:**
  - customer_details.registration_status changes to 'inactive'
  - customer_portfolios.status changes to 'inactive'
  - Customer excluded from future trading pipeline runs
  - Customer retains portal access (view-only)
- **Status:** ⏳ TO BUILD

### TC6.4: Inactive Customer Portal Access
- **Description:** Inactive customers can view but not trade
- **Expected Result:**
  - Can view: Dashboard, transactions, statements
  - Cannot: Place orders, modify settings, withdraw funds
- **Status:** ⏳ TO BUILD

## Integration Tests

### IT1: Full Pipeline End-to-End
- **Description:** Test complete flow from prospect to active
- **Steps:**
  1. Submit prospect form (M1)
  2. Admin confirms strategy (M2)
  3. Customer registers + uploads ID (M3)
  4. Admin verifies ID (M3)
  5. Auto-create VALR subaccount + admin enters deposit_ref (M4)
  6. Customer deposits funds (M5)
  7. Hourly scan detects balance (M5)
  8. Customer accesses full portal (M6)
- **Expected Duration:** ~30 minutes (excluding hourly scan wait)
- **Status:** ⏳ TO TEST (after all milestones built)

### IT2: Email Flow Verification
- **Description:** Verify all 7 emails sent correctly throughout pipeline
- **Emails:**
  1. prospect_notification (M1 - to admin)
  2. prospect_confirmation (M1 - to customer)
  3. kyc_portal_registration (M2 - to customer) ✅ VERIFIED
  4. kyc_id_uploaded_notification (M3 - to admin)
  5. deposit_instructions (M4 - to customer)
  6. funds_deposited_admin_notification (M5 - to admin)
  7. registration_complete_welcome (M5 - to customer)
- **Status:** ⏳ TO TEST

### IT3: Database State Consistency
- **Description:** Verify data integrity across tables at each milestone
- **Checks:**
  - customer_details.registration_status matches customer_portfolios.status logic
  - exchange_accounts entries exist for all active customers
  - email_templates active=true for all pipeline emails
- **Status:** ⏳ TO TEST

## Performance Tests

### PT1: Concurrent Strategy Confirmations
- **Description:** Multiple admins confirm strategies simultaneously
- **Test Data:** 10 prospects, 2 admins confirming at same time
- **Expected Result:** No race conditions, all portfolio entries unique
- **Status:** ⏳ TO TEST

### PT2: Hourly Deposit Scan Performance
- **Description:** ef_deposit_scan completes within 5 minutes for 100 customers
- **Expected Result:** All VALR API calls complete, no timeouts
- **Status:** ⏳ TO TEST

## Security Tests

### ST1: Status Manipulation Prevention
- **Description:** Customers cannot manually change their registration_status
- **Test Method:** Attempt to update via client-side Supabase JS
- **Expected Result:** RLS policy blocks update
- **Status:** ⏳ TO TEST

### ST2: ID Document Access Control
- **Description:** Customer A cannot view Customer B's ID
- **Test Method:** Attempt to download URL from different user's session
- **Expected Result:** 403 Forbidden or 404 Not Found
- **Status:** ⏳ TO TEST

### ST3: Edge Function JWT Verification
- **Description:** Verify --no-verify-jwt functions are internal-only
- **Functions to Check:**
  - ef_confirm_strategy (internal - called from admin portal)
  - ef_upload_kyc_id (public - called from customer portal)
  - ef_deposit_scan (internal - called by pg_cron)
- **Status:** ⏳ TO DOCUMENT

## Test Summary

| Milestone | Total Tests | Passed | Failed | Pending |
|-----------|-------------|--------|--------|---------|
| M1 - Prospect | 2 | 2 | 0 | 0 |
| M2 - Strategy | 7 | 3 | 0 | 4 |
| M3 - KYC | 5 | 0 | 0 | 5 |
| M4 - VALR | 4 | 0 | 0 | 4 |
| M5 - Deposit | 4 | 0 | 0 | 4 |
| M6 - Active | 4 | 0 | 0 | 4 |
| Integration | 3 | 0 | 0 | 3 |
| Performance | 2 | 0 | 0 | 2 |
| Security | 3 | 0 | 0 | 3 |
| **TOTAL** | **34** | **5** | **0** | **29** |

## Notes

- **Launch Target:** January 17, 2026
- **Days Remaining:** 17 days
- **Estimated Build Time:** 9-12 days
- **Test Coverage Priority:** Integration tests after M3-M6 built
- **Automated Testing:** Consider Playwright for UI tests post-launch

---

**Document Control:**
- Created: 2025-12-31
- Last Modified: 2025-12-31
- Next Review: After Milestone 3 completion
