# Customer Onboarding Workflow - IMPLEMENTATION CONFIRMATION
## All Changes Summary - Ready for Your Verification

**Date:** December 31, 2025  
**Status:** ✅ Documentation Updated - Awaiting Your Confirmation Before Implementation

---

## 📋 CONFIRMATION CHECKLIST

Please verify each item matches your requirements:

### ✅ Core Workflow Understanding

- [x] **6 Milestones:** Prospect → Confirm Interest → Portal Registration & KYC → VALR Setup → Funds Deposit → Active
- [x] **Portal Access:** Starts at Milestone 3 (limited: ID upload only) → Full at Milestone 6
- [x] **Registration Flow:** Customer creates account THEN uploads ID (Option A)
- [x] **Strategy Source:** Dropdown populated from `public.strategies` table
- [x] **File Naming:** `{ccyy-mm-dd}_{last_name}_{first_names}_id.pdf` (e.g., `2025-12-31_Gaier_Davin_id.pdf`)
- [x] **Module Rename:** "Customer Maintenance" → "Customer Management" everywhere
- [x] **Storage:** Supabase Storage bucket named `kyc-documents` (private, 10MB limit)

---

## 📄 DOCUMENTS UPDATED

### 1. **NEW:** `Customer_Onboarding_Workflow_CONFIRMED.md`
**Status:** ✅ CREATED  
**Purpose:** Single source of truth for onboarding workflow  
**Contents:**
- All 6 milestones with detailed triggers and actions
- Database schema changes (deposit_ref column, storage bucket)
- Email template requirements (7 templates total)
- UI component requirements
- Implementation status tracking

**Your Action:** Review this document first - it's the master specification

---

### 2. **UPDATED:** `SDD_v0.6.md`
**Status:** ✅ UPDATED to v0.6.3  
**Changes:**
- Added complete v0.6.3 changelog section
- Documents 6-milestone pipeline
- Lists all edge functions required (3 existing, 3 to create)
- Lists all email templates (2 existing, 5 to create)
- Marks implementation status for each component

**Your Action:** Verify v0.6.3 changelog accurately reflects your requirements

---

### 3. **UPDATED:** `Customer_Portal_Build_Plan.md`
**Status:** ✅ UPDATED to v1.2  
**Changes:**
- Header warns this is updated with confirmed workflow
- References `Customer_Onboarding_Workflow_CONFIRMED.md` as source
- Progress tracker now shows milestone-by-milestone status
- Estimated time updated to 9-12 days (tight against Jan 10 launch)
- Removed old task list, replaced with milestone-based checklist

**Your Action:** Verify timeline estimate is realistic

---

### 4. **CODE CHANGES:** What's Already Correct vs What Needs Changing

#### ✅ NO CHANGES NEEDED (Already Correct):
1. **ef_prospect_submit** - Already writes status='prospect' and sends admin email ✅
2. **prospect_notification email** - Already notifies admin@bitwealth.co.za ✅
3. **prospect_confirmation email** - Already sent to customer ✅
4. **ef_customer_register** - Already creates Supabase Auth account ✅
5. **register.html** - Already functional registration page ✅

#### ⏳ NEW COMPONENTS TO BUILD:
1. **Admin UI: Strategy Selection Dropdown (Milestone 2)**
   - Location: Customer Management module
   - Dropdown source: `SELECT strategy_id, strategy_name FROM public.strategies`
   - On confirm: Creates customer_portfolios entry + changes status='kyc'

2. **Edge Function: ef_confirm_strategy (Milestone 2)**
   - Replaces current ef_approve_kyc function
   - Creates customer_portfolios entry with selected strategy_id
   - Changes status='prospect' → 'kyc'
   - Sends email: kyc_portal_registration (with register.html link)

3. **Email Template: kyc_portal_registration (Milestone 2)**
   - Subject: "Welcome to BitWealth - Create Your Portal Account"
   - Body: Registration link + instructions to upload ID after registration
   - To: Customer email

