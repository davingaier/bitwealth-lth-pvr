# BitWealth Customer Portal - Build Plan
## Version 2.2 - INTEGRATION TESTING COMPLETE

**Project:** Customer Lifecycle Platform & Portal  
**Author:** Dav / GPT  
**Created:** 2025-12-29  
**Last Updated:** 2026-01-06 (Email Branding Complete)  
**MVP Target:** 2026-01-10 (4 days remaining)  
**Full Launch Target:** 2026-01-17 (11 days remaining) ✅ AHEAD OF SCHEDULE

🎉 **MAJOR MILESTONE:** Integration testing complete - all 3 integration tests passed!  
✅ **STATUS UPDATE:** All 6 milestones + Portal MVP + Integration Tests + Email Branding are COMPLETE.  
✅ **TEST CUSTOMER:** Customer 39 (Integration TestUser) successfully progressed through full pipeline.  
✅ **TESTING PROGRESS:** 77% complete (46/60 tests passed + email branding deployed)  
✅ **EMAIL TEMPLATES:** 17/17 templates deployed with professional text-only headers, Aptos font

**Integration Testing Results (2026-01-05):**
- ✅ **IT1: Full Pipeline End-to-End** - PASS (45 minutes, 5 bugs fixed)
- ✅ **IT2: Email Flow Verification** - PASS (all 7 emails verified)
- ✅ **IT3: Database State Consistency** - PASS (all checks validated)

---

## 📊 Implementation Progress (COMPLETE)

### ✅ Milestone 1 - Prospect (COMPLETE - deployed 2025-12-28)
- ✅ Prospect form in website/index.html
- ✅ Edge function: ef_prospect_submit (deployed & tested TC1.1-TC1.5)
- ✅ Email: prospect_notification (to admin)
- ✅ Email: prospect_confirmation (to customer)

### ✅ Milestone 2 - Confirm Interest (COMPLETE - deployed 2025-12-31)
- ✅ Admin UI: Strategy selection dropdown in Customer Management module
- ✅ Edge function: ef_confirm_strategy (deployed --no-verify-jwt)
- ✅ Create customer_portfolios entry when strategy selected
- ✅ Email: kyc_portal_registration (to customer with registration link)
- ✅ Tested end-to-end with customer_id=31

### ✅ Milestone 3 - Portal Registration & KYC (COMPLETE - deployed 2025-12-30)
- ✅ Customer registration page (register.html - EXISTS)
- ✅ Customer portal ID upload page (website/upload-kyc.html - 475 lines)
- ✅ Supabase Storage bucket: kyc-documents (private, 10MB, 4 RLS policies)
- ✅ Edge function: ef_upload_kyc_id (deployed with JWT verification)
- ✅ Admin UI: KYC ID Verification card - View Document + Verify buttons
- ✅ Email: kyc_id_uploaded_notification (to admin)
- **File Naming:** `{ccyy-mm-dd}_{last_name}_{first_names}_id.{ext}`
- **Lines of Code:** 475 (upload page) + 159 (edge function) + 180 (admin UI)

### ✅ Milestone 4 - VALR Account Setup (COMPLETE - deployed 2025-12-30)
- ✅ Edge function: ef_valr_create_subaccount (VALR API with HMAC SHA-512)
- ✅ Database column: exchange_accounts.deposit_ref (TEXT)
- ✅ Admin UI: VALR Account Setup card - 3-stage workflow
- ✅ Trigger: Auto-change status when deposit_ref saved
- ✅ Email: deposit_instructions (to customer with FNB banking details)
- **Lines of Code:** 244 (edge function) + 295 (admin UI)

### ✅ Milestone 5 - Funds Deposit (COMPLETE & AUTOMATED - deployed 2025-12-30)
- ✅ Edge function: ef_deposit_scan (deployed --no-verify-jwt)
- ✅ Query VALR subaccount balances (ZAR/BTC/USDT via API)
- ✅ Auto-change status='deposit' → 'active' when ANY balance > 0
- ✅ Email: funds_deposited_admin_notification (to admin)
- ✅ Email: registration_complete_welcome (to customer)
- ✅ pg_cron job: deposit-scan-hourly (jobid=31, runs every hour at :00)
- **Lines of Code:** 239 (edge function)

### ✅ Milestone 6 - Customer Active (COMPLETE - deployed 2025-12-30)
- ✅ Trading pipeline (EXISTS - LTH_PVR strategy operational)
- ✅ Full customer portal UI (website/portal.html from previous session)
- ✅ Admin UI: Active Customers card with Set Inactive button
- ✅ Confirmation dialog prevents accidental inactivation
- **Lines of Code:** 170 (admin UI)

### **IMPLEMENTATION STATUS: 100% COMPLETE** 🎉
- **Total Lines of Code:** ~3,500 lines (M3-M6)
- **Deployment Date:** 2025-12-30 (M3-M6), 2025-12-31 (M2)
- **Testing Status:** M1-M6 tested (77%), email branding deployed
- **Days to Launch:** 4 days (on track for Jan 10 MVP launch)
- **Email Templates:** 17/17 updated with text-only headers, Aptos font, professional design

---

## 📱 Phase 1: Customer Portal Dashboard (COMPLETE - 2026-01-04)

### ✅ Portal MVP Implementation
**Status:** DEPLOYED & TESTED  
**Test Customer:** Customer 31 (Jemaica Gaier, jemaicagaier@gmail.com)  
**Deployed Files:**
- `website/customer-portal.html` (379 lines)
- `supabase/functions/public.get_customer_onboarding_status.fn.sql` (90 lines)
- `supabase/functions/public.list_customer_portfolios.fn.sql` (52 lines)

### Features Implemented:

#### 1. Authentication & Session Management
- Supabase Auth integration using `auth.getSession()` (consistent with login.html)
- Redirect logic: Unauthenticated → login.html
- Logout functionality
- Session validation on page load

#### 2. Onboarding Status Tracker
- Visual progress bar showing 6 milestones
- Green checkmarks for completed milestones
- Dynamic progress percentage calculation
- Status message: "Account active - trading commenced"
- RPC call: `get_customer_onboarding_status(customer_id)`

#### 3. Portfolio Dashboard
- Pre-trading state: "Trading starts tomorrow!" message (yellow alert box)
- Post-trading state: Stats grid with NAV, BTC balance, USDT balance, ROI
- Automatically shows stats when `balances_daily` has data
- RPC call: `get_customer_dashboard(customer_id)` (prepared for Phase 2)

#### 4. Portfolio List
- Displays all customer portfolios
- Shows: Strategy name, status (ACTIVE/INACTIVE), creation date
- Includes current balances from `lth_pvr.balances_daily` (when available)
- RPC call: `list_customer_portfolios(customer_id)`

