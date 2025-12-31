# Customer Onboarding Workflow - CONFIRMED
## Version 1.0 - APPROVED BY DAVIN

**Date:** December 31, 2025  
**Status:** ✅ FINAL - Ready for Implementation

---

## 🎯 6-Milestone Customer Onboarding Pipeline

### Milestone 1: Prospect
**Trigger:** Customer completes interest form on website  
**Status Change:** → `registration_status = 'prospect'`  
**Automatic Actions:**
- ✅ Write row to `public.customer_details` with status='prospect'
- ✅ Send email to admin@bitwealth.co.za (template: `prospect_notification`)

**Implementation Status:**
- ✅ Form exists in `website/index.html`
- ✅ Edge function: `ef_prospect_submit` (deployed)
- ✅ Email template exists and tested

---

### Milestone 2: Confirm Interest
**Trigger:** Admin speaks to prospect and confirms strategy selection  
**Status Change:** `'prospect'` → `'kyc'`  
**Manual Actions Required:**
1. Admin views prospect in Customer Management module
2. Admin selects strategy from dropdown (populated from `public.strategies` table)
3. Admin clicks "Confirm Strategy" button

**Automatic Actions:**
- ✅ Create entry in `public.customer_portfolios` with:
  - `customer_id`
  - `strategy_id` (from selected strategy)
  - `status = 'pending'`
- ✅ Update `customer_details.registration_status = 'kyc'`
- ✅ Send email to customer (template: `kyc_portal_registration`)
  - Email contains registration link to `register.html`
  - Asks customer to create portal account and upload ID

**Implementation Status:**
- ⏳ UI: Strategy dropdown in Customer Management module (TO BUILD)
- ⏳ Edge function: Update `ef_approve_kyc` → rename to `ef_confirm_strategy` (TO UPDATE)
- ⏳ Email template: `kyc_portal_registration` (TO CREATE)

---

### Milestone 3: Portal Registration & KYC
**Trigger:** Customer receives email from Milestone 2  
**Status Change:** `'kyc'` → `'setup'`  

**Customer Actions:**
1. Customer clicks registration link in email
2. Customer creates Supabase Auth account (email/password) on `register.html`
3. Customer logs into customer portal
4. Portal detects status='kyc' → shows "Upload ID Required" page
5. Customer uploads ID copy (naming: `{ccyy-mm-dd}_{last_name}_{first_names}_id.pdf`)

**Automatic Actions After ID Upload:**
- ✅ Store file in Supabase Storage bucket: `kyc-documents`
- ✅ Update `customer_details.kyc_id_document_url` with storage URL
- ✅ Update `customer_details.kyc_id_verified_at = NOW()`
- ✅ Send email to admin@bitwealth.co.za (template: `kyc_id_uploaded_notification`)

**Admin Verification:**
1. Admin receives email notification
2. Admin views uploaded ID in Customer Management module
3. Admin clicks "Verify ID" button

**Automatic Actions After Admin Verification:**
- ✅ Update `customer_details.registration_status = 'setup'`
- ✅ Update `customer_details.kyc_verified_by = admin_user_id`

**Implementation Status:**
- ⏳ Customer portal ID upload page (TO BUILD)
- ⏳ Admin UI for viewing uploaded IDs (TO BUILD)
- ⏳ Edge function: `ef_upload_kyc_id` (TO CREATE)
- ⏳ Supabase Storage bucket: `kyc-documents` (TO CREATE)
- ⏳ Email template: `kyc_id_uploaded_notification` (TO CREATE)

---

### Milestone 4: VALR Account Setup
**Trigger:** Admin verifies ID → status changes to 'setup'  
**Status Change:** `'setup'` → `'deposit'`  

**Automatic Actions When Status='setup':**
- ✅ Call VALR API to create subaccount
- ✅ Store subaccount details in `public.exchange_accounts`:
  - `subaccount_id` (from VALR API response)
  - `label = "{first_names} {last_name} - {strategy_name}"`
  - `customer_id`
  - `strategy_id`
- ✅ Edge function creates row but leaves `deposit_ref = NULL`

**Manual Admin Action:**
1. Admin logs into VALR web interface
2. Admin navigates to subaccount details
3. Admin copies deposit reference code from VALR UI
4. Admin pastes into Customer Management module `deposit_ref` field
5. Admin clicks "Save Deposit Reference"

**Automatic Actions After deposit_ref Saved:**
- ✅ Update `exchange_accounts.deposit_ref = {value}`
- ✅ Update `customer_details.registration_status = 'deposit'`
- ✅ Send email to customer (template: `deposit_instructions`)
  - Email contains VALR banking details
  - Email contains deposit reference code
  - Asks customer to deposit funds

**Implementation Status:**
- ⏳ Edge function: `ef_valr_create_subaccount` (TO CREATE)
- ⏳ Database column: `exchange_accounts.deposit_ref` (TO ADD)
- ⏳ Admin UI: deposit_ref input field (TO BUILD)
- ⏳ Trigger: Auto-change status when deposit_ref saved (TO BUILD)
- ⏳ Email template: `deposit_instructions` (TO CREATE)