4. **Customer Portal: ID Upload Page (Milestone 3)**
   - Shows when customer logs in with status='kyc'
   - File input with validation (10MB max, image/* or PDF only)
   - Uploads to Supabase Storage: kyc-documents bucket
   - Naming: `{ccyy-mm-dd}_{last_name}_{first_names}_id.pdf`
   - After upload: Calls ef_upload_kyc_id edge function

5. **Edge Function: ef_upload_kyc_id (Milestone 3)**
   - Stores file URL in customer_details.kyc_id_document_url
   - Sends email: kyc_id_uploaded_notification (to admin)

6. **Email Template: kyc_id_uploaded_notification (Milestone 3)**
   - Subject: "KYC Document Uploaded: {customer_name}"
   - Body: Link to admin UI to view/verify ID
   - To: admin@bitwealth.co.za

7. **Admin UI: View Uploaded IDs + Verify Button (Milestone 3)**
   - Shows thumbnail/link to uploaded ID document
   - "Verify ID" button
   - On verify: Changes status='kyc' → 'setup'
   - Sets kyc_id_verified_at = NOW()

8. **Database Column: exchange_accounts.deposit_ref**
   ```sql
   ALTER TABLE public.exchange_accounts
   ADD COLUMN deposit_ref TEXT;
   ```

9. **Edge Function: ef_valr_create_subaccount (Milestone 4)**
   - Triggered when status='setup'
   - Calls VALR API to create subaccount
   - Stores subaccount_id in exchange_accounts
   - Label format: "{first_names} {last_name} - {strategy_code}"

10. **Admin UI: deposit_ref Input Field (Milestone 4)**
    - Text input next to subaccount_id
    - "Save Deposit Reference" button
    - On save: Updates exchange_accounts.deposit_ref
    - Auto-changes status='setup' → 'deposit'
    - Triggers email: deposit_instructions

11. **Email Template: deposit_instructions (Milestone 4)**
    - Subject: "Fund Your BitWealth Account"
    - Body: VALR banking details + deposit_ref to use
    - To: Customer email

12. **Edge Function: ef_deposit_scan (Milestone 5)**
    - Runs every 1 hour via pg_cron
    - For each customer with status='deposit':
      - Query VALR API for subaccount balances (ZAR, BTC, USDT)
      - If ANY balance > 0:
        - Change status='deposit' → 'active'
        - Change customer_portfolios.status → 'active'
        - Send email: funds_deposited_admin_notification
        - Send email: registration_complete_welcome

13. **Email Template: funds_deposited_admin_notification (Milestone 5)**
    - Subject: "Funds Deposited: {customer_name}"
    - Body: Notify admin to convert ZAR → USDT
    - To: admin@bitwealth.co.za and davin.gaier@gmail.com

14. **Email Template: registration_complete_welcome (Milestone 5)**
    - Subject: "Welcome to BitWealth - Registration Complete!"
    - Body: Welcome message + portal link (ask to bookmark) + next steps
    - To: Customer email

15. **Admin UI: "Set Inactive" Button (Milestone 6)**
    - Available for customers with status='active'
    - Changes status='active' → 'inactive'
    - Stops customer from participating in trading pipeline

#### ❌ COMPONENTS TO DELETE/REPURPOSE:
1. **ef_approve_kyc** - Will be REPLACED by ef_confirm_strategy
   - Current function sends registration email immediately
   - New workflow: Registration email sent AFTER strategy selection
2. **Admin_KYC_Workflow_Test_Cases.md** - Will be REPLACED with new milestone-based test cases
3. **KYC Management card in admin UI** - Will be REPLACED with strategy selection dropdown

---

## 📧 EMAIL TEMPLATES SUMMARY

| Template Key | Status | Milestone | Trigger | Recipient |
|--------------|--------|-----------|---------|-----------|
| `prospect_notification` | ✅ EXISTS | M1 | Form submit | Admin |
| `prospect_confirmation` | ✅ EXISTS | M1 | Form submit | Customer |
| `kyc_portal_registration` | ⏳ CREATE | M2 | Strategy confirmed | Customer |
| `kyc_id_uploaded_notification` | ⏳ CREATE | M3 | ID uploaded | Admin |
| `deposit_instructions` | ⏳ CREATE | M4 | deposit_ref saved | Customer |
| `funds_deposited_admin_notification` | ⏳ CREATE | M5 | Balance > 0 | Admin |
| `registration_complete_welcome` | ⏳ CREATE | M5 | Balance > 0 | Customer |

**Total:** 2 exist, 5 to create

---

## ⚠️ CRITICAL DEPENDENCIES

**These must be completed in order:**

1. **Milestone 2** (Strategy Selection)
   - Blocks: All subsequent milestones
   - Reason: customer_portfolios entry required for strategy tracking
   - Time: 1 day

2. **Milestone 3** (ID Upload)
   - Blocks: VALR setup (admin can't proceed without verified ID)
   - Reason: Legal compliance (KYC required before trading)
   - Time: 2-3 days

3. **Milestone 4** (VALR Setup)
   - Blocks: Deposits (customer needs subaccount to deposit)
   - Reason: No deposit destination without subaccount
   - Time: 2 days

4. **Milestone 5** (Deposit Scan)
   - Blocks: Trading (can't trade without funds)
   - Reason: Status change to 'active' required for pipeline
   - Time: 1-2 days

5. **Milestone 6** (Full Portal)
   - Non-blocking: Can launch with limited portal features
   - Reason: View-only dashboard acceptable for MVP
   - Time: 3-4 days (can be deferred)

---

## 🎯 LAUNCH IMPACT ASSESSMENT

### **Scenario A: Build Everything (Jan 1-10)**
- **Days Available:** 10
- **Days Required:** 9-12 (tight!)
- **Risk:** High (no buffer for bugs/delays)
- **Recommendation:** ⚠️ Not advisable without reducing scope

### **Scenario B: MVP Launch with Manual Workarounds (Jan 10)**
**Build:**
- ✅ Milestone 1: Already done
- ✅ Milestone 2: Strategy selection (1 day)
- ✅ Milestone 3: ID upload (2-3 days)
- ⏸️ Milestone 4: Manual VALR setup (admin creates subaccounts via VALR web UI)
- ⏸️ Milestone 5: Manual deposit checking (admin checks VALR daily)
- ⏸️ Milestone 6: Basic portal only (view balances, no withdrawals/statements)

**Time:** 3-4 days (buffer for testing)  
**Launch:** Jan 10 achievable ✅  
**Post-Launch:** Automate Milestones 4-5 in week of Jan 13-17

### **Scenario C: Delayed Launch (Jan 17)**
**Build:** Everything (Milestones 1-6 complete)  
**Time:** 9-12 days (comfortable pace)  
**Launch:** Jan 17 realistic ✅  
**Benefit:** Fully automated, no manual workarounds

---

## ✅ FINAL CONFIRMATION QUESTIONS

Please confirm before I begin implementation:

1. **Workflow:** Do all 6 milestones match your exact requirements? Any changes needed? Yes. No changes needed.
2. **Launch Strategy:** Which scenario (A, B, or C)? Should we prioritize Jan 10 with manual workarounds? Scenario C: Delayed Launch (Jan 17) to build everything properly.
3. **Module Rename:** Confirmed to rename "Customer Maintenance" → "Customer Management" everywhere? Yes, confirmed.
4. **Strategy Dropdown:** Should I query `public.strategies` table or hardcode strategy list? Query `public.strategies` table.
5. **Email Sender:** All emails from "admin@bitwealth.co.za" or use "noreply@bitwealth.co.za" for automated emails? Use "noreply@bitwealth.co.za".
6. **Test Cases:** Should I update existing test cases or create new ones for each milestone? Please update existing test cases to reflect milestone-based testing.
7. **Priority:** Which milestones are MUST-HAVE for Jan 10 vs NICE-TO-HAVE for later? All milestones are MUST-HAVE for Jan 17 launch.

---

**Once you confirm, I will:**
1. Begin with Milestone 2 (strategy selection UI + edge function)
2. Create all 5 missing email templates
3. Build Milestone 3 (ID upload page + admin verification)
4. Continue in order through Milestone 6

**Estimated completion:** Jan 8-12 (depending on scope decisions)

---

**Please Reply With:**
- ✅ "Confirmed - proceed with implementation" OR
- ❓ "Wait - I have changes" (specify what needs adjustment)