#### 5. UI/UX Design
- Blue gradient background (`#1e3a8a` to `#3b82f6`)
- White card-based layout with rounded corners
- High contrast text (dark brown #78350f on yellow, dark green #064e3b on green)
- Responsive grid layout for stats
- Loading states with proper messaging

### Technical Details:

#### RPC Functions (public schema):
```sql
-- Returns 6-milestone status array + next action
get_customer_onboarding_status(p_customer_id INTEGER) RETURNS JSONB

-- Returns portfolios with latest balances
list_customer_portfolios(p_customer_id INTEGER) RETURNS TABLE
```

#### Key Schema Alignments:
- `customer_id` is BIGINT (not UUID) - RPC functions updated accordingly
- `customer_portfolios.strategy_code` exists directly (no strategies table join needed)
- `balances_daily` uses `customer_id` (not `portfolio_id`) and `date` (not `balance_date`)
- `balances_daily` doesn't have `roi_pct` or `cagr_pct` - calculated on demand

#### Bug Fixes Applied:
1. **Auth method mismatch**: Changed portal to use `getSession()` vs `getUser()` (prevented redirect loop)
2. **Expired anon key**: Updated from Dec 2024 key to current valid key
3. **Parameter type mismatch**: Changed RPC functions from UUID to INTEGER
4. **SQL ambiguous columns**: Added explicit aliases in LATERAL join
5. **Schema reference errors**: Fixed table structure assumptions

### Test Results (Customer 31):
- ✅ Login successful (jemaicagaier@gmail.com / BitWealth2026!)
- ✅ All 6 milestones showing complete with green checkmarks
- ✅ Status message: "Account active - trading commenced" (dark green text, readable)
- ✅ Portfolio listing: "LTH_PVR Strategy - ACTIVE" displayed
- ✅ Pre-trading message: "Trading starts tomorrow!" (dark brown text, readable)
- ✅ No console errors
- ✅ Logout functional
- ✅ No redirect loops
- ✅ Statement download UI functional (month/year dropdowns with smart filtering)
- ✅ December 2025 statement available for download

### Timeline:
- **2026-01-04 (Today):** Customer 31 activated, portal accessible
- **2026-01-05 03:00 UTC:** First CI bands fetch
- **2026-01-05 03:05 UTC:** First trading decision generated
- **2026-01-05 03:15 UTC:** First order executed
- **2026-01-05 Evening:** First `balances_daily` record created
- **After 2026-01-05:** Portal will display real balance data automatically

### Files Created/Modified:
```
website/
  customer-portal.html (NEW - 379 lines)
  login.html (MODIFIED - redirect logic)

supabase/functions/
  public.get_customer_onboarding_status.fn.sql (NEW - 90 lines)
  public.list_customer_portfolios.fn.sql (NEW - 52 lines)

supabase/migrations/
  fix_customer_portal_rpc_integer_params_v2.sql (APPLIED)
  fix_list_customer_portfolios_schema.sql (APPLIED)
  fix_list_customer_portfolios_ambiguous_columns.sql (APPLIED)
```

### **PHASE 1 STATUS: 100% COMPLETE** ✅
**MVP Readiness:** Portal is production-ready for launch. Balance data will auto-populate after first trading run.

### ✅ Phase 1B: Monthly Statement Generation (COMPLETE - 2026-01-15)

**Status:** DEPLOYED & TESTED  
**Features Implemented:**

#### 1. PDF Statement Generation (ef_generate_statement)
- **Professional Formatting:**
  * Right-aligned currency values, percentages, BTC amounts
  * "Net Asset Value" terminology (not "Balance")
  * Fee breakdown: Platform, Performance, Exchange, Total (bold)
  * Benchmark comparison table with colored header
  * Footer with actual filename (SDD convention)
- **Technical Stack:**
  * jsPDF 2.5.1 for client-side PDF generation
  * Queries: balances_daily, ledger_lines, std_dca_balances_daily
  * Calculations: ROI, CAGR, max drawdown, Sharpe ratio, Sortino ratio
- **File Naming:** CCYY-MM-DD_LastName_FirstNames_statement_M##_CCYY.pdf
- **Logo:** Placeholder (awaiting <50KB compressed version)

#### 2. Automated Monthly Generation (ef_monthly_statement_generator)
- **Scheduling:** pg_cron job at 00:01 UTC on 1st of every month
- **Batch Processing:**
  * Calculates previous month/year
  * Fetches all active customers
  * Generates statement for each customer
  * Sends email with download link (Resend API)
- **Email Template:**
  * Subject: "Your {Month} {Year} BitWealth Investment Statement"
  * Professional HTML with download button
  * Performance summary text
  * Support email in footer

#### 3. Storage System (customer-statements bucket)
- **Configuration:**
  * Private bucket with RLS policies
  * 5MB file size limit
  * PDF files only
- **RLS Policies:**
  * Customers: Insert/read own org/customer folder only
  * Service role: Full access
- **Path Structure:** {ORG_ID}/customer-{customer_id}/{filename}

#### 4. Customer Portal Integration
- **Statement Tab UI:**
  * Year dropdown: Account creation year → current year
  * Month dropdown: Smart filtering (excludes current/future months)
  * Download button: Checks storage first, generates if needed
- **Smart Month Logic:**
  * Current year: Shows account creation month → previous month
  * Past years: Shows all 12 months (or from account creation if mid-year)
  * Prevents partial month statements
- **Pre-Generated Retrieval:** Instant download from storage on repeat requests

#### 5. Bug Fixes
- ✅ Added missing ORG_ID constant (prevents "ORG_ID is not defined" error)
- ✅ Reverted month logic to exclude current month (no partial statements)
- ✅ Fixed storage path construction for customer folders

**Files Created/Modified:**
```
supabase/functions/
  ef_generate_statement/index.ts (NEW - 445 lines)
  ef_monthly_statement_generator/index.ts (NEW - 220 lines)

supabase/migrations/
  20260115_create_customer_statements_bucket.sql (NEW)
  20260115_add_monthly_statement_cron.sql (NEW)

website/
  customer-portal.html (MODIFIED - added statement tab + ORG_ID constant)
```

**Testing:**
- ✅ PDF generation with all 10 enhancements
- ✅ Storage bucket with RLS policies
- ✅ Cron job scheduled for Feb 1, 2026
- ✅ Month dropdown filtering (December 2025 available for Customer 31)
- ⏳ End-to-end download test pending

**Future Enhancements (12 items documented in POST_LAUNCH_ENHANCEMENTS.md):**
- Logo optimization, multi-page support, YTD summary, CSV export, custom date ranges, etc.

**Next Steps:**
- Test December 2025 statement download with Customer 31
- Verify email delivery on February 1, 2026 (first automated run)
- Monitor cron job execution logs

---

## 0. Executive Summary

This build plan transforms the LTH_PVR solution from an admin-only system into a **full customer lifecycle platform** with:

- **Public prospecting** (interest form)
- **6-milestone onboarding pipeline** (prospect → active customer)
- **Customer portal** (performance, transactions, statements)
- **Self-service features** (withdrawals, support requests)
- **Automated communications** (8 email templates)
- **Legal compliance** (terms, privacy, disclaimers)

### Scope Split

**MVP (Jan 10):** Core functionality, manual workflows  
**Full Launch (Jan 24):** Automation, advanced reporting, polish

---

## 1. Architecture Overview

### 1.1 User Roles & Access

| Role | Access | Authentication |
|------|--------|----------------|
| **Prospect** | Public interest form only | None (unauthenticated) |
| **Customer (Onboarding)** | Portal login, view onboarding status | Supabase Auth (email/password) |
| **Customer (Active)** | Full portal access (dashboard, transactions, statements, withdrawals) | Supabase Auth (email/password) |
| **Admin** | Existing admin UI + customer management | Current admin login |

### 1.2 URL Structure

```
website/
├── index.html              # ✅ Public homepage with prospect form (COMPLETE)
├── register.html           # ✅ Customer registration page (COMPLETE)
├── portal.html             # Existing demo (needs customer auth integration)
├── customer-portal.html    # ⏳ NEW: Customer dashboard (TO BUILD)
└── (admin in ui/)          # ✅ "Advanced BTC DCA Strategy.html" (COMPLETE)
```

**Implementation Notes:**
- `index.html` contains fully functional prospect interest form (tested TC1.1-TC1.5)
- `register.html` handles customer registration with Supabase Auth (tested TC2.1-TC2.6)
- `portal.html` exists but needs refactoring for customer authentication
- `customer-portal.html` is the main remaining UI work (dashboard, transactions, statements)

### 1.3 Technology Stack

- **Frontend:** HTML, CSS (Aptos font, blue/gold/white theme), Vanilla JavaScript
- **Backend:** Supabase (PostgreSQL + Edge Functions)
- **Auth:** Supabase Auth (email verification, password reset)
- **Email:** Direct SMTP via mail.bitwealth.co.za:587 (8 templates)
- **Storage:** Supabase Storage (KYC documents)
- **PDF Generation:** jsPDF or similar (statements)

---

## 2. Database Schema Changes

### 2.1 New Tables

#### `public.withdrawal_requests`
```sql
CREATE TABLE public.withdrawal_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    customer_id UUID NOT NULL REFERENCES public.customer_details(customer_id),
    portfolio_id UUID REFERENCES public.customer_portfolios(portfolio_id),
    amount_usdt NUMERIC(20,8) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'completed', 'rejected')),
    notes TEXT, -- Admin notes (reason for rejection, etc.)
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    created_by UUID, -- customer_id who requested
    approved_by UUID, -- admin user_id
    CONSTRAINT positive_amount CHECK (amount_usdt > 0)
);

CREATE INDEX idx_withdrawal_requests_customer ON public.withdrawal_requests(customer_id);
CREATE INDEX idx_withdrawal_requests_status ON public.withdrawal_requests(status);
```

#### `public.support_requests`
```sql
CREATE TABLE public.support_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    customer_id UUID REFERENCES public.customer_details(customer_id), -- NULL if unauthenticated prospect
    email TEXT NOT NULL, -- Capture even if not registered
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID, -- admin user_id
    resolution_notes TEXT
);

CREATE INDEX idx_support_requests_customer ON public.support_requests(customer_id);
CREATE INDEX idx_support_requests_status ON public.support_requests(status);
CREATE INDEX idx_support_requests_created ON public.support_requests(created_at DESC);
```

#### `public.customer_agreements`
```sql
CREATE TABLE public.customer_agreements (
    agreement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    customer_id UUID NOT NULL REFERENCES public.customer_details(customer_id),
    agreement_type TEXT NOT NULL CHECK (agreement_type IN ('terms_of_service', 'privacy_policy', 'investment_disclaimer')),
    version TEXT NOT NULL, -- e.g., 'v1.0', 'v1.1'
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT,
    UNIQUE(customer_id, agreement_type, version)
);

CREATE INDEX idx_customer_agreements_customer ON public.customer_agreements(customer_id);
```

#### `public.email_templates`
```sql
CREATE TABLE public.email_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    template_code TEXT NOT NULL UNIQUE, -- e.g., 'prospect_notification', 'kyc_request'
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL, -- HTML email body with {{placeholder}} variables
    body_text TEXT, -- Plain text fallback
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initial templates will be inserted via migration
```

#### `public.email_logs`
```sql
CREATE TABLE public.email_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    template_code TEXT REFERENCES public.email_templates(template_code),
    recipient_email TEXT NOT NULL,
    subject TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT CHECK (status IN ('sent', 'failed', 'bounced')),
    smtp_message_id TEXT, -- SMTP message ID from mail server
    legacy_resend_message_id TEXT, -- Legacy: Resend API message ID (pre-2026-01-04)
    error_message TEXT
);

CREATE INDEX idx_email_logs_recipient ON public.email_logs(recipient_email);
CREATE INDEX idx_email_logs_sent_at ON public.email_logs(sent_at DESC);
```

### 2.2 Table Modifications

#### `public.customer_details` (add columns)
```sql
ALTER TABLE public.customer_details
ADD COLUMN phone_number TEXT,
ADD COLUMN phone_country_code TEXT, -- e.g., '+27'
ADD COLUMN country TEXT,
ADD COLUMN upfront_investment_amount_range TEXT, -- e.g., 'R10000-R50000', 'R50000-R100000'
ADD COLUMN monthly_investment_amount_range TEXT, -- e.g., 'R1000-R5000', 'R5000-R10000'
ADD COLUMN prospect_message TEXT, -- Initial message from interest form
ADD COLUMN kyc_id_document_url TEXT, -- Supabase Storage URL
ADD COLUMN kyc_id_verified_at TIMESTAMPTZ,
ADD COLUMN kyc_verified_by UUID, -- admin user_id
ADD COLUMN portal_access_granted_at TIMESTAMPTZ,
ADD COLUMN terms_accepted_at TIMESTAMPTZ,
ADD COLUMN privacy_accepted_at TIMESTAMPTZ,
ADD COLUMN disclaimer_signed_at TIMESTAMPTZ;
```

#### `public.exchange_accounts` (add column)
```sql
ALTER TABLE public.exchange_accounts
ADD COLUMN deposit_reference TEXT; -- VALR deposit reference code
```

### 2.3 RLS Policies (Customer Access)

```sql
-- withdrawal_requests: Customers see only their own
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawal_requests_customer_select ON public.withdrawal_requests
FOR SELECT USING (
    customer_id = auth.uid()
);

CREATE POLICY withdrawal_requests_customer_insert ON public.withdrawal_requests
FOR INSERT WITH CHECK (
    customer_id = auth.uid() AND status = 'pending'
);

-- support_requests: Customers see only their own
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_requests_customer_select ON public.support_requests
FOR SELECT USING (
    customer_id = auth.uid()
);

CREATE POLICY support_requests_customer_insert ON public.support_requests
FOR INSERT WITH CHECK (
    customer_id = auth.uid() OR customer_id IS NULL
);

-- customer_agreements: Customers see only their own
ALTER TABLE public.customer_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_agreements_customer_select ON public.customer_agreements
FOR SELECT USING (
    customer_id = auth.uid()
);

CREATE POLICY customer_agreements_customer_insert ON public.customer_agreements
FOR INSERT WITH CHECK (
    customer_id = auth.uid()
);
```

---

## 3. Edge Functions

### 3.1 New Edge Functions

#### `ef_prospect_submit`
**Purpose:** Handle public interest form submission  
**Authentication:** None (public endpoint)  
**Flow:**
1. Validate form data (email format, phone, required fields)
2. Check if email already exists in `customer_details`
3. Insert row into `customer_details` with `status = 'prospect'`
4. Send email to admin (template: `prospect_notification`)
5. Send auto-reply to prospect (template: `prospect_confirmation`)
6. Return success response

#### `ef_send_email`
**Purpose:** Centralized email sending function  
**Authentication:** Service role only  
**Parameters:** `template_code`, `recipient_email`, `variables` (object for placeholders)  
**Flow:**
1. Fetch template from `email_templates`
2. Replace `{{placeholders}}` with actual values
3. Send via SMTP (nodemailer)
4. Log to `email_logs` with smtp_message_id
5. Return status

#### `ef_kyc_request`
**Purpose:** Trigger KYC email when status changes to 'KYC'  
**Authentication:** Admin only  
**Flow:**
1. Fetch customer details
2. Send email via `ef_send_email` (template: `kyc_request`)
3. Update `customer_details` with `kyc_requested_at`

#### `ef_customer_register`
**Purpose:** Complete customer registration and create Supabase Auth account  
**Authentication:** Public (called from get-started page after prospect approved)  
**Flow:**
1. Validate customer exists with `status IN ('kyc', 'setup', 'funded', 'active')`
2. Create Supabase Auth user (email/password)
3. Link auth.uid() to customer_id
4. Record agreement acceptance in `customer_agreements`
5. Update `portal_access_granted_at`
6. Send welcome email

#### `ef_withdrawal_request_submit`
**Purpose:** Handle customer withdrawal request  
**Authentication:** Customer (JWT)  
**Flow:**
1. Validate customer is active
2. Check available USDT balance (via RPC)
3. Insert row into `withdrawal_requests` with `status = 'pending'`
4. Send email to admin (template: `withdrawal_request_notification`)
5. Return confirmation

#### `ef_support_request_submit`
**Purpose:** Handle customer support request  
**Authentication:** Optional (customer or unauthenticated)  
**Flow:**
1. Insert row into `support_requests`
2. Send email to admin (template: `support_request_notification`)
3. Send auto-reply to customer (template: `support_request_confirmation`)

#### `ef_generate_statement_pdf`
**Purpose:** Generate monthly PDF statement for customer  
**Authentication:** Customer (JWT)  
**Parameters:** `portfolio_id`, `year`, `month`  
**Flow:**
1. Fetch ledger lines, balances, fees for month
2. Fetch benchmark comparison data
3. Generate branded PDF with logo, charts, transaction table
4. Return PDF as blob or upload to Storage and return URL

#### `ef_valr_list_subaccounts`
**Purpose:** Fetch all VALR subaccounts and attempt to match with customers in 'setup' status  
**Authentication:** Admin only  
**Flow:**
1. Call VALR API: `GET /v1/account/subaccounts`
2. Parse response to get list of subaccounts with IDs and labels
3. Query customers with `status = 'setup'`
4. Attempt auto-match by label pattern: "{first_names} {surname} - {strategy}"
5. Return matched and unmatched subaccounts for admin review
6. Admin can manually assign unmatched subaccounts via UI

### 3.2 Modified Edge Functions

#### `ef_valr_deposit_scan` (tweaks)
- Add check for customers with `status = 'funded'`
- When deposit detected for new customer (first deposit), trigger status change workflow
- Send email to admin (template: `funds_deposited_notification`)

---

## 4. RPC Functions (UI)

### 4.1 Customer Portal RPCs

#### `public.get_customer_dashboard(p_portfolio_id UUID)`
**Returns:** JSONB with:
- Current balances (BTC, USDT)
- NAV (USD)
- ROI %, CAGR %
- Total contributions
- Last update timestamp

#### `public.list_customer_transactions(p_portfolio_id UUID, p_from_date DATE, p_to_date DATE)`
**Returns:** Table of:
- event_date, event_type, btc_delta, usdt_delta, fee_btc, fee_usdt, note

#### `public.list_customer_withdrawal_requests(p_customer_id UUID)`
**Returns:** Table of withdrawal requests with status

#### `public.get_customer_onboarding_status(p_customer_id UUID)`
**Returns:** JSONB with:
- Current milestone (1-6)
- Milestone statuses (boolean array)
- Next action required
- Portal access granted boolean

#### `public.list_customer_portfolios(p_customer_id UUID)`
**Returns:** Table of customer's portfolios with strategy, status, NAV

#### `public.get_benchmark_comparison(p_portfolio_id UUID, p_from_date DATE, p_to_date DATE)`
**Returns:** Table with:
- date, lth_pvr_nav, std_dca_nav, lth_pvr_roi, std_dca_roi

#### `public.generate_std_dca_benchmark(p_portfolio_id UUID, p_from_date DATE, p_to_date DATE)`
**Purpose:** Calculate Standard DCA benchmark performance for comparison  
**Start Date:** Customer's first deposit date (from `ledger_lines` earliest deposit event)  
**Logic:**
- Fetch customer's first deposit date
- Fetch total contributions for each month from first deposit to current
- For each month:
  - Calculate daily contribution amount: monthly_total / days_in_month
  - Simulate daily BTC purchases at historical closing prices (from `lth_pvr.ci_bands_daily.btc_price`)
  - Apply exchange fees: 0.1% taker fee (worst case for benchmark)
  - Accumulate BTC balance
- Calculate daily NAV: (btc_balance * btc_price) + usdt_balance
- Calculate ROI: ((current_nav - total_contributions) / total_contributions) * 100
- Calculate CAGR: ((current_nav / total_contributions) ^ (365/days_elapsed) - 1) * 100
**Returns:** Table with columns: date, btc_balance, usdt_balance, nav, total_contributions, roi, cagr

#### `public.calculate_monthly_performance_fee(p_portfolio_id UUID, p_year INT, p_month INT)`
**Purpose:** Calculate BitWealth 10% performance fee for a given month  
**Timing:** Applied on 1st day of new month (monthly close)  
**Logic:**
- Fetch opening NAV (last day of previous month from `balances_daily`)
- Fetch closing NAV (last day of current month from `balances_daily`)
- Fetch total contributions made during month (sum from `ledger_lines` where event_type='deposit')
- Calculate gain: closing_nav - opening_nav - contributions
- If gain > 0: fee = gain * 0.10
- If gain <= 0: fee = 0
- Record fee in `lth_pvr.fees_monthly` table
**Returns:** JSONB with fee_amount, opening_nav, closing_nav, contributions, gain

#### `public.get_fee_analysis(p_portfolio_id UUID, p_from_date DATE, p_to_date DATE)`
**Purpose:** Break down all fees paid (exchange + BitWealth)  
**Logic:**
- Query `lth_pvr.order_fills` for exchange fees (fee_asset IN ('BTC', 'USDT'))
- Sum BTC fees and USDT fees separately
- Query `lth_pvr.fees_monthly` for BitWealth performance fees (ZAR)
- Calculate total fees as % of current NAV
**Returns:** JSONB with:
- exchange_fees_btc (numeric)
- exchange_fees_usdt (numeric)
- bitwealth_fees_zar (numeric)
- fees_as_pct_of_nav (numeric, e.g., 0.98 for 0.98%)

### 4.2 Admin RPCs (extend existing)

#### `public.list_prospects()`
**Returns:** All customers with `status = 'prospect'`

#### `public.list_pending_withdrawals()`
**Returns:** All withdrawal requests with `status = 'pending'`

#### `public.list_open_support_requests()`
**Returns:** All support requests with `status IN ('open', 'in_progress')`

#### `public.update_customer_status(p_customer_id UUID, p_new_status TEXT)`
**Logic:**
- Update `customer_details.status`
- Trigger appropriate email based on status transition
- Return success/error

#### `public.approve_withdrawal(p_request_id UUID, p_notes TEXT)`
**Logic:**
- Update `withdrawal_requests.status = 'approved'`
- Record `approved_at`, `approved_by`
- Send email to customer (template: `withdrawal_approved`)

#### `public.complete_withdrawal(p_request_id UUID)`
**Logic:**
- Update `withdrawal_requests.status = 'completed'`
- Record `completed_at`
- Create ledger entry for withdrawal
- Send email to customer (template: `withdrawal_completed`)

---

## 5. UI Components

### 5.1 Public Pages

#### `website/get-started.html` (NEW)
**Purpose:** Prospect interest form  
**Sections:**
- Hero: "Start Your Bitcoin Investment Journey"
- Form:
  - First Names (required)
  - Surname (required)
  - Email Address (required, validation)
  - Phone Number (required, with country code dropdown)
  - Country (required, dropdown)
  - Upfront Investment Amount Range (required, radio buttons):
    - R0 (no upfront investment)
    - R10,000 - R25,000
    - R25,000 - R50,000
    - R50,000 - R100,000
    - R100,000 - R250,000
    - R250,000+
  - Monthly Investment Amount Range (required, radio buttons):
    - R0 (no monthly contributions)
    - R1,000 - R2,500
    - R2,500 - R5,000
    - R5,000 - R10,000
    - R10,000 - R20,000
    - R20,000+
  - **Validation:** At least one of the two fields must be non-zero
  - Message (optional, textarea)
  - Legal checkboxes:
    - [ ] I accept the Terms of Service
    - [ ] I accept the Privacy Policy
    - [ ] I acknowledge the Investment Disclaimer
  - Submit button: "Get Started"
- Success message: "Thank you! We'll be in touch within 24 hours."
- Links to legal documents (open in modal or new tab)

**JavaScript:**
- Form validation:
  - All required fields filled
  - Valid email format
  - Valid phone number format
  - **Critical:** At least one investment range must be non-zero (upfront OR monthly)
  - All three legal checkboxes checked
- Country code autocomplete (use library like intl-tel-input)
- Call `ef_prospect_submit` edge function
- Show success/error messages

#### `website/portal.html` (MODIFY)
**Purpose:** Customer login page  
**Changes:**
- Add "Customer Login" section
- Supabase Auth sign-in form (email/password)
- Forgot password link
- Link to registration (only accessible via email invite)
- Redirect to `customer-portal.html` after login

### 5.2 Customer Portal Pages

#### `website/customer-portal.html` (NEW)
**Purpose:** Main customer dashboard  
**Layout:** Single-page with anchor navigation
**Sections:**

##### A. Header/Navigation
- Logo
- Customer name (from auth session)
- Navigation tabs:
  - Dashboard
  - Transactions
  - Statements
  - Withdraw Funds
  - Support
  - Settings (later)
- Logout button

##### B. Dashboard Tab (`#dashboard`)
- **Onboarding Status Card** (if not active yet)
  - Visual pipeline: 6 milestones with progress indicators
  - Current status message: "Waiting for funds deposit..."
  - ETA or next action
- **Portfolio Selector** (if multiple portfolios)
  - Dropdown: "LTH PVR - Main Account"
  - Show all portfolios with strategy names
- **Performance Summary Card**
  - Large NAV display: "R 125,432.50"
  - BTC Balance: "0.85432100 BTC"
  - USDT Balance: "5,234.50 USDT"
  - ROI: "+45.2%" (green if positive, red if negative)
  - CAGR: "+32.1%"
  - Total Contributions: "R 90,000"
  - Last Updated: "2025-12-29 03:35 UTC"
- **Performance Chart**
  - Dropdown selector: "NAV" | "ROI %" | "CAGR %" | "Max Drawdown"
  - Line chart comparing LTH PVR (blue) vs Standard DCA (black)
  - Date range selector: "Last 30 days" | "Last 90 days" | "Last 12 months" | "All Time" | "Custom Range"
  - Use Chart.js or similar library
- **Advanced Metrics Card** (collapsible)
  - Time-Weighted Return: "+38.5%"
  - Money-Weighted Return: "+35.2%"
  - Sharpe Ratio: "1.45"
  - Standard Deviation: "18.2%"
  - Asset Allocation Pie Chart: BTC 65% | USDT 35%
  - Monthly Return Heatmap (calendar view, last 12 months)
- **Fee Analysis Card**
  - Exchange Fees (BTC): "0.0045 BTC"
  - Exchange Fees (USDT): "234.50 USDT"
  - BitWealth Performance Fee: "R 344.50"
  - Total Fees as % of NAV: "0.98%"

##### C. Transactions Tab (`#transactions`)
- **Filter Controls**
  - Date range picker (default: last 12 months)
  - Event type filter: All | Trades | Fees | Deposits | Withdrawals
  - Export button: "Download CSV"
- **Transaction Table**
  - Columns: Date | Type | BTC | USDT | Fee | Note
  - Sortable by date
  - Pagination (50 rows per page)
  - Color coding: Green for buys, red for sells, gray for fees

##### D. Statements Tab (`#statements`) ✅ COMPLETE
- **Statement Generator**
  - Year selector (dropdown): Account creation year → current year
  - Month selector (dropdown): Smart filtering (excludes current/future months)
  - "Download PDF" button (replaced "Generate Statement")
  - Spinner during generation (shown only when generating new)
  - Pre-generated check: Downloads from storage instantly if exists
- **Smart Month Logic:**
  - Current year: Shows months from account creation → previous month only
  - Past years: Shows all 12 months (or from account creation if mid-year)
  - Prevents partial month statements (current month excluded)
- **PDF Features (10 enhancements implemented):**
  - Right-aligned currency/percentage/BTC values
  - "Net Asset Value" terminology
  - Fee breakdown: Platform, Performance, Exchange, Total (bold)
  - Benchmark comparison table with colored header
  - Footer with actual filename
  - Logo placeholder (awaiting compressed version)
- **File Naming:** CCYY-MM-DD_LastName_FirstNames_statement_M##_CCYY.pdf
- **Automated Generation:** Monthly cron job generates and emails statements on 1st of month

##### E. Withdraw Funds Tab (`#withdraw`)
- **Current Balance Display**
  - Available USDT: "5,234.50 USDT (~R 108,450)"
  - Available BTC: "0.85432100 BTC (~12,345.67 USDT / ~R 255,600)"
  - Total Available for Withdrawal: "~R 364,050"
  - Note: "Minimum withdrawal: R 1,000"
- **Withdrawal Form**
  - Amount (USDT): Input field
  - Info box: "If you don't have enough USDT, we will sell BTC to cover the shortfall. Exchange fees will apply."
  - Confirmation checkbox: [ ] I understand that BTC may be sold to fulfill this withdrawal if USDT balance is insufficient
  - Banking details (pre-filled from customer profile, editable)
    - Bank Name
    - Account Number
    - Account Holder Name
  - Submit button: "Request Withdrawal" (disabled until checkbox checked)
  - Banking details (pre-filled from customer profile, editable)
    - Bank Name
    - Account Number
    - Account Holder Name
  - Submit button: "Request Withdrawal"
  - Disclaimer: "Funds will be converted to ZAR and transferred within 2 business days."
- **Withdrawal History Table**
  - Columns: Requested Date | Amount (USDT) | Status | Completed Date
  - Status badges: Pending (yellow) | Approved (blue) | Completed (green) | Rejected (red)

##### F. Support Tab (`#support`)
- **Contact Information**
  - Email: support@bitwealth.co.za
  - Hours: Mon-Fri 09:00-17:00 SAST
- **Submit Support Request Form**
  - Subject (dropdown): Account | Trading | Withdrawal | Technical | Other
  - Message (textarea)
  - Submit button
  - Success message: "We'll respond within 24 hours."
- **FAQ Section** (collapsible accordions)
  - Q: How often do trades execute?
  - Q: What are the fees?
  - Q: How do I withdraw funds?
  - Q: How is my performance calculated?
  - Q: What is the LTH PVR strategy?
  - (Add 10-15 common questions)

##### G. Settings Tab (FUTURE - placeholder for MVP)
- Password change
- Email preferences
  - [ ] Monthly performance summary emails
  - [ ] Marketing and promotional emails
  - [ ] Trading notifications (when available)
- Referral link

### 5.3 Admin Portal Changes

#### `website/admin-portal.html` (RENAME from "Advanced BTC DCA Strategy.html")
**New Sections:**

##### Customer Management Module (NEW)
- **Prospects Card**
  - Table: Name | Email | Country | Amount Range | Date | Actions
  - Actions: "Contact" (open email client) | "Approve" (change status to KYC)
- **Onboarding Pipeline Card**
  - Visual pipeline graphic showing all customers in each milestone
  - Click milestone to see customers in that stage
  - Kanban-style board or pipeline visualization
- **KYC Review Card**
  - Customers with `status = 'kyc'` and uploaded documents
  - Preview ID document (inline image/PDF viewer)
  - Actions: "Approve" | "Reject"
- **Pending Setups Card**
  - Customers with `status = 'setup'`
  - Button: "Sync VALR Subaccounts" (calls `ef_valr_list_subaccounts` to fetch from VALR)
  - Two sections after sync:
    - **Matched:** Customers auto-matched by label pattern
    - **Unmatched:** VALR subaccounts with no matching customer OR customers with no subaccount
  - Actions: "Confirm Match" (admin approves auto-match) | "Assign Manually" (dropdown to link customer to subaccount)
  - Input field: Enter deposit_reference from VALR (after confirmation)
  - Note: This process will be automated once `ef_valr_create_subaccount` is implemented
- **Active Customers Table**
  - All customers with `status = 'active'`
  - Quick view: Name | Portfolio | NAV | Last Trade | Actions

##### Withdrawal Management Module (NEW)
- **Pending Withdrawals Card**
  - Table: Customer | Amount (USDT) | Requested Date | Actions
  - Actions: "Approve" | "Reject" | "Complete"
  - Approve: Shows confirmation dialog, sends email
  - Complete: Mark as done after bank transfer, sends email

##### Support Requests Module (NEW)
- **Open Requests Card**
  - Table: Customer | Subject | Date | Priority | Actions
  - Actions: "Reply" (open email client) | "Resolve"
  - Priority color coding

##### Document Management Module (NEW)
- **Upload Documents Card**
  - Customer selector (dropdown)
  - Document type: ID | Signed Disclaimer | Other
  - File upload (drag-drop or browse)
  - Upload button → stores in Supabase Storage

---

## 6. Email Templates

### 6.1 Template Structure

All emails use consistent branding:
- Header: BitWealth logo
- Body: White background, blue accents
- Footer: Contact info, unsubscribe (for marketing emails)

### 6.2 Template Definitions

#### 1. `prospect_notification` (to admin)
**Subject:** New Prospect: {{first_name}} {{surname}}  
**Body:**
```
Hi Davin,

A new prospect has expressed interest in BitWealth:

Name: {{first_name}} {{surname}}
Email: {{email}}
Phone: {{phone_country_code}} {{phone_number}}
Country: {{country}}
Investment Range: {{investment_amount_range}}
Message: {{message}}

View in Admin Portal: {{admin_portal_url}}

- BitWealth System
```

#### 2. `prospect_confirmation` (to prospect)
**Subject:** Thank you for your interest in BitWealth  
**Body:**
```
Hi {{first_name}},

Thank you for expressing interest in our Advanced Bitcoin DCA investment strategy!

We've received your information and will be in touch within 24 hours to discuss your investment goals.

In the meantime, feel free to learn more about our strategy at: {{website_url}}

Best regards,
The BitWealth Team
support@bitwealth.co.za
```

#### 3. `kyc_request` (to customer)
**Subject:** Next Steps: KYC Verification Required  
**Body:**
```
Hi {{first_name}},

Great news! We're ready to proceed with setting up your BitWealth account.

To comply with regulations, we need you to:

1. Reply to this email with a clear copy of your ID (passport or ID card)
2. Complete your account registration and accept the Investment Disclaimer online

Optional: You may download and keep a signed copy of the Investment Disclaimer for your records (attached).

Once we receive your ID and verify your identity, we'll send you a registration link to complete your account setup within 1 business day.

Best regards,
The BitWealth Team
support@bitwealth.co.za
```

#### 4. `kyc_verified_notification` (to admin)
**Subject:** KYC Documents Received: {{customer_name}}  
**Body:**
```
Hi Davin,

{{first_name}} {{surname}} has submitted their KYC documents.

Please verify the ID and update their status in the Admin Portal.

Customer Email: {{email}}
View Documents: {{admin_portal_url}}

- BitWealth System
```

#### 5. `account_setup_complete` (to customer)
**Subject:** Your BitWealth Account is Ready!  
**Body:**
```
Hi {{first_name}},

Your BitWealth account has been set up successfully! 

Next step: Deposit your funds

Bank: {{bank_name}}
Account Number: {{account_number}}
Account Holder: {{account_holder}}
Reference: {{deposit_reference}}

IMPORTANT: Please use the reference code "{{deposit_reference}}" when making your deposit.

Amount: {{investment_amount}} (or your preferred amount)

Once your funds are received, we'll convert them to USDT and your strategy will begin trading within 24 hours.

You can now access your customer portal: {{portal_url}}
Username: {{email}}
Password: (set during registration)

Best regards,
The BitWealth Team
support@bitwealth.co.za
```

#### 6. `funds_deposited_notification` (to admin)
**Subject:** Funds Deposited: {{customer_name}}  
**Body:**
```
Hi Davin,

{{first_name}} {{surname}} has deposited funds into their VALR subaccount.

Amount: R {{amount_zar}}
Customer: {{email}}

Please convert ZAR to USDT and update their status to "active".

View in Admin Portal: {{admin_portal_url}}

- BitWealth System
```

#### 7. `withdrawal_request_notification` (to admin)
**Subject:** Withdrawal Request: {{customer_name}}  
**Body:**
```
Hi Davin,

{{first_name}} {{surname}} has requested a withdrawal.

Amount: {{amount_usdt}} USDT (~R {{amount_zar}})
Customer: {{email}}
Requested: {{requested_at}}

Review in Admin Portal: {{admin_portal_url}}

- BitWealth System
```

#### 8. `withdrawal_approved` (to customer)
**Subject:** Withdrawal Approved  
**Body:**
```
Hi {{first_name}},

Your withdrawal request has been approved!

Amount: {{amount_usdt}} USDT (~R {{amount_zar}})
Processing: Funds will be transferred to your bank account within 2 business days.

Bank: {{bank_name}}
Account: {{account_number}}

You'll receive a confirmation email once the transfer is complete.

Best regards,
The BitWealth Team
support@bitwealth.co.za
```

#### 9. `withdrawal_completed` (to customer)
**Subject:** Withdrawal Complete  
**Body:**
```
Hi {{first_name}},

Your withdrawal has been processed successfully!

Amount: R {{amount_zar}}
Bank: {{bank_name}}
Account: {{account_number}}
Completed: {{completed_at}}

Please allow 1-2 business days for the funds to reflect in your account.

Best regards,
The BitWealth Team
support@bitwealth.co.za
```

#### 10. `support_request_notification` (to admin)
**Subject:** Support Request: {{subject}}  
**Body:**
```
Hi Davin,

{{customer_name}} has submitted a support request.

Subject: {{subject}}
Message: {{message}}
Customer: {{email}}
Submitted: {{created_at}}

Reply to: {{email}}
View in Admin Portal: {{admin_portal_url}}

- BitWealth System
```

#### 11. `support_request_confirmation` (to customer)
**Subject:** Support Request Received  
**Body:**
```
Hi {{first_name}},

We've received your support request and will respond within 24 hours.

Subject: {{subject}}
Reference: {{request_id}}

For urgent matters, please reply to this email.

Best regards,
The BitWealth Team
support@bitwealth.co.za
```

#### 12. `monthly_statement` (to customer)
**Subject:** Your BitWealth Monthly Statement - {{month}} {{year}}  
**Body:**
```
Hi {{first_name}},

Your monthly statement for {{month}} {{year}} is attached.

Performance Summary:
- Opening Balance: R {{opening_nav}}
- Closing Balance: R {{closing_nav}}
- Monthly Return: {{monthly_return}}%
- Total Return: {{total_return}}%

View full details in the attached PDF or log in to your portal: {{portal_url}}

Best regards,
The BitWealth Team
support@bitwealth.co.za
```

---

## 7. Legal Document Templates

### 7.1 Terms of Service (Draft - requires legal review)

```
BITWEALTH TERMS OF SERVICE

Last Updated: 2025-12-29

1. ACCEPTANCE OF TERMS
By accessing and using BitWealth's services, you accept and agree to be bound by these Terms of Service.

2. SERVICES PROVIDED
BitWealth provides cryptocurrency investment management services, specifically automated Bitcoin trading strategies.

3. ELIGIBILITY
You must be 18 years or older and a resident of South Africa to use our services.

4. ACCOUNT REGISTRATION
- Accurate information required
- One account per person
- Responsibility for account security

5. INVESTMENT RISKS
- Cryptocurrency investments carry high risk
- Past performance does not guarantee future results
- You may lose some or all of your investment

6. FEES
- Trading fees as disclosed
- Management fees as per fee schedule
- No hidden charges

7. WITHDRAWALS
- Minimum withdrawal amounts apply
- Processing time: 2-5 business days
- We may sell assets to fulfill withdrawal requests

8. TERMINATION
- You may close your account at any time
- We reserve the right to terminate accounts for violations

9. LIMITATION OF LIABILITY
BitWealth is not liable for losses resulting from market volatility, system failures, or force majeure events.

10. GOVERNING LAW
These terms are governed by South African law.

For questions: support@bitwealth.co.za
```

### 7.2 Privacy Policy (Draft - requires legal review)

```
BITWEALTH PRIVACY POLICY

Last Updated: 2025-12-29

1. INFORMATION WE COLLECT
- Personal information (name, email, phone, address, ID number)
- Financial information (bank details, transaction history)
- Technical data (IP address, browser type, usage patterns)

2. HOW WE USE YOUR INFORMATION
- Provide investment services
- Process transactions
- Comply with legal obligations (FICA, tax reporting)
- Communicate updates and statements
- Improve our services

3. INFORMATION SHARING
We do not sell your personal information. We may share data with:
- VALR (our exchange partner) for trading purposes
- Auditors and legal advisors
- Regulators when required by law

4. DATA SECURITY
We implement industry-standard security measures including encryption, secure servers, and access controls.

5. YOUR RIGHTS (POPI ACT COMPLIANCE)
- Access your personal information
- Request corrections
- Request deletion (subject to legal retention requirements)
- Opt-out of marketing communications

6. DATA RETENTION
We retain your information for 7 years after account closure for legal compliance.

7. COOKIES
We use cookies to improve user experience. You can disable cookies in your browser settings.

8. CONTACT
For privacy inquiries: support@bitwealth.co.za
Data Protection Officer: Davin Gaier
```

### 7.3 Investment Disclaimer (Draft - requires legal review)

```
BITWEALTH INVESTMENT DISCLAIMER

I, ______________________________ (Full Name), ID Number: ________________, 
hereby acknowledge and agree to the following:

1. INVESTMENT RISKS
I understand that cryptocurrency investments are highly volatile and speculative. I may lose some or all of my invested capital.

2. NO GUARANTEES
BitWealth makes no guarantees regarding investment returns. Past performance is not indicative of future results.

3. NOT FINANCIAL ADVICE
BitWealth's services do not constitute financial advice. I am encouraged to seek independent financial advice.

4. AUTOMATED TRADING
I understand that trading is performed by automated systems based on predefined algorithms. I accept the risks of algorithmic trading.

5. WITHDRAWAL CONDITIONS
I understand that:
- If my USDT balance is insufficient for a withdrawal, BitWealth will sell BTC to cover the shortfall
- Withdrawals are processed in ZAR to my designated bank account
- Processing takes 2-5 business days

6. FEES
I acknowledge that fees (exchange and management) will be deducted as per the fee schedule provided.

7. REGULATORY STATUS
I understand that cryptocurrency regulations in South Africa are evolving and may affect my investment.

8. VOLUNTARY PARTICIPATION
My participation is entirely voluntary. I have read and understood the Terms of Service and Privacy Policy.

Signature: _______________________  Date: _______________

Print Name: _______________________

For BitWealth Use:
Approved by: _______________________  Date: _______________
```

---

## 8. Development Roadmap

### Phase 1: MVP Foundation (Jan 2-5, 4 days)

#### Day 1-2: Database & Backend
- [ ] Create database migrations for all new tables
- [ ] Add columns to existing tables
- [ ] Set up RLS policies
- [ ] **CRITICAL:** Review and complete fee calculation tables/functions
  - Verify `lth_pvr.fee_configs` schema
  - Verify `lth_pvr.fee_invoices` schema
  - Verify `lth_pvr.fees_monthly` schema
  - Create/update RPC: `calculate_monthly_performance_fee()`
  - Test fee calculation: 10% of (NAV Gain - Contributions)
- [ ] Create `email_templates` table and insert initial templates
- [x] Create `ef_send_email` edge function (using SMTP)
- [ ] Create `ef_prospect_submit` edge function
- [ ] Create `ef_customer_register` edge function

#### Day 3-4: Customer Portal Core
- [ ] Create `get-started.html` (prospect form)
  - Form validation
  - Country code integration
  - Terms/Privacy modals
- [ ] Modify `portal.html` (login page)
  - Supabase Auth integration
  - Password reset flow
- [ ] Create `customer-portal.html` shell
  - Header/navigation
  - Tab routing (anchor-based)
  - Logout functionality

### Phase 2: Dashboard & Transactions (Jan 6-7, 2 days)

#### Day 5: Dashboard Tab
- [ ] **CRITICAL:** Implement Standard DCA benchmark calculation
  - Create RPC: `generate_std_dca_benchmark(p_portfolio_id, p_from_date, p_to_date)`
  - Logic: Equal daily contributions, same total as customer's actual contributions
  - Store in table or calculate on-demand (decide based on performance)
- [ ] Create RPC: `get_customer_dashboard()`
- [ ] Build Performance Summary Card
- [ ] Build Portfolio Selector (if multiple portfolios)
- [ ] Build basic NAV chart (Chart.js)
- [ ] Date range selector

#### Day 6: Transactions Tab
- [ ] Create RPC: `list_customer_transactions()`
- [ ] Build transaction table with filters
- [ ] Implement CSV export
- [ ] Add pagination

### Phase 3: Admin Integration (Jan 8, 1 day)

#### Day 7: Admin Portal Changes
- [ ] Rename admin file to `admin-portal.html`
- [ ] Add Customer Management module
  - Prospects card
  - Onboarding pipeline graphic (simple version)
  - Status change buttons
- [ ] Add Withdrawal Management module
  - Pending withdrawals table
  - Approve/Reject/Complete actions
- [ ] Add Support Requests module
  - Open requests table
  - Resolve button

### Phase 4: Withdrawals & Support (Jan 9, 1 day)

#### Day 8: Customer Self-Service
- [ ] Create RPC: `list_customer_withdrawal_requests()`
- [ ] Create `ef_withdrawal_request_submit` edge function
- [ ] Build Withdraw Funds tab
  - Balance display
  - Withdrawal form
  - History table
- [ ] Create `ef_support_request_submit` edge function
- [ ] Build Support tab
  - Contact form
  - FAQ accordions (10 questions)

### Phase 5: Testing & Polish (Jan 10, 1 day)

#### Day 9: MVP Finalization
- [ ] End-to-end testing (prospect → customer → withdrawal)
- [ ] Email testing (all templates)
- [ ] Mobile responsiveness check
- [ ] Security audit (RLS policies, auth flows)
- [ ] Documentation: Admin user guide
- [ ] **MVP LAUNCH**

---

### Phase 6: Full Launch Features (Jan 13-17, 5 days)

#### Day 10-11: Automation
- [ ] Create `ef_kyc_request` trigger (on status change)
- [ ] Create `ef_account_setup_complete` trigger
- [ ] Enhance `ef_valr_deposit_scan` for auto-detection
- [ ] Create workflow triggers for all milestone transitions
- [ ] Test automated email flow end-to-end

#### Day 12-13: PDF Statements
- [ ] Create `ef_generate_statement_pdf` edge function
- [ ] Design branded PDF template (logo, charts, tables)
- [ ] Integrate with Statements tab
- [ ] Cache generated PDFs in Supabase Storage
- [ ] Test PDF generation for various months

#### Day 14: Advanced Reporting
- [ ] Create RPCs for advanced metrics:
  - `get_time_weighted_return()`
  - `get_volatility_metrics()`
  - `get_fee_analysis()`
- [ ] Build Advanced Metrics card (collapsible)
- [ ] Build Monthly Return Heatmap (calendar view)
- [ ] Build Asset Allocation Pie Chart
- [ ] Create RPC: `get_benchmark_comparison()`
- [ ] Build comparison chart with metric selector

#### Day 15: Polish & Launch Prep
- [ ] Legal review of Terms/Privacy/Disclaimer (external)
- [ ] Help/FAQ section expansion (20+ questions)
- [ ] Link to external help docs (if available)
- [ ] Email template refinements based on feedback
- [ ] Performance optimization (query tuning, caching)
- [ ] Final security audit
- [ ] **FULL LAUNCH**

---

### Phase 7: Post-Launch (Jan 20-24, 5 days)

#### Day 16-17: VALR Subaccount Automation Implementation
- [ ] Create `ef_valr_create_subaccount` edge function
  - Endpoint: `POST https://api.valr.com/v1/account/subaccount`
  - Request body: `{"label": "Customer Name - LTH PVR"}`
  - Authentication: HMAC SHA512 signature (timestamp + verb + path + body)
  - Headers: X-VALR-API-KEY, X-VALR-SIGNATURE, X-VALR-TIMESTAMP
  - Rate limit: Max 1 request per second (add delay if batching)
- [ ] Test in VALR environment (production - no sandbox available)
- [ ] Parse response to extract subaccount_id
- [ ] Update `public.exchange_accounts` with subaccount_id
- [ ] Integrate with Milestone 4 workflow (status change trigger)
- [ ] Add error handling for duplicate labels, API failures
- [ ] Log to alert system if subaccount creation fails
- [ ] Document: Deposit reference still requires manual entry from VALR web UI

#### Day 18: Onboarding Pipeline Enhancements
- [ ] Build advanced pipeline visualization (Kanban board)
- [ ] Add drag-drop functionality (nice-to-have)
- [ ] Add customer notes/comments feature
- [ ] Add milestone timestamps and audit trail

#### Day 19: Multi-Strategy Support
- [ ] Update UI to handle multiple strategies per customer
- [ ] Add strategy selector dropdown on dashboard
- [ ] Test with mock ADV_DCA strategy data
- [ ] Update RPC functions to filter by strategy_code

#### Day 20: Monitoring & Analytics
- [ ] Admin dashboard: Customer acquisition metrics
- [ ] Admin dashboard: AUM (Assets Under Management) tracker
- [ ] Admin dashboard: Withdrawal volume tracking
- [ ] Create alert for failed emails (integrate with existing alert system)
- [ ] Create cron job for monthly statement generation (automated)

---

## 9. Testing Plan

### 9.1 Unit Testing

**Database Functions:**
- Test all new RPCs with sample data
- Verify RLS policies (customers can only see own data)
- Test edge cases (empty results, NULL values)

**Edge Functions:**
- Test SMTP connection (use mail.bitwealth.co.za:587)
- Test email template variable replacement
- Test authentication (JWT validation)
- Test error handling (invalid inputs, missing data)

### 9.2 Integration Testing

**Onboarding Flow:**
1. Prospect submits form → verify row in `customer_details`, email sent
2. Admin changes status to 'KYC' → verify email sent to customer
3. Customer uploads docs (manual) → verify storage URL saved
4. Admin verifies ID → verify status change, email sent
5. Customer registers → verify Supabase Auth account created
6. Deposit detected → verify status change, email sent

**Withdrawal Flow:**
1. Customer submits withdrawal request → verify row inserted, email sent to admin
2. Admin approves → verify status change, email sent to customer
3. Admin completes → verify ledger entry, email sent to customer

**Support Flow:**
1. Customer submits support request → verify row inserted, emails sent
2. Admin resolves → verify status change

### 9.3 UI Testing

**Browser Compatibility:**
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

**Responsive Design:**
- Desktop (1920x1080, 1366x768)
- Tablet (iPad, 768x1024)
- Mobile (iPhone, 375x812)

**Accessibility:**
- Keyboard navigation
- Screen reader compatibility (ARIA labels)
- Color contrast ratios (WCAG AA)

### 9.4 Security Testing

**Authentication:**
- Test unauthorized access to customer portal (redirect to login)
- Test RLS policies (customer A cannot see customer B's data)
- Test session timeout/expiration

**Input Validation:**
- SQL injection prevention
- XSS prevention (sanitize user inputs)
- Email validation (reject invalid formats)

**API Security:**
- Test edge functions with missing/invalid JWT
- Test rate limiting (prevent abuse)
- Test CORS configuration

### 9.5 Performance Testing

**Load Testing:**
- Simulate 100 concurrent users accessing dashboard
- Test database query performance (add indexes if needed)
- Test PDF generation under load

**Stress Testing:**
- Test with large datasets (10,000 transactions)
- Test chart rendering with 12+ months of daily data

---

## 10. Deployment Checklist

### 10.1 Pre-MVP Deployment (Jan 10)

#### Website Hosting (CRITICAL - NEW)
**Current Issue:** Website files (register.html, upload-kyc.html, portal.html, index.html) are local-only.  
**Impact:** Registration/KYC URLs in emails point to localhost (broken for customers).  
**Solution:** Deploy website folder to production hosting service.

**Hosting Options (Priority Order):**
1. **Cloudflare Pages** (RECOMMENDED)
   - Free tier sufficient for MVP
   - Automatic HTTPS
   - CDN included
   - Deploy: `npx wrangler pages deploy website`
   - Custom domain: bitwealth.co.za
   - Est. setup time: 30 minutes

2. **Netlify**
   - Free tier with 100GB bandwidth/month
   - Automatic HTTPS
   - Deploy: Drag-drop website folder or Git integration
   - Custom domain support
   - Est. setup time: 20 minutes

3. **Vercel**
   - Free tier for static sites
   - Automatic HTTPS
   - Deploy: `vercel --prod`
   - Est. setup time: 25 minutes

**Deployment Steps:**
```bash
# Option 1: Cloudflare Pages
cd website
npx wrangler pages deploy . --project-name bitwealth-portal

# Option 2: Netlify (via CLI)
cd website
npm install -g netlify-cli
netlify deploy --prod --dir .

# Option 3: Vercel (via CLI)
cd website
npm install -g vercel
vercel --prod
```

**Post-Deployment:**
- [ ] Update WEBSITE_URL environment variable in Supabase (all edge functions)
- [ ] Test registration URL: https://bitwealth.co.za/register.html?customer_id=X&email=test@example.com
- [ ] Test upload page: https://bitwealth.co.za/upload-kyc.html
- [ ] Test customer portal: https://bitwealth.co.za/portal.html
- [ ] Update email templates with production URL (if hardcoded anywhere)
- [ ] Remove localhost fallback from ef_confirm_strategy, ef_upload_kyc_id

**Affected Edge Functions:**
- ef_confirm_strategy (registration_url)
- ef_upload_kyc_id (redirect after upload)
- ef_prospect_submit (website_url in emails)
- Any email templates with {{website_url}} or {{portal_url}}

#### Database
- [ ] Run all migrations in production
- [ ] Verify table structures
- [ ] Verify RLS policies enabled
- [ ] Insert initial email templates
- [ ] Create test customer account

#### Edge Functions
- [ ] Deploy `ef_send_email`
- [ ] Deploy `ef_prospect_submit`
- [ ] Deploy `ef_customer_register`
- [ ] Deploy `ef_withdrawal_request_submit`
- [ ] Deploy `ef_support_request_submit`
- [ ] Verify all functions have correct JWT settings

#### Environment Variables
- [x] Set SMTP credentials in Supabase project secrets (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE)
- [ ] Set `ADMIN_EMAIL` (davin.gaier@gmail.com)
- [ ] Set `PORTAL_URL` (customer portal URL)
- [ ] Set `ADMIN_PORTAL_URL` (admin portal URL)

#### Storage
- [ ] Create bucket: `kyc-documents` (private)
- [ ] Create bucket: `customer-statements` (private, customer RLS)
- [ ] Set up bucket policies (customers access own files only)

#### UI Files
- [ ] Upload `get-started.html` to website
- [ ] Update `portal.html` with customer login
- [ ] Upload `customer-portal.html`
- [ ] Rename admin UI to `admin-portal.html`
- [ ] Update CSS with BitWealth branding (Aptos font, blue/gold theme)
- [ ] Add BitWealth logo to all pages

#### Testing
- [ ] Test prospect form submission
- [ ] Test customer registration and login
- [ ] Test dashboard data loading
- [ ] Test withdrawal request submission
- [ ] Test support request submission
- [ ] Test all email sends (to admin and customers)

### 10.2 Pre-Full Launch Deployment (Jan 24)

#### Edge Functions
- [ ] Deploy `ef_kyc_request`
- [ ] Deploy `ef_generate_statement_pdf`
- [ ] Deploy automation triggers for milestones

#### UI
- [ ] Add advanced metrics to dashboard
- [ ] Add benchmark comparison chart
- [ ] Add monthly statement generator
- [ ] Update FAQ with 20+ questions

#### Legal
- [ ] Replace placeholder Terms/Privacy with vetted versions
- [ ] Add signed disclaimer upload flow

#### Monitoring
- [ ] Set up alert for failed emails
- [ ] Set up admin notification for new prospects
- [ ] Test monthly statement cron job

---

## 11. Maintenance & Support

### 11.1 Daily Monitoring

**Admin Tasks:**
- Check for new prospects (email notifications)
- Review pending withdrawals
- Respond to support requests
- Verify KYC documents

**System Health:**
- Monitor edge function logs (via Supabase dashboard)
- Check email delivery status (`email_logs` table)
- Review alert system for customer portal errors

### 11.2 Weekly Tasks

- Review customer onboarding pipeline
- Analyze withdrawal patterns
- Update FAQ based on support requests
- Performance review (page load times, query speeds)

### 11.3 Monthly Tasks

- Generate and send monthly statements (automated after full launch)
- Review Terms/Privacy for updates
- Backup customer documents
- Security audit (check for suspicious login attempts)

---

## 12. Success Metrics

### 12.1 MVP Success Criteria (Jan 10)

- [ ] Public interest form functional (5+ test submissions)
- [ ] Customer registration and login working
- [ ] Dashboard displays correct data for 3+ test customers
- [ ] Withdrawal request submission functional
- [ ] Support request submission functional
- [ ] All 12 email templates tested and delivered
- [ ] Mobile responsive (tested on 2+ devices)
- [ ] Zero security vulnerabilities identified

### 12.2 Full Launch Success Criteria (Jan 24)

- [ ] Automated milestone transitions (90%+ success rate)
- [ ] PDF statement generation (<10 seconds per statement)
- [ ] Advanced metrics calculated correctly
- [ ] Legal documents vetted and approved
- [ ] FAQ covers 90% of expected customer questions
- [ ] Email delivery rate >95%
- [ ] Customer satisfaction (survey after first month)

### 12.3 Post-Launch KPIs (ongoing)

- **Customer Acquisition:**
  - Prospect conversion rate (prospect → active)
  - Onboarding completion time (days from prospect to active)
  
- **Engagement:**
  - Monthly active users (logged into portal)
  - Average dashboard views per customer per month
  - Statement downloads per customer
  
- **Support:**
  - Support request volume
  - Average resolution time
  - Customer satisfaction score
  
- **Financial:**
  - Assets Under Management (AUM) growth
  - Average withdrawal request time (approval → completion)
  - Fee collection accuracy

---

## 13. Risk Mitigation

### 13.1 Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Supabase Storage failure | High | Implement backup to AWS S3; store documents locally |
| SMTP server downtime | Medium | Queue failed emails for retry; monitor email_logs for failures |
| Database migration failure | High | Test migrations in staging; keep rollback scripts ready |
| Chart rendering performance issues | Low | Implement data pagination; use chart caching |

### 13.2 Security Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Unauthorized customer data access | Critical | Strict RLS policies; regular security audits |
| Phishing attacks (fake portal) | High | Use HTTPS only; educate customers; implement 2FA (post-MVP) |
| SQL injection | Critical | Use parameterized queries; validate all inputs |
| KYC document leaks | Critical | Private storage buckets; audit access logs |

### 13.3 Operational Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| VALR API changes breaking deposit detection | High | Monitor VALR API changelog; maintain sandbox tests |
| Email deliverability issues (spam filters) | Medium | Use SPF/DKIM/DMARC; monitor bounce rates |
| Legal compliance (POPI Act) | Critical | Legal review of documents; implement data retention policies |
| Customer support overload | Medium | Comprehensive FAQ; automated responses; hire support staff (future) |

### 13.4 Business Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Low prospect conversion | Medium | A/B test interest form; improve onboarding UX |
| High withdrawal rate | Medium | Analyze reasons; improve performance reporting |
| Negative customer feedback | High | Regular surveys; quick issue resolution |

---

## 14. Appendices

### 14.1 Color Palette (BitWealth Branding)

Based on attached logo/screenshot:

```css
:root {
  /* Primary Colors */
  --bw-navy: #2C3E50;        /* Dark blue - headers, text */
  --bw-gold: #F39C12;        /* Gold - accents, charts */
  --bw-white: #FFFFFF;       /* White - backgrounds */
  
  /* Secondary Colors */
  --bw-light-blue: #3498DB; /* Light blue - links, buttons */
  --bw-gray: #95A5A6;       /* Gray - secondary text */
  
  /* Status Colors */
  --bw-green: #27AE60;      /* Success, positive returns */
  --bw-red: #E74C3C;        /* Error, negative returns */
  --bw-yellow: #F1C40F;     /* Warning, pending status */
  
  /* Chart Colors */
  --bw-chart-lth: #3498DB;  /* LTH PVR line (blue) */
  --bw-chart-dca: #2C3E50;  /* Standard DCA line (black/navy for contrast) */
}
```

### 14.2 Typography

```css
@import url('https://fonts.googleapis.com/css2?family=Aptos&display=swap');

body {
  font-family: 'Aptos', 'Segoe UI', Tahoma, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: var(--bw-navy);
}

h1 { font-size: 2.5rem; font-weight: 700; }
h2 { font-size: 2rem; font-weight: 600; }
h3 { font-size: 1.5rem; font-weight: 600; }
h4 { font-size: 1.25rem; font-weight: 500; }
```

### 14.3 Recommended JavaScript Libraries

- **Chart.js** (v4.x) - Charts and graphs
- **intl-tel-input** - Phone number with country codes
- **jsPDF** + **jspdf-autotable** - PDF generation
- **date-fns** - Date formatting/manipulation
- **DOMPurify** - XSS prevention (sanitize user inputs)

### 14.4 Supabase Configuration

**Authentication Settings:**
- Email confirmation required: Yes
- Password requirements: Min 8 chars, 1 number, 1 special, 1 uppercase
- Session timeout: 7 days
- Redirect URLs: `https://bitwealth.co.za/customer-portal.html`

**Storage Settings:**
- Max file size: 10 MB (KYC documents)
- Allowed types: PDF, JPG, PNG
- Auto-delete after: Never (legal retention requirement)

**Edge Function Settings:**
- Timeout: 60 seconds (for PDF generation)
- Memory: 512 MB
- JWT verification: Enabled (except `ef_prospect_submit`, `ef_send_email`)

### 14.5 FAQ Content (Initial 10 Questions)

1. **How often do trades execute?**  
   The LTH PVR strategy trades daily at 03:05 UTC (05:05 SAST) based on market conditions.

2. **What are the fees?**  
   Exchange fees (VALR): 0.08% maker / 0.1% taker for BTCUSDT trades, 0.18% for USDT/ZAR conversions. BitWealth performance fee: 10% of monthly NAV gains (after deducting contributions made that month).

3. **How do I withdraw funds?**  
   Navigate to "Withdraw Funds" tab, enter amount, and submit request. Funds will be in your bank account within 2-5 business days.

4. **What happens if I withdraw during BTC holdings?**  
   We will sell the necessary BTC to fulfill your USDT withdrawal request, then convert to ZAR.

5. **How is my performance calculated?**  
   ROI = (Current NAV - Total Contributions) / Total Contributions × 100. CAGR accounts for time-weighted returns.

6. **What is the LTH PVR strategy?**  
   Long-Term Holder Price Variance Ratio strategy uses on-chain data to determine optimal Bitcoin buy/sell timing.

7. **Can I pause my strategy?**  
   Contact support to temporarily pause trading. Your funds remain in your account.

8. **What is Standard DCA comparison?**  
   Standard DCA (Dollar-Cost Averaging) invests a fixed amount daily. We compare LTH PVR performance against this benchmark.

9. **Are my funds safe?**  
   Funds are held in your dedicated VALR subaccount. BitWealth never has custody of your assets.

10. **How do I update my banking details?**  
    Contact support with updated details. We'll verify and update your profile.

---

## 15. Additional Recommendations

### 15.1 Quick Wins (Post-MVP)

1. **Email Preferences:** Let customers opt-in/out of monthly statements
2. **Portfolio Nicknames:** Allow customers to name their portfolios ("My Retirement Fund")
3. **Notifications Badge:** Show unread support replies in portal header
4. **Dark Mode:** Toggle for dashboard (customer preference)
5. **Export All Data:** Single button to download all transactions + statements

### 15.2 Future Enhancements (Q1 2026)

1. **Interactive Back-Tester on Prospect Form:** Embed the existing back-tester on get-started.html so prospects can input their contribution amounts and see projected returns before signing up
2. **Referral Program:** Generate unique referral links, track referrals, apply fee discounts
3. **Mobile App:** React Native app with push notifications
4. **Auto-Invest:** Link bank account, auto-debit monthly contributions
5. **Tax Center:** Generate capital gains reports for SARS
6. **Multi-Currency:** Support USD, EUR portfolios (not just ZAR)
7. **Portfolio Comparison:** Side-by-side comparison of multiple portfolios
8. **Social Proof:** Anonymous leaderboard showing top-performing portfolios
9. **Educational Content:** Blog posts, videos explaining strategy

### 15.3 Technical Debt to Address

1. **Supabase Storage Cleanup:** Implement lifecycle policies (delete abandoned uploads)
2. **Database Indexing:** Add indexes based on actual query patterns (post-launch analysis)
3. **API Rate Limiting:** Implement rate limiting on edge functions (prevent abuse)

---

## 16. Conclusion

This build plan transforms the LTH_PVR solution from an admin-only system into a **production-ready customer lifecycle platform**. The phased approach ensures:

- **MVP (Jan 10):** Core functionality operational with manual workflows
- **Full Launch (Jan 24):** Automation, advanced features, legal compliance
- **Post-Launch:** Continuous improvement and scaling

**Critical Success Factors:**
1. Rigorous testing of authentication and data security (RLS policies)
2. Email deliverability monitoring (SMTP delivery status tracking)
3. Mobile-responsive UI (desktop-first but mobile-compatible)
4. Legal document review before full launch
5. Admin training on new customer management workflows

**Next Steps:**
1. Review and approve this build plan
2. Set up development environment (staging Supabase project)
3. Begin Phase 1 development (Jan 2)
4. Daily standups to track progress
5. MVP demo/review on Jan 9 (pre-launch)

---

## 17. VALR Subaccount API Research Findings

### 17.1 API Endpoint Details

**Create Subaccount:**
- **Endpoint:** `POST /v1/account/subaccount`
- **Base URL:** `https://api.valr.com`
- **Rate Limit:** 1 request per second
- **Authentication:** Primary account API key with HMAC SHA512 signing

**Request Format:**
```typescript
// Headers
{
  "X-VALR-API-KEY": "your-primary-api-key",
  "X-VALR-SIGNATURE": "hmac-sha512-signature",
  "X-VALR-TIMESTAMP": "1734567890123",  // Unix timestamp in milliseconds
  "Content-Type": "application/json"
}

// Body
{
  "label": "John Doe - LTH PVR"  // Customer name + strategy
}
```

**Response Format (Expected):**
```json
{
  "id": "abc123def456",  // Subaccount ID
  "label": "John Doe - LTH PVR",
  "createdAt": "2025-12-29T10:30:00Z"
}
```

**HMAC Signature Generation:**
```typescript
// Concatenate: timestamp + verb + path + body
const payload = `${timestamp}POST/v1/account/subaccount${JSON.stringify(body)}`;
const signature = crypto.createHmac('sha512', apiSecret)
  .update(payload)
  .digest('hex');
```

### 17.2 Implementation Plan

**Edge Function: `ef_valr_create_subaccount`**

**Purpose:** Automate subaccount creation for new customers

**Trigger:** Admin clicks "Create VALR Subaccount" in Milestone 4

**Parameters:**
- `customer_id` (UUID)
- `strategy_code` (string, e.g., 'LTH_PVR')

**Logic:**
1. Fetch customer details (name, surname)
2. Generate label: `{first_names} {surname} - {strategy_code}`
3. Check if subaccount already exists for this customer/strategy
4. Call VALR API with signed request
5. Parse response to extract subaccount_id
6. Insert row into `public.exchange_accounts`:
   - org_id (from customer)
   - exchange: 'VALR'
   - label: (same as VALR label)
   - subaccount_id: (from API response)
   - notes: "Auto-created on {date}"
7. Link to `public.customer_portfolios`:
   - Update or insert row with exchange_account_id
8. Log success to `lth_pvr.alert_events` (info level)
9. Return subaccount details to admin UI

**Error Handling:**
- Duplicate label → Append timestamp to label, retry
- Rate limit exceeded → Queue request for retry after 1 second
- API failure → Log to alert system, notify admin via email
- Invalid API key → Critical alert, halt onboarding

**Environment Variables Required:**
- `VALR_PRIMARY_API_KEY` - Primary account API key
- `VALR_PRIMARY_API_SECRET` - Primary account API secret

### 17.3 Retrieve Subaccounts API

**Endpoint:** `GET /v1/account/subaccounts` (mentioned in docs)

**Purpose:** 
- Verify subaccount creation
- List all subaccounts for audit
- Check for existing subaccounts before creation

**Admin RPC Function:**
```sql
CREATE OR REPLACE FUNCTION public.list_valr_subaccounts()
RETURNS TABLE (
  exchange_account_id UUID,
  label TEXT,
  subaccount_id TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT ea.exchange_account_id, ea.label, ea.subaccount_id, ea.created_at
  FROM public.exchange_accounts ea
  WHERE ea.exchange = 'VALR' AND ea.subaccount_id IS NOT NULL
  ORDER BY ea.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 17.4 Deposit Reference Limitation

**Important:** VALR does not provide an API endpoint to retrieve the deposit reference code programmatically.

**Workaround:**
1. Subaccount created via API
2. Admin manually logs into VALR web interface
3. Admin navigates to subaccount details
4. Admin copies deposit reference from UI
5. Admin pastes into BitWealth Admin Portal (`deposit_reference` field)
6. System sends email to customer with banking details and reference

**Future Enhancement Request:** Contact VALR support to add deposit reference to API response.

### 17.5 Subaccount Impersonation

**X-VALR-SUB-ACCOUNT-ID Header:**
- Used to "impersonate" subaccount for trading operations
- Primary account API key can transact on behalf of subaccount
- Must be included in HMAC signature: `timestamp + verb + path + body + subaccount_id`

**Example:**
```typescript
// Trading on subaccount
const subaccountId = 'abc123def456';
const payload = `${timestamp}POST/v1/orders/market${JSON.stringify(orderBody)}${subaccountId}`;
const signature = crypto.createHmac('sha512', apiSecret).update(payload).digest('hex');

// Headers
{
  "X-VALR-API-KEY": "primary-api-key",
  "X-VALR-SIGNATURE": signature,
  "X-VALR-TIMESTAMP": timestamp,
  "X-VALR-SUB-ACCOUNT-ID": subaccountId  // Impersonate subaccount
}
```

**Already Implemented:** Existing `valrClient` helper in TypeScript handles this correctly.

### 17.6 Testing Strategy

**Pre-Production Testing:**
- VALR does not provide a sandbox/test environment
- Testing must be done in production with caution
- Recommendation: Create 2-3 test subaccounts manually to verify integration

**Test Cases:**
1. Create subaccount with unique label → Verify response, database update
2. Create subaccount with duplicate label → Verify error handling, retry logic
3. Rate limit test → Create 2 subaccounts within 1 second → Verify delay/retry
4. Invalid API key → Verify error logging and admin notification
5. Network timeout → Verify retry mechanism
6. Verify impersonation → Place test order on created subaccount

### 17.7 Security Considerations

**API Key Permissions:**
- Primary API key must have "View" and "Trade" permissions
- Do NOT grant "Withdraw" permission (security risk)
- Store API key/secret in Supabase project secrets (not in code)

**RLS Policies:**
- Only admins can call `ef_valr_create_subaccount`
- Customers cannot see other customers' subaccount_id values
- Audit log all subaccount creation events

**Monitoring:**
- Alert if subaccount creation fails >2 times in 24 hours
- Weekly audit: Compare VALR subaccounts (API list) vs database records
- Monthly review: Verify all active customers have subaccounts

---

## 18. Revised Timeline with VALR Integration

### Phase 7: Post-Launch (Updated)

#### Day 16-17: VALR Subaccount Automation Implementation
- [ ] Create `ef_valr_create_subaccount` edge function
- [ ] Add HMAC SHA512 signing logic (reuse existing valrClient if possible)
- [ ] Test in production with 2 test subaccounts
- [ ] Handle rate limiting (1/s max)
- [ ] Integrate with Admin UI Milestone 4 workflow
- [ ] Add "Create VALR Subaccount" button (calls edge function)
- [ ] Display subaccount_id in Admin UI after creation
- [ ] Add manual `deposit_reference` input field
- [ ] Document manual deposit reference retrieval process

#### Day 18: Testing & Validation
- [ ] End-to-end test: Prospect → KYC → Setup (auto subaccount) → Deposit
- [ ] Verify subaccount shows in VALR web interface
- [ ] Test deposit detection with real ZAR deposit (small amount)
- [ ] Verify deposit reference matching logic in `ef_valr_deposit_scan`

#### Day 19: Balance Reconciliation System ✅ COMPLETE (2026-01-05)
- [x] Researched VALR webhook support (NONE AVAILABLE - must use polling)
- [x] Created `ef_balance_reconciliation` edge function
  - Queries VALR API for all active customer balances
  - Compares with `lth_pvr.balances_daily` (tolerance: BTC ±1 satoshi, USDT ±1 cent)
  - Auto-creates funding events for discrepancies
  - Updates balances_daily to match VALR reality
- [x] Added pg_cron job (hourly at :30, Job #32)
- [x] Deployed and tested (3 customers scanned, zero discrepancies)
- [x] Created `docs/Balance_Reconciliation_System.md` documentation
- [x] Updated SDD v0.6.9, test case documents

**Rationale:** VALR API docs have no webhook endpoints for deposits/withdrawals. WebSocket API only covers trading data (market quotes, order updates), not bank transfers. Hourly polling acceptable for production (max 60-minute lag for manual transfers).

---

## 19. Post-Launch Enhancement Backlog

### 19.1 Balance Reconciliation Enhancements (Low Priority) ✅ CORE COMPLETE

**Core Feature:** Automated balance reconciliation via hourly VALR API polling ✅ COMPLETE (v0.6.9)

**Future Enhancements:**
- Historical reconciliation (check past balances for drift)
- Large discrepancy alerts (>$100 USD) integrate with `lth_pvr.raise_alert()`
- Daily reconciliation report email (summary of all discrepancies found)
- Balance drift dashboard (track cumulative discrepancies per customer over time)
- VALR webhook migration (if/when VALR adds webhook support for deposits/withdrawals)

### 19.2 KYC Document URL Regeneration (Medium Priority)

**Problem:**
- Signed URLs for KYC documents expire after 1 year (31,536,000 seconds)
- After expiry, admin cannot view documents without regenerating URLs
- Compliance requires long-term document retention (5-7 years)

**Solution:**
- Implement automated URL regeneration before expiry
- Create pg_cron job to run monthly: `kyc_url_refresh_monthly`
- Edge function: `ef_regenerate_kyc_urls` (--no-verify-jwt)
- Query all customers with `kyc_id_document_url` expiring within 60 days
- Generate new signed URLs (1 year expiration)
- Update `customer_details.kyc_id_document_url` with fresh URLs
- Log regenerations to audit table

**Implementation Estimate:** 4-6 hours
- Edge function: 2 hours
- pg_cron setup: 30 minutes
- Testing: 2 hours
- Documentation: 1 hour

**Dependencies:**
- None (can be implemented anytime post-launch)

**SQL Pattern:**
```sql
-- Pseudo-code for detection
SELECT customer_id, kyc_id_document_url
FROM customer_details
WHERE kyc_id_document_url IS NOT NULL
  AND kyc_id_document_url LIKE '%token=%'
  AND EXTRACT(EPOCH FROM (
    -- Parse expiry from JWT token in URL
    -- Compare to current timestamp
  )) < (EXTRACT(EPOCH FROM NOW()) + 5184000); -- 60 days
```

**Alternative Approach:**
- Store `kyc_id_document_url_expires_at` TIMESTAMPTZ column
- Set during upload: `NOW() + INTERVAL '1 year'`
- Simplifies detection query (no JWT parsing needed)

**Priority:** Post-launch enhancement (not blocking MVP)

**Status:** Deferred to post-launch backlog (2026-01-01)

### 19.2 Customer Reactivation UI Button

**Problem:** Admin must use SQL to reactivate inactive customers

**Solution:** Add "Reactivate" button to Active Customers card

**Estimate:** 2 hours

### 19.3 Automated Email Retry Mechanism

**Problem:** No retry if email sending fails

**Solution:** Dead-letter queue + retry logic in ef_send_email

**Estimate:** 4 hours

### 19.4 Audit Trail for Status Changes

**Problem:** No log of who changed customer status when

**Solution:** Create `customer_status_history` table with triggers

**Estimate:** 3 hours

### 19.5 Multi-Currency Support in Deposit Scan

**Problem:** Currently only checks ZAR, BTC, USDT

**Solution:** Make currency list configurable, support all VALR currencies

**Estimate:** 2 hours

---

**Document Version:** 1.0  
**Status:** Draft for Review  
**Approval Required:** Davin Gaier  
**Questions/Feedback:** Contact davin.gaier@gmail.com

---

**End of Customer Portal Build Plan**