---

### Milestone 5: Funds Deposit
**Trigger:** Customer deposits funds into VALR subaccount  
**Status Change:** `'deposit'` → `'active'`  

**Automatic Monitoring:**
- ✅ Edge function: `ef_deposit_scan` runs every 1 hour (pg_cron)
- ✅ For each customer with status='deposit':
  - Check subaccount ZAR balance
  - Check subaccount BTC balance
  - Check subaccount USDT balance
- ✅ If ANY balance > 0:
  - Update `customer_details.registration_status = 'active'`
  - Update `customer_portfolios.status = 'active'`

**Automatic Actions After Status='active':**
- ✅ Send email to admin@bitwealth.co.za (template: `funds_deposited_admin_notification`)
  - Notifies admin to convert ZAR → USDT
- ✅ Send email to customer (template: `registration_complete_welcome`)
  - Welcomes customer
  - Provides portal link again (ask to bookmark)
  - Confirms registration complete

**Implementation Status:**
- ⏳ Edge function: `ef_deposit_scan` (TO CREATE)
- ⏳ pg_cron job: hourly schedule (TO CREATE)
- ⏳ Email template: `funds_deposited_admin_notification` (TO CREATE)
- ⏳ Email template: `registration_complete_welcome` (TO CREATE)

---

### Milestone 6: Customer Active
**Status:** `registration_status = 'active'`  
**Behavior:**
- ✅ Customer has full portal access (dashboard, transactions, statements, withdrawals)
- ✅ Customer trades begin according to strategy (existing LTH_PVR pipeline)
- ✅ Admin can view customer in "Active Customers" section

**Offboarding:**
- Admin can change status to `'inactive'` via Customer Management module
- Inactive customers do NOT participate in trading pipeline
- Inactive customers retain portal access (view-only)

**Implementation Status:**
- ⏳ Admin UI: "Inactive" button (TO BUILD)
- ✅ Trading pipeline: already checks active status

---

## 📊 Database Schema Changes

### Add Column: `public.exchange_accounts.deposit_ref`
```sql
ALTER TABLE public.exchange_accounts
ADD COLUMN deposit_ref TEXT;
```

### Storage Bucket: `kyc-documents`
```sql
-- Create via Supabase Dashboard → Storage → New Bucket
-- Bucket name: kyc-documents
-- Public: false (private)
-- File size limit: 10 MB
-- Allowed MIME types: image/*, application/pdf
```

---

## 📧 Email Templates Required

| Template Key | Milestone | Trigger | Recipient |
|--------------|-----------|---------|-----------|
| `prospect_notification` | M1 | ✅ Form submit | Admin |
| `prospect_confirmation` | M1 | ✅ Form submit | Customer |
| `kyc_portal_registration` | M2 | Strategy confirmed | Customer |
| `kyc_id_uploaded_notification` | M3 | ID uploaded | Admin |
| `deposit_instructions` | M4 | deposit_ref saved | Customer |
| `funds_deposited_admin_notification` | M5 | Balance > 0 | Admin |
| `registration_complete_welcome` | M5 | Balance > 0 | Customer |

**Templates 1-2:** ✅ Already exist and tested  
**Templates 3-7:** ⏳ Need to be created

---

## 🎨 UI Components

### Customer Management Module (Admin UI)
**Sections:**
1. **Prospects (M1)** - Table with "Select Strategy" action
2. **Strategy Selection Modal (M2)** - Dropdown + Confirm button
3. **KYC Review (M3)** - View uploaded IDs + Verify button
4. **VALR Setup (M4)** - deposit_ref input + Save button
5. **Pending Deposits (M5)** - List customers waiting for funds
6. **Active Customers (M6)** - Full customer list with Inactive button

### Customer Portal
**Status-Based Views:**
- `status='kyc'`: Show "Upload ID Required" page only
- `status='setup'|'deposit'`: Show onboarding progress (limited access)
- `status='active'`: Show full dashboard (all features)

---

## ✅ Confirmation Checklist

- [x] Milestone 1: Prospect form (WORKING)
- [x] Milestone 2: Strategy selection → creates portfolio → status='kyc'
- [x] Milestone 3: Customer registers → uploads ID → admin verifies → status='setup'
- [x] Milestone 4: Auto-create subaccount → admin enters deposit_ref → status='deposit'
- [x] Milestone 5: Hourly scan → balance > 0 → status='active'
- [x] Milestone 6: Full portal access + trading begins
- [x] Customer portal access: Starts at Milestone 3 (limited) → Full at Milestone 6
- [x] Strategy source: `public.strategies` table
- [x] File naming: `{ccyy-mm-dd}_{last_name}_{first_names}_id.pdf`
- [x] Module rename: "Customer Maintenance" → "Customer Management"

---

**Approved By:** Davin Gaier  
**Date:** December 31, 2025  
**Next Steps:** Implement all ⏳ items in order of milestones

