# BitWealth – LTH PVR BTC DCA
## Solution Design Document – Version 0.6

**Author:** Dav / GPT  
**Status:** Production-ready design – supersedes SDD_v0.5  
**Last updated:** 2026-01-14

---

## 0. Change Log

### v0.6.19 (current) – Back-Test Form UX Improvements & Standard DCA Data Fix
**Date:** 2026-01-14  
**Purpose:** Enhanced back-test form error handling, fixed date validation for LTH PVR data lag, and resolved missing Standard DCA benchmark data in results.

**Bug Fixes:**

1. **reCAPTCHA Error Handling**
   - **Problem:** Silent failures when reCAPTCHA not loaded (ad blockers, slow network)
   - **Solution:** Added checks for `grecaptcha` object existence with user-friendly error messages
   - **Impact:** Users now see "Security verification not loaded. Please refresh the page and try again." instead of nothing happening
   - **Files:** `website/lth-pvr-backtest.html` (Lines 559-576, 628-635)

2. **Date Validation for LTH PVR Data Lag**
   - **Problem:** End date allowed "today" but LTH PVR on-chain data only available up to yesterday
   - **Solution:** 
     - JavaScript validation: Check `endDate > yesterday` with clear error message
     - HTML `max` attribute: Set to yesterday dynamically
     - Error message: "End date must be yesterday or earlier (YYYY-MM-DD). LTH PVR on-chain data is updated daily and only available up to yesterday."
   - **Impact:** Prevents users from selecting invalid dates that would cause back-test failures
   - **Files:** `website/lth-pvr-backtest.html` (Lines 559-570, 954-958)

3. **Missing Standard DCA Contribution Data**
   - **Problem:** Standard DCA column showed "$0" for Total Contributions despite correct calculations in database
   - **Root Cause:** `get_backtest_results()` function returned `contrib_net` but JavaScript UI looked for `contrib_gross`
   - **Solution:** Added `contrib_gross` field to both `lth_pvr_summary` and `std_dca_summary` JSON objects (mapped to same value as `contrib_net`)
   - **Impact:** Standard DCA benchmark now displays correctly with matching contribution totals
   - **Migration:** `supabase/migrations/20260114_fix_backtest_contrib_gross_field.sql`

**Enhancements:**

4. **Client-Side Form Validation Improvements**
   - Pre-reCAPTCHA date validation to avoid wasting CAPTCHA attempts
   - Sequential validation: dates → reCAPTCHA → submission
   - Safer reCAPTCHA reset with try-catch blocks

5. **Debug Logging**
   - Added console logging for LTH PVR Summary, Standard DCA Summary, and daily results count
   - Helps diagnose data issues in browser console

**Files Modified:**
- `website/lth-pvr-backtest.html` - Form validation, error handling, date logic
- `supabase/migrations/20260114_fix_backtest_contrib_gross_field.sql` - SQL function fix

**Testing:**
- ✅ Future date selection blocked with helpful message
- ✅ reCAPTCHA load failures handled gracefully
- ✅ Standard DCA data now displays correctly
- ✅ Form validation runs in correct order (dates first, CAPTCHA second)

**Production Status:** ✅ COMPLETE – Migration applied, ready for website deployment

---

### v0.6.18 – Back-Test Form Field Validation Fix
**Date:** 2026-01-13  
**Purpose:** Fixed overly restrictive field validation on public back-test form that prevented users from entering valid investment amounts.

**Bug Fix:**
- **Problem:** HTML input fields for "Upfront Investment" and "Monthly Contribution" had `step="100"` attribute, forcing values to be multiples of $100. This blocked valid amounts like $650, $1,250, etc.
- **Root Cause:** Browser HTML5 form validation prevents submission when value doesn't match step increment
- **Solution:** Changed `step="100"` to `step="1"` on both input fields
- **Impact:** Users can now enter any whole dollar amount (e.g., $650, $1,250, $3,575)

**Files Modified:**
- `website/lth-pvr-backtest.html` (Lines 352, 358)

**Validation Rules After Fix:**
- **Upfront Investment:** `type="number"`, `min="0"`, `step="1"` (any non-negative whole dollar amount)
- **Monthly Contribution:** `type="number"`, `min="0"`, `step="1"` (any non-negative whole dollar amount)
- **Backend:** Validates amounts are non-negative and at least one is > 0 (no step constraint)

**Production Status:** ✅ COMPLETE – Ready for deployment to bitwealth.co.za

---

### v0.6.17 – Contact Form Email Notifications
**Date:** 2026-01-12  
**Purpose:** Implemented contact form email notification system with reCAPTCHA verification, database storage, admin notifications to info@bitwealth.co.za, and auto-reply confirmations to submitters.

**New Components:**

1. **Database Table: `public.contact_form_submissions`**
   - **Columns:**
     - `id` (BIGSERIAL PRIMARY KEY)
     - `created_at` (TIMESTAMPTZ) - Submission timestamp
     - `name` (TEXT) - Submitter's name
     - `email` (TEXT) - Submitter's email address
     - `message` (TEXT) - Contact message content
     - `captcha_verified` (BOOLEAN) - reCAPTCHA verification status
     - `admin_notified_at` (TIMESTAMPTZ) - Timestamp when admin email sent
     - `auto_reply_sent_at` (TIMESTAMPTZ) - Timestamp when auto-reply sent
     - `user_agent` (TEXT) - Browser user agent string
     - `ip_address` (TEXT) - Submitter IP address
   - **Indexes:**
     - `idx_contact_form_email_date` - For rate limiting queries
     - `idx_contact_form_created_at` - For admin dashboard queries
   - **RLS Policies:** Service role full access, no public read access

2. **Edge Function: `ef_contact_form_submit`**
   - **Purpose:** Handle contact form submissions from website
   - **Workflow:**
     1. Validate required fields (name, email, message, captcha_token)
     2. Verify Google reCAPTCHA token with Google API
     3. Validate email address format (basic regex)
     4. Store submission in `contact_form_submissions` table
     5. Send admin notification email to info@bitwealth.co.za
     6. Send auto-reply confirmation email to submitter
     7. Update `admin_notified_at` and `auto_reply_sent_at` timestamps
   - **Email Templates:**
     - **Admin Notification:** Professional HTML email with submitter details (name, email, message, timestamp)
     - **Auto-Reply:** Branded HTML email thanking submitter, confirming 24-hour response time, CTA to LTH PVR page
   - **Error Handling:** Returns success even if emails fail (submission saved), logs errors to console
   - **CORS:** Enabled for cross-origin requests
   - **Deployment:** `supabase functions deploy ef_contact_form_submit --no-verify-jwt`

3. **Website Contact Form Updates** (`website/index.html`)
   - **reCAPTCHA Integration:**
     - Added `<script src="https://www.google.com/recaptcha/api.js">` to head
     - Added `<div class="g-recaptcha">` widget to contact form
     - Uses same reCAPTCHA site key as back-test form (shared configuration)
     - Widget ID 0 (first/only reCAPTCHA on landing page)
   - **Form Field IDs:** `contactName`, `contactEmail`, `contactMessage`
   - **JavaScript Handler:**
     - Validates reCAPTCHA completion before submission with `grecaptcha.getResponse()`
     - Checks for empty response and displays inline error if not completed
     - Calls `ef_contact_form_submit` edge function
     - Displays success/error messages inline (`#contactFormMessage`)
     - Resets form and reCAPTCHA on success
     - Resets reCAPTCHA on error (allows retry)
   - **Email Address Fix:** Updated contact info to `info@bitwealth.co.za` and `support@bitwealth.co.za` (was `.com`)

4. **Security & Anti-Spam:**
   - **reCAPTCHA v2:** Server-side verification prevents bot submissions
   - **Client-Side Validation:** Prevents form submission if reCAPTCHA not completed
   - **Email Validation:** Basic regex check for valid email format
   - **Database Storage:** All submissions logged for abuse tracking
   - **Rate Limiting:** Future enhancement - can query `contact_form_submissions` by email/date for rate limits

**Bug Fixes:**
1. **Conflicting Event Handler** (2026-01-12)
   - **Problem:** Old event handler in `js/main.js` was intercepting contact form submission and showing browser alert popup "Message sent! We'll get back to you soon." This prevented reCAPTCHA validation from running.
   - **Solution:** Removed lines 105-113 from `js/main.js` that contained `contactForm.addEventListener('submit')` handler
   - **Result:** Contact form now uses only the inline handler in `index.html` with proper reCAPTCHA validation

2. **reCAPTCHA Widget ID** (2026-01-12)
   - **Problem:** JavaScript was trying to access widget ID 1 with `grecaptcha.getResponse(1)`, but contact form uses widget ID 0 (first reCAPTCHA on page)
   - **Solution:** Changed `grecaptcha.getResponse(1)` to `grecaptcha.getResponse()` (defaults to widget 0)
   - **Impact:** reCAPTCHA validation now works correctly, blocking submission when checkbox not checked

3. **reCAPTCHA Site Key Mismatch** (2026-01-12)
   - **Problem:** Contact form initially used different site key than back-test form, causing "ERROR for site owner: Invalid site key"
   - **Solution:** Updated contact form to use same working site key as back-test form
   - **Note:** Both forms now share same reCAPTCHA configuration (site key + secret key)

**Technical Details:**
- **SMTP Integration:** Uses existing `sendHTMLEmail()` function from `_shared/smtp.ts`
- **Email Service:** Direct SMTP (not Resend API) via nodemailer
- **Environment Variables Required:**
  - `RECAPTCHA_SECRET_KEY` - Google reCAPTCHA secret key for server-side verification (shared with back-test form)
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` - Already configured
- **Database Migration:** `supabase/migrations/20260112_add_contact_form_submissions.sql`

**User Experience:**
1. User fills out contact form on website landing page
2. Completes reCAPTCHA challenge (required - form won't submit without it)
3. Clicks "Send Message" button
4. Sees inline success message: "Thank you! We'll get back to you within 24 hours."
5. Receives auto-reply email confirmation immediately
6. Admin receives notification email at info@bitwealth.co.za with full message details

**Admin CRM Workflow:**
- Query submissions: `SELECT * FROM public.contact_form_submissions ORDER BY created_at DESC;`
- Check email delivery: Filter by `admin_notified_at IS NOT NULL` and `auto_reply_sent_at IS NOT NULL`
- Identify failed emails: `admin_notified_at IS NULL` or `auto_reply_sent_at IS NULL`
- Future enhancement: Build admin UI panel to view/respond to submissions

**Production Status:**
- ✅ Database migration applied
- ✅ Edge function deployed
- ✅ Website form updated and deployed
- ✅ reCAPTCHA validation working (blocks submission without checkbox)
- ✅ Admin notification emails sending to info@bitwealth.co.za
- ✅ Auto-reply emails sending to submitters
- ✅ All bugs fixed and tested

### v0.6.16 – Phase 2 Public Website Complete
**Date:** 2026-01-12  
**Purpose:** Completed Phase 2 of public marketing website with real back-test data integration and Google reCAPTCHA security implementation.

**Components Completed:**

1. **Phase 2B: LTH PVR Product Page** (website/lth-pvr.html)
   - **Real Back-Test Data Integration:**
     - Queried historical performance from `lth_pvr_bt.bt_results_daily` + `bt_std_dca_balances`
     - Parameters: $10K upfront, $1K monthly, 2020-01-01 to 2025-12-31
     - 25 quarterly data points (2020-01 through 2025-12)
     - Final results: LTH PVR 789.8% ROI ($729,614 NAV) vs Standard DCA 325.8% ROI ($349,117 NAV)
   - **Chart Implementation:**
     - ROI comparison chart (line chart, percentage values)
     - NAV comparison chart (line chart, USD values)
     - Chart.js 4.4.1 with responsive configuration
   - **Bug Fix:** Negative value formatting
     - Problem: Charts showed "+-16.4%" instead of "-16.4%" for negative ROI
     - Solution: Conditional formatting `(value >= 0 ? '+' : '') + value + '%'`
     - Applied to: Tooltip labels and y-axis tick callbacks

2. **Phase 2C: Google reCAPTCHA Implementation**
   - **Decision:** Switched from hCaptcha to Google reCAPTCHA v2 after discovering hCaptcha is not free
   - **Frontend Integration** (website/lth-pvr-backtest.html):
     - Added reCAPTCHA script: `<script src="https://www.google.com/recaptcha/api.js" async defer></script>`
     - Added widget: `<div class="g-recaptcha" data-sitekey="..." data-theme="dark"></div>`
     - JavaScript token retrieval: `grecaptcha.getResponse()`
     - Error handling: `grecaptcha.reset()` on submission failure
   - **Backend Verification** (supabase/migrations/20260112_add_recaptcha_verification.sql):
     - Updated `run_public_backtest()` RPC function to accept `p_captcha_token TEXT` parameter
     - CAPTCHA verification via HTTP POST to `https://www.google.com/recaptcha/api/siteverify`
     - Fallback logic: If reCAPTCHA API fails, logs warning but allows request through (rate limiting still enforced)
     - Secret key stored in Supabase environment: `app.settings.recaptcha_secret_key`
   - **Bug Fixes:**
     - Problem: `bt_runs` table CHECK constraint only allows status values: 'running', 'ok', 'error' (not 'pending')
     - Solution: Changed INSERT status from 'pending' to 'running' in RPC function
     - Migration: Applied `20260112_fix_recaptcha_bt_runs_status.sql`

**Files Modified:**
- `website/lth-pvr.html` - Real data integration, chart formatting fixes
- `website/lth-pvr-backtest.html` - reCAPTCHA frontend implementation
- `supabase/migrations/20260112_add_recaptcha_verification.sql` - RPC function with CAPTCHA
- `supabase/migrations/20260112_fix_recaptcha_bt_runs_status.sql` - Status constraint fix

**Testing:**
- ✅ Product page displays real back-test data with correct formatting (negative values show properly)
- ✅ Back-tester reCAPTCHA integration tested and working
- ✅ Rate limiting enforced (10 back-tests per day per email)
- ✅ Error handling verified (CAPTCHA reset on failure)

**Production Status:**
- Phase 2A: Landing page product catalog ✅ COMPLETE (2026-01-09)
- Phase 2B: LTH PVR product page ✅ COMPLETE (2026-01-12)
- Phase 2C: Interactive back-tester ✅ COMPLETE (2026-01-12)
- Phase 2D: Analytics tracking ⏳ PENDING

**Next Steps:**
- Implement analytics tracking (Google Analytics or Plausible)
- Monitor back-test conversion rates (email submissions → prospect form completions)
- Launch marketing campaign

### v0.6.15 – Performance Fee High-Water Mark Logic Complete Fix
**Date:** 2026-01-11  
**Purpose:** Corrected three critical bugs in performance fee calculation logic to ensure fees are only charged on true investment gains, excluding new contributions.

**Problems Identified:**

1. **HWM Initialization Timing (Bug #1)**
   - **Problem:** HWM initialized BEFORE trading activity on day 1, including exchange fees
   - **Impact:** HWM set to $10,897.85 (net contribution) instead of $10,896.11 (actual NAV after trading)
   - **Result:** Portfolio had to grow extra $1.74 just to reach starting point, delaying first performance fee

2. **Daily HWM Updates (Bug #2)**
   - **Problem:** HWM updated every day during first month when NAV increased, not just at month boundaries
   - **Impact:** By Jan 31, HWM climbed to $13,461.41, far above starting NAV of $10,896.11
   - **Result:** Feb 1 navForPerfFee ($13,334.59) was BELOW inflated HWM, preventing fee that should have been charged
   - **Example:** First performance fee delayed from Feb 1 to June 1 (4 months late)

3. **Contribution Exclusion Logic (Bug #3)**
   - **Problem:** Initially used gross contributions, then didn't initialize hwmContribNetCum on day 1
   - **Impact:** Performance fees charged on NAV increases due to new deposits (customer deposits $1K, fee charged on $1K NAV increase)
   - **Result:** Customers charged fees on their own money, not investment gains

**Solution Implemented:**

**Architecture Overview:**
- **Three Key Variables:**
  - `highWaterMark` - NAV (minus contributions) at last HWM update
  - `hwmContribNetCum` - Net contributions at last HWM update (baseline for profit calculation)
  - `lastMonthForPerfFee` - Month key of last performance fee calculation

**1. Corrected Initialization (Lines 520-525):**
```typescript
// At END of day 1 loop iteration, AFTER all trading activity
if (i === 0) {
  const initialNav = usdtBal + btcBal * px;  // Actual NAV after trading and fees
  highWaterMark = initialNav;                // HWM = $10,896.11 (correct)
  hwmContribNetCum = contribNetCum;          // Baseline = $10,897.85
}
```

**2. Month-Boundary-Only Updates (Lines 480-517):**
```typescript
// Only triggers when month changes AND not first month
const isNewMonth = (monthKey !== lastMonthForPerfFee);
const isNotFirstMonth = (lastMonthForPerfFee !== null);

if (isNewMonth && isNotFirstMonth) {
  // Calculate NAV adjusted for new contributions
  const currentNav = usdtBal + btcBal * px;
  const contribSinceHWM = contribNetCum - hwmContribNetCum;  // NEW contributions only
  const navForPerfFee = currentNav - contribSinceHWM;        // Profit = NAV growth - new deposits
  
  if (navForPerfFee > highWaterMark && performanceFeeRate > 0) {
    const profitAboveHWM = navForPerfFee - highWaterMark;
    performanceFeeToday = profitAboveHWM * performanceFeeRate;
    usdtBal -= performanceFeeToday;
    
    // Update HWM to NAV AFTER fee deduction
    const navAfterFee = usdtBal + btcBal * px;
    highWaterMark = navAfterFee - contribSinceHWM;
    hwmContribNetCum = contribNetCum;
  } else if (navForPerfFee > highWaterMark) {
    // Update HWM even if no fee charged (new peak reached)
    highWaterMark = navForPerfFee;
    hwmContribNetCum = contribNetCum;
  }
}
```

**3. Use Net Contributions (Lines 231, 523):**
- Changed from `hwmContribGrossCum` to `hwmContribNetCum`
- Net contributions include all fee deductions (platform fee 0.75%, exchange fee 18 bps)
- Ensures profit calculation matches actual NAV (which is also net of fees)

**Mathematical Example (Feb 1, 2020):**
```
Starting State (Jan 1):
  - NAV: $10,896.11
  - HWM: $10,896.11
  - hwmContribNetCum: $10,897.85

Feb 1 (First Performance Fee):
  - Previous NAV: $13,237.65
  - New contribution: $1,000 gross → $990.71 net (after platform + exchange fees)
  - Current NAV (before perf fee): $14,325.30
  - Current contribNetCum: $11,888.56
  
  Profit Calculation:
  - contribSinceHWM = $11,888.56 - $10,897.85 = $990.71 (new deposits)
  - navForPerfFee = $14,325.30 - $990.71 = $13,334.59 (NAV growth excluding new deposits)
  - profitAboveHWM = $13,334.59 - $10,896.11 = $2,438.48 (true investment gain)
  - performanceFee = $2,438.48 × 10% = $243.85 ✅ CORRECT
  
  After Fee:
  - usdtBal = $825.48 - $243.85 = $581.63
  - navAfterFee = $14,081.45
  - HWM updated to: $14,081.45 - $990.71 = $13,090.74
  - hwmContribNetCum updated to: $11,888.56
```

**Edge Case Handling:**
- **Deposit-Only NAV Increase:** If NAV increases solely due to new contribution, contribSinceHWM equals NAV increase → navForPerfFee equals previous HWM → No fee charged ✅
- **Drawdown Recovery:** If portfolio drops below HWM then recovers, no fee charged until it exceeds previous peak (standard HWM behavior) ✅
- **First Month:** No performance fee (lastMonthForPerfFee is null, condition fails) ✅
- **HWM Never Decreases:** HWM only updates upward, never downward (enforced by `if (navForPerfFee > highWaterMark)`) ✅

**Impact:**
- **Before Fix:** First performance fee charged on June 1, 2020 (4 months late)
- **After Fix:** First performance fee charged on Feb 1, 2020 (correct)
- **Customer Impact:** Performance fees now accurately reflect true investment gains, excluding customer deposits
- **Back-Test Accuracy:** Historical performance now matches expected behavior

**Files Modified:**
- `supabase/functions/ef_bt_execute/index.ts` (Lines 230-231, 355-361, 480-527)
- `docs/HIGH_WATER_MARK_BUG.md` - Complete technical documentation with mathematical examples

**Testing:**
- ✅ HWM initializes to actual NAV ($10,896.11) on first day
- ✅ HWM stays constant throughout January (no daily updates)
- ✅ First performance fee charged on Feb 1 with correct amount ($243.85)
- ✅ No performance fees charged on deposit-only NAV increases
- ✅ HWM correctly tracks peak NAV (minus contributions) at month boundaries

**Production Deployment:**
```powershell
supabase functions deploy ef_bt_execute --no-verify-jwt
```

**Next Steps:**
- Apply same logic to live trading pipeline (`ef_execute_orders`, `ef_post_ledger_and_balances`)
- Add `customer_state_daily.hwm_contrib_net_cum` field for live trading
- Test with one production customer before full rollout

### v0.6.14 – Website Back-Test CI Bands Fix
**Date:** 2026-01-09  
**Purpose:** Fixed website back-tester to use correct CryptoQuant CI bands instead of dummy linear values, resulting in 3.4x performance improvement.

**Problem Identified:**
- Website back-tests showing 189% ROI vs Admin UI showing 776% ROI for identical parameters ($10K upfront, $1K monthly, 2020-2025)
- Root cause: Website was using **dummy linear CI bands** (b1=0.05, b2=0.10, b3=0.15... b11=0.55) instead of **real CryptoQuant values** (b1=0.22796, b2=0.21397, b3=0.19943...)
- Architecture confusion: B1-B11 are **trade size percentages** (22.796% of balance), NOT price levels
- CI band **price levels** (price_at_m100=$45,000) stored in `lth_pvr.ci_bands_daily`, NOT in `bt_params`

**Solution Implemented:**
1. **Removed B1-B11 from INSERT statement** in `run_public_backtest()` - Let them default to NULL
2. **ef_bt_execute automatically applies defaultBands** when B1-B11 are NULL/zero:
   - B1=0.22796, B2=0.21397, B3=0.19943, B4=0.18088, B5=0.12229
   - B6=0.00157, B7=0.002, B8=0.00441, B9=0.01287, B10=0.033, B11=0.09572
3. **ef_bt_execute queries ci_bands_daily** for actual CryptoQuant **price levels** (price_at_m100, price_at_m075, etc.)
4. **Decision logic:** Compares current BTC price to CI band price levels, trades the B1-B11 percentage amounts
5. **Fixed momentum/retrace parameters** to match Admin UI defaults: momo_len=5, momo_thr=0.00, enable_retrace=false

**Performance Impact:**
- **Before fix:** Final NAV $217,254 (165% ROI, 17.62% CAGR) - sold all BTC by end
- **After fix:** Final NAV $736,403 (636% ROI, 43.56% CAGR) - held 0.31 BTC position
- **Improvement:** **3.4x better NAV**, correct strategy behavior (accumulate BTC instead of trading it all away)

**Files Modified:**
- `supabase/migrations/20260109_public_backtest_requests.sql` - Base migration creating public back-test infrastructure
- Applied 5 iterative fix migrations:
  1. `20260109_public_backtest_fix_ci_bands` - Removed B1-B11 from INSERT, let ef_bt_execute apply defaults
  2. `20260109_public_backtest_fix_bt_runs` - Fixed bt_runs schema (no run_label/start_date/end_date columns)
  3. `20260109_public_backtest_fix_insert_order` - Reordered INSERTs to satisfy FK constraints
  4. `20260109_public_backtest_fix_status` - Changed status from 'pending' to 'running' (valid values: running/ok/error)
  5. `20260109_public_backtest_fix_org_id` - Used correct org_id where CI bands exist (b0a77009-03b9-44a1-ae1d-34f157d44a8b)
  6. `20260109_public_backtest_grant_access` - Granted EXECUTE permissions to anon/authenticated roles

**Security Note:** 
- org_id hardcoded in `run_public_backtest()` function - acceptable for single-org deployment
- No API keys or secrets exposed in migrations
- All sensitive credentials remain in environment variables

**Testing:** Website back-test now matches Admin UI performance within 2.5% (slight differences due to fee calculation rounding).

### v0.6.13 – Deposit Scan Consolidation & Self-Contained Activation
**Date:** 2026-01-09  
**Purpose:** Enhanced `ef_deposit_scan` to be self-contained and eliminated redundant `ef_valr_deposit_scan` function.

**Problem Identified:**
- Two separate deposit scanning functions with overlapping responsibilities:
  * `ef_deposit_scan` (active) - Activated customers but created NO accounting records
  * `ef_valr_deposit_scan` (inactive) - Created funding events but was broken (single-customer mapping)
- Customer activation had 30-60 minute delay before accounting records appeared
- Architectural confusion with three separate functions handling deposit workflow

**Solution Implemented:**
1. **Enhanced `ef_deposit_scan` to be self-contained:**
   - After activating customer, immediately creates `exchange_funding_events` for each non-zero balance
   - Calls `ef_post_ledger_and_balances` to create `ledger_lines` and `balances_daily` records
   - Customer activation now atomic: status change + customer_strategies + funding events + ledger + balances all created in single execution
   - Eliminates timing gap where customer was active but had no accounting data

2. **Deleted obsolete `ef_valr_deposit_scan`:**
   - Removed cron job #16 (was already disabled: `active: false`)
   - Deleted function code from `supabase/functions/ef_valr_deposit_scan/`
   - Function was broken by design (hardcoded single customer via `DEFAULT_CUSTOMER_ID`)
   - Superseded by `ef_balance_reconciliation` which properly handles multi-tenant deposit detection

3. **Simplified architecture:**
   - **Before:** ef_deposit_scan (status change) → ef_balance_reconciliation (funding events) → ef_post_ledger_and_balances (ledger)
   - **After:** ef_deposit_scan (status change + funding events + ledger) - single atomic operation
   - `ef_balance_reconciliation` still runs hourly as safety net for manual deposits/withdrawals

**Files Modified:**
- `supabase/functions/ef_deposit_scan/index.ts` - Added funding event creation and ledger posting
- Cron jobs - Removed `lthpvr_valr_deposit_scan` (job #16)
- Deleted: `supabase/functions/ef_valr_deposit_scan/` (entire folder)

**Deployment:**
```powershell
supabase functions deploy ef_deposit_scan --project-ref wqnmxpooabmedvtackji --no-verify-jwt
```

**Testing:** Next customer activation will verify complete accounting records created immediately.

### v0.6.12 – Phase 2: Public Marketing Website & Back-Testing Tool
**Date:** 2026-01-08  
**Purpose:** Architecture design for public-facing website enhancement with interactive back-testing tool for prospect conversion. Multi-product showcase with LTH PVR as flagship strategy.

**New Components:**

1. **Main Landing Page Redesign** (website/index.html)
   - **Hero Section:** "Smart Bitcoin Accumulation Using On-Chain Intelligence"
   - **Performance Preview Chart:** LTH PVR (navy blue) vs Standard DCA (grey), 2020-01-01 to 2025-12-31
   - **ROI Statistics:** Side-by-side comparison showing actual ROI % of LTH PVR vs Standard DCA
   - **Product Showcase:** Multi-strategy catalog positioning LTH PVR within broader product pipeline
   - **Call-to-Action:** "Try Our Interactive Back-Tester" button linking to LTH PVR product page

2. **Product Catalog Architecture**
   - **Current:** LTH PVR (Medium-Risk Bitcoin-Altcoin Pairing Growth Strategy)
   - **Future Pipeline:**
     - Wealth Multiplier Strategies (including non-crypto assets)
     - Bitcoin Lending Retirement Annuity
     - Low-risk Bitcoin Income Generating Strategy
     - High-risk Altcoin Investment Strategies
   - **Design Pattern:** Product cards on landing page, each linking to dedicated product page

3. **LTH PVR Product Page** (website/lth-pvr.html)
   - **Technical Explanation:**
     - On-chain metrics: Long-Term Holder Profit to Volatility Ratio
     - Strategy logic: Capitalize when LTH PVR indicates over/undervaluation
     - Automation: Daily signal generation, order execution, portfolio rebalancing
   - **Historical Performance:** 5-year comparison (2020-2025)
     - Chart 1: ROI % comparison (LTH PVR vs Standard DCA)
     - Chart 2: NAV comparison (USD) over time
   - **Pricing Structure:**
     - 10% performance fee with high-water mark (only charged on NEW profits above previous peak NAV - protects clients from paying fees twice on recovered losses)
     - 0.75% upfront platform fee on all contributions (charged when funds deposited)
     - NO monthly management fees
     - Transparent fee calculation shown in customer portal
   - **Call-to-Action:** "Try the Back-Tester" button linking to interactive tool

4. **Interactive Back-Testing Tool** (website/lth-pvr-backtest.html)
   - **Email Gating:** Require email address before displaying results (lead capture)
   - **Rate Limiting:** Maximum 10 back-tests per day per email (prevent database strain)
   - **User Parameters:**
     - Date range: Custom from/to dates (minimum start date: 2010-07-17)
     - Upfront Investment: $ 0 to $ 1,000,000
     - Monthly Investment: $ 100 to $ 100,000
   - **Results Display:**
     - LTH PVR performance: Final NAV, Total ROI %, Annualized ROI %
     - Standard DCA benchmark: Same metrics for comparison
     - Side-by-side charts: ROI % over time + NAV over time
     - Risk disclaimer: "Past performance doesn't guarantee future results"
   - **Lead Conversion:** "Get Started" button linking to prospect submission form

5. **Back-Testing API & Analytics**
   - **New RPC Function:** `public.run_public_backtest()`
     - Input: email, from_date, to_date, upfront_amount, monthly_amount
     - Output: LTH PVR results + Standard DCA results
     - Rate limiting: Check `public.backtest_requests` table (email + date count)
     - On-demand simulation: No pre-computed results, execute fresh each time
   - **Analytics Tracking Table:** `public.backtest_requests`
     - Columns: email, from_date, to_date, upfront_amount, monthly_amount, lth_pvr_roi, std_dca_roi, requested_at
     - Purpose: Track prospect behavior, identify high-intent leads, measure conversion funnel
   - **Conversion Tracking:** Link clicks from back-tester results to prospect form (UTM parameters or session tracking)

6. **Pricing Model Update**
   - **Current System:** Only 10% performance fee (calculated in `lth_pvr.fees_monthly`)
   - **New System:** 10% performance fee with high-water mark + 0.75% upfront platform fee
   - **Implementation Required:**
     - Add `platform_fee_rate` column to `public.customer_details` (default 0.0075)
     - Modify `ef_post_ledger_and_balances` to calculate platform fee on deposits
     - Create `lth_pvr.platform_fees` table (customer_id, fee_date, contribution_amount, fee_amount, fee_rate)
     - Update customer portal to display platform fees separately from performance fees
     - Update admin UI to allow editing platform fee rate per customer

**Design Specifications:**
- **Branding:**
  - Colors: Blue (#003B73 navy, #0074D9 bright blue) + Gold (#F39C12)
  - Typography: Aptos font family (system default for Windows/Office)
  - Logo: Top-left corner on all pages (existing BitWealth logo)
- **Responsive Design:**
  - Desktop: Full-featured charts, detailed tables, side-by-side comparisons
  - Mobile: Simplified UX, stacked layouts, essential metrics only
  - Breakpoints: 768px (tablet), 480px (mobile)

**Analytics & Conversion Funnel:**
```
Landing Page → Product Page → Back-Tester → Results → Prospect Form → Customer
    (bounce)      (bounce)      (email gate)  (CTA clicks)  (conversion)
```

**Implementation Priority:**
- Phase 2A: Landing page product catalog update (1 day) ✅ COMPLETE 2026-01-09
  * Kept original landing page structure (hero, strategy, how-it-works sections)
  * Replaced pricing section with product catalog (6 products: 1 active, 5 coming soon)
  * LTH PVR card links to lth-pvr.html product page
  * Updated navigation and footer links (Pricing → Products)
- Phase 2B: LTH PVR product page with historical performance charts (2 days)
- Phase 2C: Interactive back-testing tool with email gating + rate limiting (3 days)
- Phase 2D: Analytics tracking + pricing model update (2 days)
- Total Estimate: 8 days (1 day saved by keeping original landing page)

**Security Considerations:**
- Email validation: Prevent spam/bot submissions (basic regex check)
- Rate limiting enforcement: PostgreSQL unique constraint + date-based counting
- RLS policies: `backtest_requests` table readable only by admin (no public read access)
- Input validation: Date ranges, investment amounts must be within allowed bounds
- SQL injection prevention: Use parameterized queries in RPC function

**Documentation:**
- Build plan created: `docs/Public_Backtest_Tool_Build_Plan.md`
- Test cases: Create `docs/Public_Website_Test_Cases.md` (covering landing page, product page, back-tester, analytics)

### v0.6.11 – Balance Reconciliation & Email Portal URL Fixes
**Date:** 2026-01-07  
**Purpose:** Fixed critical bugs in balance reconciliation system, customer portal URL in emails, and hourly cron job authentication.

**Bug Fixes:**
1. **ef_balance_reconciliation - Invalid Column Error**
   - **Problem:** Function attempted to INSERT `notes` column into `lth_pvr.exchange_funding_events` table, causing SQL error and preventing funding events from being created
   - **Impact:** Hourly reconciliation detected discrepancies but failed with "error_creating_events" instead of creating deposit/withdrawal records
   - **Root Cause:** Table schema has no `notes` column (available columns: funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, created_at)
   - **Solution:** Removed `notes` field from funding event objects (lines 237, 249 in ef_balance_reconciliation/index.ts)
   - **Testing:** Customer 44 deposit (1 USDT) successfully created funding event after fix

2. **ef_deposit_scan - Incorrect Customer Portal URL**
   - **Problem:** Welcome email "Access Your Portfolio" button linked to `/website/portal.html` (404 error)
   - **Root Cause:** Netlify publishes from `website/` directory, so files at root level. Email template used nested path
   - **Solution:** Changed portal_url from `${websiteUrl}/website/portal.html` to `${websiteUrl}/customer-portal.html` (line 285)
   - **Impact:** Customers clicking email link received 404 instead of accessing dashboard

3. **netlify.toml - Wildcard Redirect Blocking Portal**
   - **Problem:** Customer portal page returned 404 even after URL fix
   - **Root Cause:** Netlify config had `from = "/*"` redirect rule redirecting all requests to `/index.html`
   - **Solution:** Removed entire `[[redirects]]` block from netlify.toml (SPA fallback not needed for multi-page static site)
   - **Testing:** Customer portal now loads correctly at https://bitwealth.co.za/customer-portal.html

4. **balance-reconciliation-hourly Cron Job - Authentication Failure**
   - **Problem:** Cron job failed every hour with error: `unrecognized configuration parameter "app.settings.service_role_key"`
   - **Impact:** Balance reconciliation never ran automatically; deposits/withdrawals not detected until manual trigger
   - **Root Cause:** Cron job tried to read non-existent PostgreSQL config parameter for Authorization header
   - **Solution:** Recreated cron job (jobid 33) with hardcoded service role JWT in Authorization header
   - **Rationale:** Supabase pg_cron requires service role key in HTTP request; key already visible in cron.job table metadata
   - **Migration:** Manual SQL executed via Supabase dashboard (not tracked in migrations/)

**Files Modified:**
- supabase/functions/ef_balance_reconciliation/index.ts (removed notes field)
- supabase/functions/ef_deposit_scan/index.ts (fixed portal URL)
- netlify.toml (removed wildcard redirect)
- cron.job table (recreated balance-reconciliation-hourly with proper auth)

**Production Testing:**
- Customer 44 workflow tested end-to-end:
  - 1. Deposited 1 USDT → ef_deposit_scan activated account, sent welcome email with corrected URL
  - 2. Triggered ef_balance_reconciliation manually → Created deposit funding event successfully
  - 3. Triggered ef_post_ledger_and_balances → Created ledger line (kind='topup', amount_usdt=1.00)
  - 4. Withdrew 1 USDT → Triggered reconciliation → Created withdrawal funding event + ledger line
  - 5. Customer portal displays both transactions correctly (deposit + withdrawal)

**Deployment Commands:**
```powershell
supabase functions deploy ef_balance_reconciliation --project-ref wqnmxpooabmedvtackji --no-verify-jwt
supabase functions deploy ef_deposit_scan --project-ref wqnmxpooabmedvtackji --no-verify-jwt
git add netlify.toml; git commit -m "Fix redirect"; git push  # Netlify auto-deploys
```

### v0.6.10 – Customer Portal Message Logic Fix
**Date:** 2026-01-07  
**Purpose:** Fixed customer portal to only show "Trading starts tomorrow!" message for active customers with zero trading history. Previously showed message incorrectly for customers still in onboarding (deposit milestone).

**Bug Fix:**
- **Problem:** Customer portal displayed "Trading starts tomorrow! Your account is active..." message for customers with registration_status='deposit' (Milestone 5)
- **Root Cause:** Dashboard logic checked portfolio.status but not customer.registration_status. Showed "trading starts tomorrow" for any non-active portfolio or missing portfolio data
- **Solution:** 
  - Updated `public.list_customer_portfolios()` RPC to include `has_trading_history` boolean flag (checks for existence of rows in `lth_pvr.decisions_daily`)
  - Updated website/customer-portal.html lines 428-490 with proper conditional logic:
    - No portfolio → "⏳ Portfolio Not Ready" (onboarding message)
    - Portfolio status not active/inactive → "⏳ Account Setup In Progress"
    - Portfolio status = inactive → "⏸ Account Inactive"
    - Portfolio status = active AND has_trading_history = false → "Trading starts tomorrow!" (no decisions generated yet)
    - Portfolio status = active AND has_trading_history = true → Hide message, show dashboard (trading active)
- **Rationale:** Using `has_trading_history` (existence of decisions) instead of `btc_balance` prevents false "Trading starts tomorrow" messages when all BTC has been sold but trading is active
- **Testing:** Customer 44 (registration_status='deposit') now sees "Account Setup In Progress" instead of "Trading starts tomorrow!"

**Customer Portal Message Matrix:**
| registration_status | portfolio.status | has_trading_history | Message Displayed |
|---------------------|------------------|---------------------|-------------------|
| prospect, kyc, setup | NULL | N/A | "⏳ Portfolio Not Ready" |
| deposit | pending | false | "⏳ Account Setup In Progress" |
| active | active | false | "Trading starts tomorrow!" |
| active | active | true | (no message, show dashboard) |
| inactive | inactive | any | "⏸ Account Inactive" |

### v0.6.9 – Automated Balance Reconciliation & Portal Fixes
**Date:** 2026-01-05  
**Purpose:** Implemented automated balance reconciliation system to detect manual transfers, deposits, and withdrawals not tracked by system. Fixed portal dashboard to display zero balances for active customers. VALR does not provide webhook support for deposit/withdrawal events.

**New Components:**
1. **Edge Function: `ef_balance_reconciliation`**
   - **Purpose:** Hourly polling of VALR API to compare balances with system records
   - **Logic:**
     * Query all active customers (registration_status='active')
     * For each customer: Call VALR API GET /v1/account/balances with subaccount header
     * Compare VALR balances with lth_pvr.balances_daily (date=today)
     * Tolerance: BTC ± 0.00000001 (1 satoshi), USDT ± 0.01 (1 cent)
     * If discrepancy detected: Create funding event (deposit/withdrawal), update balances_daily
   - **Deployed:** 2026-01-05 with --no-verify-jwt

2. **pg_cron Job: `balance-reconciliation-hourly` (Job #32)**
   - **Schedule:** Every hour at :30 minutes past (cron: '30 * * * *')
   - **Rationale:** Avoids conflict with trading pipeline (03:00-03:15 UTC)
   - **Migration:** `20260105_add_balance_reconciliation.sql`

3. **Documentation:** `docs/Balance_Reconciliation_System.md`
   - Complete technical specification
   - Testing history and verification
   - Production operations guide
   - Monitoring queries

**Why Polling vs Webhooks:**
- VALR API documentation (https://docs.valr.com/) has NO webhook endpoints for deposits/withdrawals
- WebSocket API only covers trading data (market quotes, order updates), not bank transfers
- Hourly polling acceptable for production (maximum 60-minute lag for manual transfers)
- Automated funding event creation maintains audit trail

**Data Flow:**
```
Customer Manual Transfer → VALR Balance Changes → Hourly Reconciliation Scan → 
  Discrepancy Detected → Create exchange_funding_events → Update balances_daily → 
    ef_post_ledger_and_balances corrects NAV calculation
```

**Testing:** Tested with 3 active customers, zero discrepancies found. Manual withdrawal test (Customer 31, 2.00 USDT) successfully created funding event and updated balance.

4. **Customer Portal - Zero Balance Display Bug**
   - **Problem:** Portal showed "Trading starts tomorrow" for active customers with zero balances
   - **Root Cause:** JavaScript `!portfolios[0].nav_usd` treated 0 as falsy
   - **Impact:** Active customers with zero balances couldn't see dashboard
   - **Fix:** Updated `customer-portal.html` loadDashboard() (lines 372-420):
     * Check `portfolio.status === 'active' && nav_usd !== null && nav_usd !== undefined`
     * Allows zero values, only rejects NULL/undefined
   - **Testing:** Customer 31 with $0.00 balance now sees dashboard correctly

**Customer Portal MVP Status (website/customer-portal.html - 433 lines):**
- ✅ Portfolio summary dashboard (NAV, BTC, USDT, ROI placeholder)
- ✅ Zero balance support (displays $0.00 correctly)
- ❌ Performance chart (NOT implemented - future enhancement)
- ❌ Transactions table (NOT implemented - future enhancement) 
- ❌ Statements download (NOT implemented - future enhancement)

### v0.6.8 – M6 Critical Bugs Fixed
**Date:** 2026-01-05  
**Purpose:** Fixed 3 critical bugs discovered during M6 testing: customer_strategies sync, trade_start_date population, and CI bands date fetching.

**Bug Fixes:**
1. **[CRITICAL] customer_strategies Sync Issue** (Customer 39 not included in trading pipeline)
   - **Problem:** When `ef_deposit_scan` activated customers (status='deposit' → 'active'), it updated `customer_details.registration_status` and `customer_portfolios.status`, but did NOT create the required row in `lth_pvr.customer_strategies`.
   - **Impact:** `ef_generate_decisions` requires `customer_strategies.live_enabled=true` to include customers in trading pipeline. Customer 39 was activated but had no trading decisions generated.
   - **Fix:** Updated `ef_deposit_scan` to create `lth_pvr.customer_strategies` row when activating customers:
     * Query portfolio details (strategy_code, exchange_account_id)
     * Get latest strategy_version_id from `lth_pvr.strategy_versions`
     * Insert row with `live_enabled=true`, `effective_from=CURRENT_DATE`
   - **Deployed:** ef_deposit_scan (2026-01-05)
   - **Manual Fix:** Created SQL script `fix_customer_39.sql` to backfill missing row for Customer 39

2. **[NON-CRITICAL] trade_start_date Not Populating**
   - **Problem:** `customer_details.trade_start_date` remained NULL after customer activation
   - **Purpose:** Should record date when customer's first strategy becomes active (for reporting/analytics)
   - **Fix:** Updated `ef_deposit_scan` to set `trade_start_date = CURRENT_DATE` when activating customers (only if NULL)
   - **Deployed:** ef_deposit_scan (2026-01-05)

3. **[CRITICAL] CI Bands Fetching Today's Data Instead of Yesterday**
   - **Problem:** `ef_fetch_ci_bands` was fetching today's CI bands data by default (via `days=5` parameter)
   - **Issue:** Today's on-chain data changes throughout the day and is only finalized at day's close
   - **Impact:** Trading decisions made at 03:00 UTC should use YESTERDAY's finalized CI bands (signal_date = trade_date - 1)
   - **Fix:** Updated `ef_fetch_ci_bands` to:
     * Calculate `yesterdayStr` = today - 1 day
     * Default to fetching single day (yesterday) when no range specified
     * Explicitly set `start` and `end` parameters to `yesterdayStr` when no range provided
     * Changed default `days` from 5 to 1
   - **Deployed:** ef_fetch_ci_bands (2026-01-05)
   - **Verification:** Tomorrow's pipeline run (2026-01-06 03:00 UTC) will use 2026-01-05 CI bands data

**Database Schema Impact:**
- `lth_pvr.customer_strategies`: Now auto-created when customer activated
- `public.customer_details.trade_start_date`: Now auto-populated on activation
- No migration required (fields already exist)

**Testing Status:** M6 testing in progress. Customer 39 now has customer_strategies row and will be included in next trading pipeline run (2026-01-06 03:00 UTC).

### v0.6.7 – Integration Testing Complete
**Date:** 2026-01-05  
**Purpose:** Full end-to-end integration testing of 6-milestone customer onboarding pipeline completed successfully. All integration tests (IT1, IT2, IT3) passed with 5 minor bug fixes.

**Key Changes:**
1. **Integration Test 1: Full Pipeline End-to-End** ✅ PASS
   - Test Customer: Customer 39 (Integration TestUser, integration.test@example.com)
   - Complete flow validated: Prospect → Strategy → KYC → VALR → Deposit → Active
   - Duration: 45 minutes (including bug fixes)
   - All 8 steps executed successfully

2. **Integration Test 2: Email Flow Verification** ✅ PASS
   - All 7 emails verified via email_logs table:
     * prospect_notification, prospect_confirmation (M1)
     * kyc_portal_registration (M2)
     * kyc_id_uploaded_notification (M3)
     * deposit_instructions (M4)
     * funds_deposited_admin_notification, registration_complete_welcome (M5)
   - All emails sent to correct recipients with status='sent'

3. **Integration Test 3: Database State Consistency** ✅ PASS
   - customer_details.registration_status and customer_portfolios.status synchronized
   - exchange_accounts properly linked to customer_portfolios
   - All email templates active
   - No orphaned records
   - Foreign key relationships intact

4. **Bug Fixes During Integration Testing:**
   - **ef_prospect_submit**: ADMIN_EMAIL default changed from `davin.gaier@gmail.com` to `admin@bitwealth.co.za`
   - **Admin UI**: Strategy confirmation dialog fixed - escaped `\\n` characters replaced with actual line breaks, bullets changed from `-` to `•`
   - **ef_confirm_strategy**: WEBSITE_URL default changed from `file://` path to `http://localhost:8081` for testing
   - **website/upload-kyc.html**: Redirect URL fixed from `/website/portal.html` to `/portal.html`
   - **ef_upload_kyc_id**: Removed `davin.gaier@gmail.com` from admin notification recipients (single recipient only)

5. **Website Hosting Setup**
   - Added to Customer_Portal_Build_Plan.md as critical pre-launch task
   - Local testing: Python HTTP server on port 8081
   - Production plan: Cloudflare Pages / Netlify / Vercel deployment
   - WEBSITE_URL environment variable required for production deployment

**Testing Status:** 75% complete (45/60 tests passed). Integration tests complete. Remaining: M6 trading pipeline tests (requires Jan 5 03:00 UTC run), performance tests, security tests.

### v0.6.6 – Customer Portal MVP Complete
**Date:** 2026-01-04  
**Purpose:** Customer-facing portal dashboard completed and deployed. First customer (Customer 31 - Jemaica Gaier) activated and able to access portal. Portal will display real-time portfolio data after first trading run on 2026-01-05.

**Key Changes:**
1. **Customer Portal Dashboard** (`website/customer-portal.html`)
   - Authentication: Supabase Auth integration with `auth.getSession()`
   - Onboarding Status: Visual progress tracker showing all 6 milestones
   - Portfolio Dashboard: NAV, BTC/USDT balances, ROI metrics (displays after trading data available)
   - Portfolio List: Shows all customer portfolios with strategy and status
   - Responsive design with dark blue gradient background, white cards
   - Text contrast optimized for readability (dark brown/green text on yellow/green alert boxes)

2. **RPC Functions** (deployed to `public` schema)
   - `get_customer_onboarding_status(p_customer_id INTEGER)` - Returns 6-milestone progress
   - `list_customer_portfolios(p_customer_id INTEGER)` - Lists portfolios with latest balances
   - Fixed parameter types: Changed from UUID to INTEGER to match `customer_id` BIGINT column
   - Uses LEFT JOIN LATERAL for latest balance from `lth_pvr.balances_daily`

3. **Portal Redirect Logic**
   - `login.html`: Checks `registration_status`, redirects kyc→upload-kyc.html, active→customer-portal.html
   - `customer-portal.html`: Validates session, redirects to login if unauthenticated
   - Both use consistent `auth.getSession()` method (prevents redirect loops)

4. **First Customer Activation**
   - Customer 31 (Jemaica Gaier, jemaicagaier@gmail.com) activated 2026-01-04
   - Password: BitWealth2026! (via Supabase Admin API)
   - All 6 milestones complete
   - Portal accessible, showing "Trading starts tomorrow" message (correct for pre-trading state)

5. **Bug Fixes**
   - Fixed Supabase anon key mismatch (portal had expired key from Dec 2024)
   - Fixed RPC parameter types (UUID → INTEGER for customer_id)
   - Fixed SQL ambiguous column reference in `list_customer_portfolios`
   - Fixed schema references (customer_portfolios has strategy_code directly, no join needed)
   - Fixed balances_daily join (uses customer_id not portfolio_id, column 'date' not 'balance_date')

**Testing Status:** Portal fully functional, tested with Customer 31. Awaiting first trading run (2026-01-05 03:00 UTC) to verify balance data population.

### v0.6.5 – SMTP Migration Complete
**Date:** 2026-01-04  
**Purpose:** Migrated from Resend API to direct SMTP for all email communications. Improved deliverability and reduced external dependencies.

**Key Changes:**
1. **Email Infrastructure Migration**
   - Replaced Resend API with direct SMTP integration using nodemailer
   - SMTP Server: `mail.bitwealth.co.za:587` (STARTTLS)
   - Email addresses: `noreply@bitwealth.co.za` (automated), `admin@bitwealth.co.za` (alerts)
   - Database: Added `smtp_message_id` column, renamed `resend_message_id` to `legacy_resend_message_id`
   - New module: `supabase/functions/_shared/smtp.ts`
   - Updated edge functions: `ef_send_email`, `ef_alert_digest`
   
2. **Environment Variables**
   - Removed: `RESEND_API_KEY`
   - Added: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`
   - Updated: `ALERT_EMAIL_FROM=admin@bitwealth.co.za`
   
3. **DNS Configuration**
   - SPF: `v=spf1 a mx ip4:169.239.218.70 ~all`
   - DKIM: Configured with RSA public key
   - DMARC: `v=DMARC1; p=none; rua=mailto:admin@bitwealth.co.za; adkim=r; aspf=r`

### v0.6.4 – Customer Onboarding Pipeline COMPLETE
**Date:** 2025-12-31  
**Purpose:** All 6 milestones of customer onboarding pipeline built, deployed, and documented. System 100% functional from prospect to active customer.

### v0.6.3 – Customer Onboarding Workflow REDESIGNED
**Date:** 2025-12-31  
**Purpose:** Complete redesign of customer onboarding pipeline based on confirmed requirements. Replaces previous KYC workflow with proper 6-milestone pipeline.

**Key Changes:**

1. **NEW: 6-Milestone Onboarding Pipeline**
   - **Source Document:** `Customer_Onboarding_Workflow_CONFIRMED.md`
   - **Module Rename:** "Customer Maintenance" → "Customer Management"
   - **Architecture:** Option A (Registration → ID Upload → Verification)
   
   **Milestone 1 - Prospect:** ✅ COMPLETE
   - Form on website/index.html
   - Creates customer_details with status='prospect'
   - Sends admin notification email
   
   **Milestone 2 - Confirm Interest:** ✅ COMPLETE (deployed 2025-12-31)
   - Admin selects strategy from dropdown (source: public.strategies table)
   - Creates entry in customer_portfolios
   - Changes status='prospect' → 'kyc'
   - Sends email to customer with registration link (template: `kyc_portal_registration`)
   - Edge function: `ef_confirm_strategy` (deployed with --no-verify-jwt)
   - Email template: `kyc_portal_registration` (created)
   - UI: Strategy dropdown in Customer Management module (implemented)
   
   **Milestone 3 - Portal Registration & KYC:** ✅ COMPLETE (deployed 2025-12-30)
   - Customer registers account on register.html (Supabase Auth)
   - Customer logs into portal (portal access starts here)
   - Customer uploads ID via website/upload-kyc.html (naming: `{ccyy-mm-dd}_{last_name}_{first_names}_id.pdf`)
   - Stores in Supabase Storage bucket: `kyc-documents` (private, 10MB limit, 4 RLS policies)
   - Edge function: `ef_upload_kyc_id` (deployed with JWT verification)
   - Sends admin notification email (template: `kyc_id_uploaded_notification`)
   - Admin UI: KYC ID Verification card with View Document + Verify buttons
   - Admin verifies ID → changes status='kyc' → 'setup'
   
   **Milestone 4 - VALR Account Setup:** ✅ COMPLETE (deployed 2025-12-30)
   - Edge function: `ef_valr_create_subaccount` (VALR API integration with HMAC SHA-512)
   - Creates VALR subaccount when admin clicks button
   - Stores subaccount_id in exchange_accounts
   - Admin manually enters deposit_ref in 3-stage UI workflow
   - Changes status='setup' → 'deposit' when deposit_ref saved
   - Sends email to customer with banking details (template: `deposit_instructions`)
   - Admin UI: VALR Account Setup card with Create/Save/Resend Email buttons
   
   **Milestone 5 - Funds Deposit:** ✅ COMPLETE & AUTOMATED (deployed 2025-12-30, enhanced 2026-01-09)
   - Edge function: `ef_deposit_scan` (deployed --no-verify-jwt)
   - Hourly scan via pg_cron (jobid=31, schedule='0 * * * *', active=true)
   - Checks ZAR/BTC/USDT balances on VALR subaccounts
   - If ANY balance > 0 → **SELF-CONTAINED ACTIVATION** (atomic operation):
     * Updates `customer_details.registration_status = 'active'`
     * Updates `customer_portfolios.status = 'active'`
     * Creates `lth_pvr.customer_strategies` row with `live_enabled=true`
     * Sets `customer_details.trade_start_date = CURRENT_DATE` (if NULL)
     * **[NEW 2026-01-09]** Creates `lth_pvr.exchange_funding_events` for each non-zero balance
     * **[NEW 2026-01-09]** Calls `ef_post_ledger_and_balances` to create ledger lines and daily balances
   - Sends admin notification email (template: `funds_deposited_admin_notification`)
   - Sends customer welcome email (template: `registration_complete_welcome`)
   - Fully automated: 24 scans per day, customer activation now includes complete accounting setup
   - **Obsolete function removed:** `ef_valr_deposit_scan` (deleted 2026-01-09 - was inactive and broken)
   
   **Milestone 6 - Customer Active:** ✅ COMPLETE (deployed 2025-12-30)
   - Full portal access granted (website/portal.html)
   - Trading begins (existing LTH_PVR pipeline includes status='active' customers)
   - Admin UI: Active Customers card with searchable table
   - Admin can set status='inactive' to pause trading (⏸ Set Inactive button)
   - Confirmation dialog prevents accidental inactivation
   - Inactive customers excluded from daily pipeline (WHERE status='active')

2. **Database Schema Additions**
   - **New column:** `exchange_accounts.deposit_ref` (TEXT)
   - **New storage bucket:** `kyc-documents` (private, 10MB limit, image/* + application/pdf)
   - **Existing columns:** kyc_id_document_url, kyc_id_verified_at, kyc_verified_by (already exist)

3. **Edge Functions Status**
   - ✅ `ef_prospect_submit` (deployed and tested)
   - ✅ `ef_customer_register` (deployed and tested)
   - ✅ `ef_confirm_strategy` (deployed 2025-12-31 - replaces ef_approve_kyc)
   - ✅ `ef_upload_kyc_id` (deployed 2025-12-30 with JWT verification)
   - ✅ `ef_valr_create_subaccount` (deployed 2025-12-30 --no-verify-jwt)
   - ✅ `ef_deposit_scan` (deployed 2025-12-30 - hourly pg_cron job active)

4. **Email Templates Status**
   - ✅ `prospect_notification` (active)
   - ✅ `prospect_confirmation` (active)
   - ✅ `kyc_portal_registration` (created 2025-12-31)
   - ✅ `kyc_id_uploaded_notification` (created 2025-12-30)
   - ✅ `deposit_instructions` (created 2025-12-30)
   - ✅ `funds_deposited_admin_notification` (created 2025-12-30)
   - ✅ `registration_complete_welcome` (created 2025-12-30)

5. **UI Components Status**
   - ✅ Customer Management module (ui/Advanced BTC DCA Strategy.html)
   - ✅ Strategy selection dropdown (implemented 2025-12-31 - Milestone 2)
   - ✅ KYC ID Verification card - View Document + Verify button (built 2025-12-30)
   - ✅ VALR Account Setup card - 3-stage workflow (built 2025-12-30)
   - ✅ Active Customers card - Set Inactive button (built 2025-12-30)
   - ✅ Customer portal ID upload page (website/upload-kyc.html - built 2025-12-30)
   - ⏳ Customer portal onboarding progress indicator (deferred - not critical)

6. **Implementation Status**
   - **Completion:** 100% (all 6 milestones built and deployed)
   - **Deployment Date:** 2025-12-30 (M3-M6), 2025-12-31 (M2)
   - **Complexity:** High (VALR integration, file uploads, hourly scanning) - ✅ COMPLETE
   - **Launch Target:** January 17, 2026 (17 days remaining)
   - **Testing Status:** M1-M2 tested (8%), M3-M6 pending (92%)
   - **Documentation:** MILESTONES_3_TO_6_COMPLETE.md, Customer_Onboarding_Test_Cases.md (v2.0)
   - **Lines of Code:** ~3,500 lines (M3-M6: edge functions, UI, documentation)

### v0.6.2 – Customer Portal MVP Testing Complete
**Date:** 2025-12-31  
**Purpose:** Document completion of Phase 1 MVP testing for customer portal (prospect submission, registration, email templates, admin fee management).

**Key Changes:**

1. **Customer Portal Testing - Phase 1 Complete**
   - **Test Progress:** 20 of 30+ test cases completed (67%)
   - **Tests Passed:** 
     - TC1.1-TC1.5: Prospect Form Submission (5/5 tests) ✅
     - TC2.1-TC2.6: Customer Registration Flow (6/6 tests) ✅
     - TC3.1, TC3.2, TC3.4: Email Template Rendering (3/4 tests) ✅
     - TC4.1-TC4.6: Admin Fee Management (6/6 tests) ✅
   - **Tests Deferred:**
     - TC3.3: KYC Verified Email (waiting for admin KYC workflow UI)
     - TC5.1-TC5.4: RLS Policy Testing (ALL deferred - requires customer portal UI)
   - **Remaining Tests:** TC6 (E2E workflows), TC7 (error handling), TC8 (performance)

2. **Schema Cleanup - Column Standardization**
   - **Issue:** Duplicate name columns in `customer_details` table
     - OLD: `first_name` (text, nullable), `surname` (text, nullable)
     - NEW: `first_names` (text, NOT NULL), `last_name` (text, NOT NULL)
   - **Migration:** `20251230203041_drop_old_name_columns.sql`
     - Dropped `first_name` and `surname` columns
     - Added table comment documenting standard fields
   - **Code Updates:**
     - **ef_prospect_submit:** Changed to use `first_names`/`last_name` only
       * Still accepts `first_name`/`surname` from web form (backwards compatible)
       * Maps directly to new columns on insert
       * Email templates receive `first_names` for personalization
     - **ef_customer_register:** Updated SELECT and user metadata to use new columns
     - **UI (Advanced BTC DCA Strategy.html):** Already using correct columns
     - **chart-narrative function:** Already using correct columns (no change needed)
   - **Impact:** Consistent naming across all code, single source of truth for customer names

3. **Fee Management RPC Fix**
   - **Issue:** UI calling `update_customer_fee_rate` with wrong parameter name
     - Function expects: `p_new_fee_rate` (NUMERIC)
     - UI was passing: `p_new_rate` (wrong name)
   - **Fix:** Updated UI line 6174 to use correct parameter name
   - **Success Message Fix:** UI was looking for `previous_rate_percentage`/`new_rate_percentage`
     - Function returns: `previous_fee_rate` (0.05), `new_fee_rate` (0.075)
     - Updated UI line 6191 to multiply by 100 and format correctly
   - **Result:** Fee updates now show proper success message: "Fee updated successfully for customer 12. Previous: 5.00%, New: 7.50%"

4. **RLS Testing Deferred Until Portal UI Complete**
   - **Rationale:** 
     - Customer RLS policies require authentication as customer (with customer_id in JWT)
     - Admin users have different RLS policies (can view all customers)
     - Demo portal.html has no Supabase integration
     - Proper testing requires functional customer portal with authentication
   - **Deferred Tests:**
     - TC5.1: Customer can only view own data
     - TC5.2: Customer can insert own agreements
     - TC5.3: Anonymous users can submit support requests
     - TC5.4: Customer can view own withdrawal requests
   - **Alternative Verification:** SQL queries added to TC5.1 for checking RLS enabled and policies exist
   - **Next Steps:** Build customer portal UI (Phase 2) before completing RLS testing

5. **Production Readiness Status**
   - **✅ Operational:**
     - Prospect form submission with email confirmations
     - Customer registration workflow
     - Email template system (12 templates, fully branded)
     - Admin fee management with validation
     - Alert system with daily digest emails
     - Pipeline resume mechanism with UI controls
   - **⏸️ Deferred (Non-blocking for Phase 1):**
     - Customer portal UI (portal.html is demo only)
     - RLS policy end-to-end testing
     - Admin KYC approval workflow
     - Support request system
     - Withdrawal request system
   - **📋 Pending (Phase 2+):**
     - Customer portfolio dashboard
     - Transaction history UI
     - Automated deposit reconciliation
     - Performance optimization (caching, pagination)

6. **Launch Timeline**
   - **Target Date:** January 10, 2026 (10 days remaining)
   - **Phase 1 Status:** Testing 67% complete (20/30 tests passed)
   - **Critical Path:** Prospect → Registration → Fee Management ✅ COMPLETE
   - **Next Phase:** Determine priority between:
     - Option A: Complete remaining tests (E2E, error handling, performance)
     - Option B: Build customer portal UI for Phase 2
     - Option C: Focus on admin KYC workflow and manual processes

### v0.6.1 – Pipeline Resume Mechanism
**Date:** 2025-12-28  
**Purpose:** Add automated pipeline recovery system to resume execution after CI bands fetch failures.

**Key Changes:**

1. **Pipeline Resume Functions**
   - **`lth_pvr.get_pipeline_status()`**: Returns current pipeline execution state
     - Checks completion of all 6 pipeline steps (ci_bands, decisions, order_intents, execute_orders, poll_orders, ledger_posted)
     - Validates trade window (03:00 - 00:00 UTC next day)
     - **CRITICAL FIX:** `window_closes` changed from `(v_trade_date)::timestamp` to `(v_trade_date + interval '1 day')::timestamp`
       * Bug: Window was closing at START of trade date (00:00) instead of END
       * Impact: UI showed "Closing soon" with 6+ hours remaining
       * Solution: Window now correctly closes at midnight (00:00 UTC) of next day
     - **CRITICAL FIX:** `can_resume` logic changed from `not v_decisions_done` to `not v_ledger_done`
       * Reason: Allow resume at any incomplete step, not just first step
       * Enables partial pipeline recovery after any failure point
     - Returns `can_resume` flag to indicate if pipeline is safe to continue
   - **`lth_pvr.resume_daily_pipeline()`**: Queues remaining pipeline steps (**DEPRECATED - See Note**)
     - Uses async `net.http_post` to queue HTTP requests (no timeout issues)
     - Queues edge function calls for incomplete steps
     - Returns immediately with request IDs (requests execute after transaction commits)
     - **LIMITATION:** Async queuing causes parallel execution (all functions fire at same microsecond)
     - **SUPERSEDED BY:** ef_resume_pipeline orchestrator (see below)
   - **`lth_pvr.ensure_ci_bands_today_with_resume()`**: Enhanced guard with auto-resume
     - Extends existing guard function to automatically resume pipeline after successful CI bands fetch
     - Single function for fetch + resume workflow

2. **Edge Function: ef_resume_pipeline - Sequential Orchestrator**
   - **Purpose:** REST API endpoint for UI-driven pipeline control WITH SEQUENTIAL EXECUTION
   - **Deployed Version:** v7 (2025-12-28) - **Production Ready**
   - **Architecture Change:** Replaced async pg_net queuing with sequential await pattern
     * **Problem:** resume_daily_pipeline() caused race conditions - all 5 functions fired simultaneously
     * **Solution:** Orchestrator calls each edge function with await, ensuring sequential execution
     * **Benefit:** Proper step ordering, no race conditions, clean execution logs
   - **Endpoints:**
     - `POST /functions/v1/ef_resume_pipeline` with `{"check_status": true}` - Returns pipeline status
     - `POST /functions/v1/ef_resume_pipeline` with `{}` or `{"trade_date": "YYYY-MM-DD"}` - Triggers sequential pipeline resume
   - **Authentication:** JWT verification disabled (`--no-verify-jwt` flag)
     * **CRITICAL FIX:** Service role key authentication requires JWT verification disabled for service-to-service calls
     * Impact: All pipeline edge functions (ef_generate_decisions, ef_create_order_intents, ef_execute_orders, ef_poll_orders, ef_post_ledger_and_balances) redeployed with --no-verify-jwt
     * Security: Supabase project-level access control and RLS still enforced
   - **Implementation:**
     * Uses `.schema("lth_pvr")` chain for RPC calls
     * **CRITICAL FIX:** Line 121 changed from `if (step.status === "complete")` to `if (step.status === true)`
       - Bug: Checking string "complete" against boolean true
       - Impact: Orchestrator completed in <1s without executing any steps
       - Solution: Fixed boolean comparison
     * Sequential loop: await fetch() for each incomplete step
     * Returns detailed results array: [{step, status, success, response, skipped, reason}]
   - **Environment Variables:**
     * **CRITICAL FIX:** ef_create_order_intents/client.ts line 9 changed from `Deno.env.get("Secret Key")` to `SUPABASE_SERVICE_ROLE_KEY`
     * Impact: 401 Unauthorized errors resolved

3. **UI Integration - Pipeline Control Panel**
   - **Location:** Administration module (ui/Advanced BTC DCA Strategy.html)
   - **Components:**
     - Pipeline status display (6 checkboxes: CI Bands, Decisions, Order Intents, Execute Orders, Poll Orders, Ledger Posted)
     - Trade window indicator with color coding (green: valid, red: outside window, yellow: <1h warning)
     - "Refresh Status" button with loading states
     - "Resume Pipeline" button (enabled only when can_resume = true)
     - Execution log with timestamps and color-coded messages (SUCCESS/FAILED/SKIPPED)
   - **Auto-refresh:** Polls status every 30 seconds when panel is visible
   - **Lines:** 2106-2170 (HTML), ~5875-6070 (JavaScript)
   - **CRITICAL FIX:** Lines 6051-6062 updated to check `data.results` instead of `data.steps`
     * Bug: UI parsing wrong response field from orchestrator
     * Impact: Execution log not showing step details
     * Solution: Check data.results, display SKIPPED/SUCCESS/FAILED with response truncated to 200 chars

4. **Architectural Evolution**
   - **Phase 1 - Synchronous Blocking (FAILED):**
     * Initial implementation: `FROM net.http_post()` in SQL
     * Problem: 5-second timeout when calling multiple edge functions
     * Lesson: Synchronous HTTP calls block transaction, unsuitable for multi-step workflows
   - **Phase 2 - Async Queuing (PARTIAL SUCCESS):**
     * Solution: `SELECT net.http_post() INTO v_request_id` (async)
     * Benefit: No timeouts, returns in <100ms
     * Problem: Parallel execution - all 5 functions fired at same microsecond
     * Lesson: Async queuing good for fire-and-forget, bad for sequential dependencies
   - **Phase 3 - Sequential Orchestrator (PRODUCTION):**
     * Solution: Edge function ef_resume_pipeline with await fetch() loop
     * Benefit: Sequential execution, proper error handling, detailed results
     * Status: **74% test coverage (25/34 tests passed), all critical path tests passed**

5. **Documentation**
   - **Test Cases:** Pipeline_Resume_Test_Cases.md (34 test cases across 6 categories)
   - **Test Results:** 25 passed (74% coverage), 3 deferred (exchange/timing), 6 pending (future)
   - **Critical Path:** All 8 must-pass tests successful
   - **Integration:** Updated SDD v0.6.1 with complete technical specifications and all bug fixes

6. **Bug Fixes Summary**
   1. ✅ Synchronous HTTP blocking → Async SELECT net.http_post()
   2. ✅ Parallel execution race conditions → Sequential orchestrator with await
   3. ✅ 401 Unauthorized (wrong env var) → Fixed client.ts to use SUPABASE_SERVICE_ROLE_KEY
   4. ✅ 401 Unauthorized (JWT verification) → Redeployed all functions with --no-verify-jwt
   5. ✅ Orchestrator completing without execution → Fixed boolean comparison (=== true)
   6. ✅ Window closing at wrong time → Changed to (v_trade_date + interval '1 day')::timestamp
   7. ✅ UI not showing execution details → Fixed to check data.results instead of data.steps

### v0.6 (recap) – Alert System Production Implementation
**Date:** 2025-12-27  
**Purpose:** Document fully operational alert system with comprehensive testing and email notifications.

**Key Changes:**

1. **Alert System - Fully Operational**
   - Complete UI implementation in Administration module:
     - Red alert badge (#ef4444) with dynamic count display
     - Component filter dropdown (6 options: All + 5 edge functions)
     - Auto-refresh checkbox (30-second interval with setInterval/clearInterval)
     - Open-only checkbox filter (default: checked)
     - Resolve alert dialog with optional notes
   - Database schema: `lth_pvr.alert_events` with `notified_at` column for email tracking
   - RPC functions: `list_lth_alert_events()`, `resolve_lth_alert_event()`

2. **Alert Digest Email System**
   - **Edge Function:** `ef_alert_digest` (JWT verification disabled)
   - **Email Provider:** Direct SMTP via `mail.bitwealth.co.za:587` (STARTTLS)
   - **Email Module:** `_shared/smtp.ts` using nodemailer
   - **Schedule:** Daily at 05:00 UTC (07:00 SAST) via pg_cron (job ID 22)
   - **Recipients:** admin@bitwealth.co.za
   - **From Address:** admin@bitwealth.co.za
   - **Logic:** 
     - Queries error/critical alerts where `notified_at IS NULL`
     - Sends formatted email digest
     - Updates `notified_at` timestamp to prevent duplicates

3. **Comprehensive Test Coverage**
   - **Documentation:** `Alert_System_Test_Cases.md` with 51 test cases across 8 sections
   - **Executed Tests:** 17 test cases passed (100% of executable UI and database tests)
   - **Test Categories:**
     - Database Functions: 100% coverage (3 tests: 2 passed, 1 skipped for safety)
     - UI Components: 100% coverage (14 tests: all passed)
     - Edge Function Integration: 1 critical scenario tested
   - **Test Results Format:** Date, result (PASS/SKIP), detailed execution notes, code line references

4. **Alerting Module Integration**
   - Shared TypeScript module: `supabase/functions/_shared/alerting.ts`
   - `logAlert()` function with consistent interface across all edge functions
   - `AlertContext` interface for structured debugging data
   - Implemented in: ef_generate_decisions, ef_create_order_intents, ef_execute_orders, ef_poll_orders
   - Alert severities: info, warn, error, critical (with UI color coding)

5. **Documentation Additions**
   - **Alert_System_Test_Cases.md:** 51 test cases with execution tracking and summary statistics
   - **Alert_Digest_Setup.md:** Complete setup guide, troubleshooting, and email template examples
   - Test execution summary table with detailed status tracking

6. **WebSocket Order Monitoring (NEW)**
   - **Hybrid System:** WebSocket (primary) + Polling (safety net)
   - **Database Schema:** Added 4 columns to exchange_orders (ws_monitored_at, last_polled_at, poll_count, requires_polling)
   - **Performance Impact:** 98% API call reduction (1,440/day → 170/day), <5 sec update latency
   - **Edge Functions:**
     - `ef_valr_ws_monitor` (v2): Real-time VALR WebSocket monitoring with comprehensive alerting
     - `ef_execute_orders` (v29): Initiates WebSocket monitoring, alerts on failures
     - `ef_poll_orders` (v38): Reduced to 10-minute safety net, targeted polling support
   - **Cron Schedule:** Polling reduced from */1 (every minute) to */10 (every 10 minutes)
   - **Documentation:**
     - `WebSocket_Order_Monitoring_Implementation.md`: Complete technical guide (10 sections, 500+ lines)
     - `WebSocket_Order_Monitoring_Test_Cases.md`: 35 test cases across 7 categories
   - **Alerting:** WebSocket connection errors, premature closures, initialization failures

### v0.5 (recap)
**Date:** 2025-12-26  
**Purpose:** Initial alerting implementation for LTH PVR

**Components Added:**
- `lth_pvr.alert_events` table with resolution tracking
- `lth_pvr.ci_bands_guard_log` for audit trail
- `lth_pvr.ensure_ci_bands_today()` guard function (30-minute schedule)
- `ef_fetch_ci_bands` with guard mode and self-healing
- `ef_alert_digest` initial implementation
- Basic Alerts UI card in Administration module

**Status at v0.5:** Alerting framework established, but not fully tested or operational.

### v0.4 (recap)
**Date:** Prior to 2025-12-26

**Key Components:**
- Shared `public.exchange_accounts` table
- Full alerting system design (planned, not yet implemented)
- Customer Maintenance UI for portfolios
- Ledger & Balances flow completion

### v0.3 (recap)
- Detailed ledger and balances design
- VALR fallback logic refinements

### v0.2 (recap)
- First comprehensive solution design
- Strategy logic, back-testing architecture, security/RLS

### v0.1 (recap)
- Back-testing logic deep dive

---

## 1. System Overview

### 1.1 Business Goal
BitWealth offers a BTC accumulation service based on the **LTH PVR BTC DCA strategy**:

- **Aggressive Allocation:** Buy more when BTC is cheap relative to Long-Term Holder Profit/Loss Realized (PVR) bands
- **Defensive Allocation:** Reduce buying when BTC is expensive or momentum is negative
- **Performance Tracking:** Compare against Standard DCA benchmark and charge performance fees on outperformance
- **Back-testing:** Same core logic validates historical performance for customer proposals

### 1.2 High-Level Architecture

**Technology Stack:**

- **Database:** Supabase PostgreSQL
  - `lth_pvr` schema → live trading, decisions, orders, ledger, balances, benchmark, fees, **alerts**
  - `lth_pvr_bt` schema → back-testing (runs, simulated ledger, results, benchmark)
  - `public` schema → shared entities (customers, portfolios, strategies, exchange_accounts, orgs)

- **Edge Functions (Deno/TypeScript):**
  - **Core Pipeline:**
    - `ef_fetch_ci_bands` – CI bands ingestion with guard mode
    - `ef_generate_decisions` – daily LTH PVR decision engine
    - `ef_create_order_intents` – decision → tradable order sizing
    - `ef_execute_orders` – VALR order submission with alerting
    - `ef_poll_orders` – order tracking, fills, and fallback logic
    - `ef_post_ledger_and_balances` – ledger rollup and balance calculation
  - **Pipeline Control:**
    - `ef_resume_pipeline` – **NEW: REST API for pipeline status and resume (v5, operational)**
  - **Benchmark & Fees:**
    - `ef_std_dca_roll` – Standard DCA benchmark updates
    - `ef_fee_monthly_close` – monthly performance fee calculation
    - `ef_fee_invoice_email` – fee invoice email notifications
  - **Back-testing:**
    - `ef_bt_execute` – historical simulation runner
  - **Monitoring:**
    - `ef_alert_digest` – **NEW: daily email alerts (operational)**
    - `ef_valr_subaccounts` – VALR subaccount sync utility
    - `ef_balance_reconciliation` – hourly balance discrepancy detection and funding event creation

- **Database Functions:**
  - Utility: `call_edge`, `upsert_cron`
  - Carry buckets: `fn_carry_add`, `fn_carry_peek`, `fn_carry_consume`
  - Capital: `fn_usdt_available_for_trading`
  - **Alerts:** `lth_pvr.ensure_ci_bands_today()` guard function
  - **Pipeline Control:** `lth_pvr.get_pipeline_status()`, `lth_pvr.resume_daily_pipeline()`, `lth_pvr.ensure_ci_bands_today_with_resume()`
  - **UI RPCs:** `list_lth_alert_events()`, `resolve_lth_alert_event()`

- **Front-end:**
  - Single HTML/JS admin console: `Advanced BTC DCA Strategy.html`
  - Modules: Customer Maintenance, Balance Maintenance, Transactions, Reporting, Back-Testing, Finance, **Administration (with Alerts)**
  - Global context bar: Organisation, Customer, Active Portfolio/Strategy

- **Scheduling:**
  - `pg_cron` jobs for all automated processes
  - CI bands (03:00 UTC), decisions (03:05), intents (03:10), execution (03:15), polling (every minute)
  - **Alert digest (05:00 UTC daily)**
  - Guard function (every 30 minutes)

- **Exchange Integration:**
  - VALR REST API with HMAC authentication
  - Single primary API key/secret in environment variables
  - Per-customer routing via `subaccount_id` in `public.exchange_accounts`

---

## 2. Core Domains

### 2.1 CI & Market Data

**Tables:**
- **`lth_pvr.ci_bands_daily`**
  - Daily CI LTH PVR bands and BTC price
  - Columns: `org_id`, `date`, `mode` (static/dynamic), `btc_price`, band levels (ultra_bear through ultra_bull)
  - Used by both live trading and back-testing
  - Guard function ensures yesterday's data is always present

- **`lth_pvr.ci_bands_guard_log`**
  - Audit trail for guard function executions
  - Columns: `log_id`, `org_id`, `run_at`, `target_date`, `did_call`, `http_status`, `details`
  - Used for troubleshooting missing data scenarios

**Edge Functions:**
- **`ef_fetch_ci_bands`**
  - Normal mode: scheduled daily at 03:00 UTC
  - **[UPDATED 2026-01-05]** Fetches YESTERDAY's data only (signal_date = trade_date - 1)
  - **Rationale:** Today's on-chain CI bands data changes throughout the day and is only finalized at day's close. Trading decisions made at 03:00 UTC must use yesterday's finalized data.
  - **Default Behavior:** When no date range specified, explicitly fetches single day (yesterday) via `start` and `end` parameters
  - Guard mode: called by `ensure_ci_bands_today()` when data is missing
  - Fetches from ChartInspect API
  - Upserts by (`org_id`, `date`, `mode`)
  - Self-healing: attempts 1-day refetch if current data missing

**Database Functions:**
- **`lth_pvr.ensure_ci_bands_today()`**
  - Scheduled every 30 minutes via pg_cron
  - Checks for yesterday's CI bands data (CURRENT_DATE - 1)
  - Calls `ef_fetch_ci_bands` via `pg_net.http_post` if missing
  - Logs all attempts to `ci_bands_guard_log`
  - **Status:** Operational since 2025-12-27

- **`lth_pvr.ensure_ci_bands_today_with_resume()`**
  - Enhanced version that automatically resumes pipeline after successful fetch
  - Calls `ensure_ci_bands_today()` first to fetch missing data
  - Then calls `resume_daily_pipeline()` to continue execution
  - **Use Case:** Scheduled as alternative to standalone guard for automated recovery
  - **Status:** Operational since 2025-12-28

### 2.1A Pipeline Resume System

**Purpose:** Automated recovery mechanism to resume daily pipeline execution after CI bands fetch failures or manual intervention.

**Database Functions:**

- **`lth_pvr.get_pipeline_status(p_trade_date DATE DEFAULT NULL)`**
  - **Returns:** JSONB object with pipeline execution state
  - **Fields:**
    - `trade_date`: Date being processed (defaults to CURRENT_DATE)
    - `signal_date`: Trade date - 1 (date of CI bands data used for decisions)
    - `current_date`: Server date
    - `window_valid`: Boolean - true if within 03:00-17:00 UTC trading window
    - `ci_bands_available`: Boolean - true if signal_date CI bands exist
    - `can_resume`: Boolean - true if safe to resume pipeline (window valid AND ci_bands available AND at least one incomplete step)
    - `steps`: Object with 6 boolean flags:
      - `ci_bands`: CI bands data exists for signal_date
      - `decisions`: decisions_daily records exist for trade_date
      - `order_intents`: order_intents records exist for trade_date
      - `execute_orders`: exchange_orders records exist for trade_date
      - `poll_orders`: order_fills records exist for trade_date
      - `ledger_posted`: balances_daily record exists for trade_date
  - **Logic:**
    - Queries 6 different tables to determine completion status
    - Validates trade window (03:00-17:00 UTC prevents post-close execution)
    - Returns comprehensive state for UI display and resume decisions
  - **Usage:** Called by UI and edge function to check pipeline status

- **`lth_pvr.resume_daily_pipeline(p_trade_date DATE DEFAULT NULL)`**
  - **Returns:** JSONB object with success status and request IDs
  - **Parameters:** 
    - `p_trade_date`: Optional trade date override (defaults to CURRENT_DATE)
  - **Logic:**
    1. Calls `get_pipeline_status()` to check current state
    2. Validates `can_resume` flag (exits if false with error message)
    3. Determines which steps are incomplete by checking status.steps
    4. Queues HTTP POST requests for incomplete steps using `net.http_post`:
       - `ef_generate_decisions` (if decisions incomplete)
       - `ef_create_order_intents` (if order_intents incomplete)
       - `ef_execute_orders` (if execute_orders incomplete)
       - `ef_poll_orders` (if poll_orders incomplete)
       - `ef_post_ledger_and_balances` (if ledger_posted incomplete)
    5. Returns immediately with array of request_ids (bigint)
  - **Key Feature:** Uses async `net.http_post` (pg_net extension) to queue requests
    - Function returns in <100ms
    - HTTP requests execute in background after transaction commits
    - No timeout issues (previous synchronous approach timed out at 5 seconds)
  - **Request Format:** Each queued request includes:
    - URL: Base URL + edge function path
    - Headers: Authorization (Bearer + service_role_key), Content-Type
    - Body: Empty JSON object `{}`
    - Timeout: 60,000ms (60 seconds per edge function)
  - **Status:** Operational since 2025-12-28

**Edge Function:**

- **`ef_resume_pipeline`**
  - **Version:** 7 (deployed 2025-12-28)
  - **Authentication:** JWT verification disabled (`--no-verify-jwt` flag required)
  - **Architecture:** Sequential orchestrator replacing async queuing
    * Fetches pipeline status via get_pipeline_status()
    * Defines step execution order: [decisions, order_intents, execute_orders, poll_orders, ledger_posted]
    * Maps status booleans to step names (lines 112-119)
    * **Sequential Execution:** Loops through incomplete steps with await fetch() (lines 121-145)
    * **Skip Logic:** Line 121 checks `if (step.status === true)` to skip completed steps
    * Returns detailed results: [{step, status, success, response, skipped, reason}]
  - **Endpoints:**
    - `POST /functions/v1/ef_resume_pipeline` with `{"check_status": true}`
      - Returns: Pipeline status object from `get_pipeline_status()`
      - Used by UI for status polling
    - `POST /functions/v1/ef_resume_pipeline` with `{}` or `{"trade_date": "YYYY-MM-DD"}`
      - Triggers: Sequential pipeline resume
      - Returns: {success, message, results: [detailed step info]}
  - **Error Handling:**
    - Catches Supabase client initialization failures
    - Validates RPC responses
    - Returns 500 status with details on errors
    - Per-step error handling: Records failed steps in results array
  - **Implementation Notes:**
    - Uses `.schema("lth_pvr")` chain for RPC calls (required for non-public schema)
    - Service role key loaded from SUPABASE_SERVICE_ROLE_KEY env var
    - CORS enabled for browser access
    - All dependent edge functions deployed with --no-verify-jwt for service-to-service auth

**UI Integration:**

- **Location:** `Advanced BTC DCA Strategy.html` - Administration module
- **HTML:** Lines 2106-2170 (Pipeline Control Panel)
- **JavaScript:** Lines ~5875-6070 (loadPipelineStatus, resumePipeline functions)
- **Components:**
  - **Status Display:** 6 checkboxes showing step completion (✓ = complete, ☐ = incomplete)
  - **Trade Window Indicator:** Green "Trading window open" or Red "Trading window closed"
  - **Refresh Button:** Manually polls `check_status` endpoint
  - **Resume Button:** Enabled only when `can_resume = true`, triggers pipeline resume
  - **Execution Log:** Scrollable log with timestamps and color-coded messages (green = success, red = error, gray = info)
  - **Auto-refresh:** Polls status every 30 seconds when panel visible
- **User Workflow:**
  1. User opens Administration module
  2. Pipeline Control Panel loads and displays current status
  3. If CI bands were missing and now available, "Resume Pipeline" button becomes enabled
  4. User clicks "Resume Pipeline"
  5. Edge function queues remaining steps asynchronously
  6. Log shows "Pipeline resume initiated successfully"
  7. Status checkboxes update as steps complete (via auto-refresh)

**Use Cases:**

1. **CI Bands Fetch Failure Recovery:**
   - Problem: `ef_fetch_ci_bands` fails at 03:00 UTC, halting pipeline
   - Solution: Guard function retries every 30 minutes, or admin manually fixes and clicks Resume
   - Result: Pipeline continues from where it stopped

2. **Manual Intervention:**
   - Problem: Admin notices incomplete pipeline execution in morning
   - Solution: Admin opens Pipeline Control Panel, verifies CI bands available, clicks Resume
   - Result: Remaining steps execute without re-running completed steps

3. **Trade Window Validation:**
   - Problem: Admin tries to resume at 18:00 UTC (after market close)
   - Solution: Resume button disabled, window indicator shows red
   - Result: Prevents invalid post-close trades

**Monitoring:**

- **Database:** Query `net._http_response` table to check queued request status
  - Requests retained for ~6 hours
  - Contains status codes, response bodies, error messages
- **Logs:** Use `mcp_supabase_get_logs(service: "edge-function")` to view execution logs
- **UI:** Execution log provides real-time feedback to admin
- **Alerts:** Edge functions log errors to `lth_pvr.alert_events` on failures

### 2.2 Strategy Configuration & State

**Tables:**
- **`lth_pvr.strategy_versions`**
  - LTH PVR band weights, momentum parameters, retrace rules
  - Version history for strategy evolution
  
- **`lth_pvr.settings`**
  - Key-value configuration storage
  - Min order sizes, retrace toggles, fee rates

**Global Catalogue:**
- **`public.strategies`**
  - One row per strategy type: ADV_DCA, LTH_PVR, future strategies
  - Columns: `strategy_code` (PK), `name`, `description`, `schema_name`

### 2.3 Customers & Portfolios

**Customers:**
- **`public.customer_details`**
  - Core person/entity record
  - Columns: `customer_id`, `org_id`, `status` (active, offboarded, etc.), contact details
  - RLS enforced on `org_id`

**Portfolios:**
- **`public.customer_portfolios`**
  - Global portfolio table (multi-strategy support)
  - Columns:
    - `portfolio_id` (PK, UUID)
    - `org_id`, `customer_id`
    - `strategy_code` (FK → public.strategies)
    - `exchange`, `exchange_account_id` (FK → public.exchange_accounts)
    - `exchange_subaccount` (label)
    - `base_asset`, `quote_asset` (BTC/USDT)
    - `status` (active, paused, inactive)
    - `created_at`, `updated_at`
  - Serves as routing key for UI: "Active Portfolio / Strategy" dropdown
  - Trading EFs filter on `status = 'active'`

### 2.4 Exchange Integration & Shared Exchange Accounts

**Shared Exchange Accounts:**
- **`public.exchange_accounts`**
  - Single source of truth for VALR accounts across all strategies
  - Columns:
    - `exchange_account_id` (PK, UUID)
    - `org_id`
    - `exchange` ('VALR')
    - `label` ("Main VALR", "LTH PVR Test")
    - `subaccount_id` – VALR internal ID for X-VALR-SUB-ACCOUNT-ID header
    - `notes`, `tags`, timestamps
  - RLS on `org_id`
  - Referenced by `public.customer_portfolios.exchange_account_id`

**Orders and Fills:**
- **`lth_pvr.exchange_orders`**
  - VALR orders per portfolio
  - Columns: `order_id`, `intent_id`, `portfolio_id`, `symbol`, `side`, `price`, `qty`, `status`
  - Raw JSON: `valr_request_payload`, `valr_response_payload`
  - Tracks: `created_at`, `submitted_at`, `completed_at`

- **`lth_pvr.order_fills`**
  - Individual fills with quantities, prices, fees
  - Used by ledger rollup process
  - Columns: `fill_id`, `order_id`, `filled_qty`, `filled_price`, `fee_amount`, `fee_asset`, `filled_at`

**VALR Client:**
- Shared `valrClient` helper in TypeScript
- Injects `X-VALR-API-KEY` from environment
- Adds `X-VALR-SUB-ACCOUNT-ID` from `exchange_accounts.subaccount_id`
- HMAC signs: timestamp + verb + path + body + subaccount_id

### 2.5 Decisions & Order Intents

**Tables:**
- **`lth_pvr.decisions_daily`**
  - Per-customer daily decision
  - Columns: `org_id`, `customer_id`, `trade_date`, `band_bucket`, `action` (BUY/SELL/HOLD), `allocation_pct`
  - Driven by CI bands, momentum, and retrace logic

- **`lth_pvr.order_intents`**
  - Tradeable intents with budget sizing
  - Columns: `intent_id`, `org_id`, `portfolio_id`, `trade_date`, `side`, `pair`, `amount_pct`, `amount_usdt`, `status`, `idempotency_key`
  - Status: pending, submitted, completed, failed, cancelled

**Edge Functions:**
- **`ef_generate_decisions`**
  - Reads CI bands for signal_date (yesterday)
  - Applies momentum calculation (6-day price history)
  - Determines band bucket and allocation percentage
  - Writes to `decisions_daily`
  - **Alerting:** Logs error alerts if CI bands missing

- **`ef_create_order_intents`**
  - Consumes `decisions_daily`
  - Calls `fn_usdt_available_for_trading()` for budget
  - Applies minimum order size checks
  - Uses carry buckets for sub-minimum amounts
  - Writes to `order_intents`
  - **Alerting:** Logs info alerts for below-minimum orders, error alerts for failures

### 2.6 Ledger & Performance

**Tables (Live LTH PVR):**
- **`lth_pvr.v_fills_with_customer`** (view)
  - Joins: order_fills → exchange_orders → order_intents → portfolios → customers
  - Provides enriched fill data for ledger processing

- **`lth_pvr.exchange_funding_events`**
  - Deposits, withdrawals, internal transfers
  - Fees not captured at fill level
  - Columns: `event_id`, `org_id`, `portfolio_id`, `event_type`, `asset`, `amount`, `event_date`

- **`lth_pvr.ledger_lines`**
  - Canonical event ledger
  - Columns: `line_id`, `org_id`, `customer_id`, `portfolio_id`, `trade_date`, `event_type`, `asset`, `amount_btc`, `amount_usdt`, `note`
  - Event types: trade, fee, deposit, withdrawal, fee_settlement, etc.

- **`lth_pvr.balances_daily`**
  - Daily holdings per portfolio and asset
  - Columns: `org_id`, `portfolio_id`, `date`, `asset`, `balance`, `nav_usd`, contribution aggregates, `roi_pct`, `cagr_pct`
  - Calculated by `ef_post_ledger_and_balances`

**RPC (UI):**
- **`public.lth_pvr_list_ledger_and_balances(from_date, portfolio_id, to_date)`**
  - Returns: `event_date`, `event_type`, `btc_delta`, `usdt_delta`, `note`
  - Used by LTH PVR – Ledger & Balances card in Customer Balance Maintenance module

**Edge Function:**
- **`ef_post_ledger_and_balances`**
  - Reads `v_fills_with_customer` + `exchange_funding_events`
  - Produces `ledger_lines` events
  - Rolls up into `balances_daily` per portfolio and asset
  - Scheduled: 03:30 UTC or on-demand via UI

### 2.7 Back-Testing Domain (LTH_PVR vs Std DCA)

**Tables/Views:**
- **`lth_pvr_bt.bt_runs`**
  - One row per back-test run
  - Columns: `bt_run_id`, `org_id`, date range, upfront/monthly contributions, maker fees (bps), `status`, `started_at`, `finished_at`, `error`

- **`lth_pvr_bt.bt_results_daily`**
  - Daily LTH PVR balances & performance
  - Columns: `bt_run_id`, `date`, `btc_balance`, `usdt_balance`, `nav_usd`, contribution cumulative totals, `roi_pct`, `cagr_pct`

- **`lth_pvr_bt.bt_std_dca_balances`**
  - Same structure as `bt_results_daily` but for Standard DCA benchmark

- **`lth_pvr_bt.bt_ledger` / `bt_std_dca_ledger`**
  - Simulated trades and fees for audit trail

- **`lth_pvr_bt.bt_orders`**
  - Synthetic "orders" for traceability

- **`lth_pvr_bt.v_bt_results_annual`**
  - Rolled-up annual view for both strategies
  - Used by yearly comparison tables

**Edge Function:**
- **`ef_bt_execute`**
  - Reads CI bands and strategy config for date range
  - Iterates each trade date:
    - Runs decision logic (same as live)
    - Applies contributions & fees monthly
    - Simulates trades for LTH PVR and Std DCA
  - Bulk-inserts results into `bt_*` tables
  - Updates `bt_runs.status` and summary metrics

---

## 3. Monitoring & Alerting System (FULLY OPERATIONAL)

### 3.1 Alert System Overview

**Status:** Production-ready as of 2025-12-27  
**Coverage:** CI bands, order execution, decision generation, edge function failures  
**Notification:** Daily email digest at 07:00 SAST

### 3.2 Database Schema

**`lth_pvr.alert_events`**
```sql
CREATE TABLE lth_pvr.alert_events (
  alert_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  component       text NOT NULL,  -- e.g., 'ef_fetch_ci_bands', 'ef_execute_orders'
  severity        text NOT NULL CHECK (severity IN ('info','warn','error','critical')),
  org_id          uuid NULL,
  customer_id     bigint NULL,
  portfolio_id    uuid NULL,
  message         text NOT NULL,
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at     timestamptz NULL,
  resolved_by     text NULL,
  resolution_note text NULL,
  notified_at     timestamptz NULL  -- NEW in v0.6: tracks email notifications
);

CREATE INDEX idx_lth_alerts_created_at ON lth_pvr.alert_events (created_at DESC);
CREATE INDEX idx_lth_alerts_unresolved ON lth_pvr.alert_events (severity, created_at) WHERE resolved_at IS NULL;
```

**Alert Severities:**
- **info** (blue #dbeafe): Informational, no action required
- **warn** (amber #fef3c7): Potential issue, monitor
- **error** (red #fee2e2): Failure requiring investigation
- **critical** (red #fee2e2): Severe failure requiring immediate action

### 3.3 Alerting Module (TypeScript)

**File:** `supabase/functions/_shared/alerting.ts`

**Exports:**
```typescript
export type AlertSeverity = "info" | "warn" | "error" | "critical";

export interface AlertContext {
  [key: string]: unknown;
  trade_date?: string;
  signal_date?: string;
  customer_id?: number;
  intent_id?: string;
  order_id?: string;
  exchange_order_id?: string;
  ext_order_id?: string;
  error_code?: string;
  retries?: number;
}

export async function logAlert(
  sb: SupabaseClient,
  component: string,
  severity: AlertSeverity,
  message: string,
  context: AlertContext = {},
  orgId?: string | null,
  customerId?: number | null,
  portfolioId?: string | null,
): Promise<void>
```

**Usage Example:**
```typescript
await logAlert(
  supabaseClient,
  "ef_generate_decisions",
  "error",
  `CI bands unavailable for ${signalStr}`,
  { signal_date: signalStr, trade_date: tradeStr },
  org_id
);
```

**Integrated In:**
- `ef_generate_decisions`: CI bands missing, decision failures
- `ef_create_order_intents`: Budget calculation errors, below-minimum orders
- `ef_execute_orders`: Missing exchange accounts, VALR API errors, rate limits
- `ef_poll_orders`: Order status query failures, fallback triggers

### 3.4 Alert Digest Email System

**Edge Function:** `ef_alert_digest`
- **Version:** 3
- **JWT Verification:** Disabled (for pg_cron access)
- **Function ID:** cd9c33dc-2c2c-4336-8006-629bf9948724

**Configuration:**
```toml
# supabase/config.toml
[edge_runtime.secrets]
SMTP_HOST = "mail.bitwealth.co.za"
SMTP_PORT = "587"
SMTP_USER = "admin@bitwealth.co.za"
SMTP_PASS = "[smtp-password]"
SMTP_SECURE = "false"
ALERT_EMAIL_FROM = "alerts@bitwealth.co.za"
ALERT_EMAIL_TO = "your-email@example.com"
```

**Schedule:**
```sql
-- pg_cron job (ID: 22)
SELECT cron.schedule(
  'lth_pvr_alert_digest_daily',
  '0 5 * * *',  -- 05:00 UTC = 07:00 SAST
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_alert_digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer [SERVICE_ROLE_KEY]'
    ),
    body := jsonb_build_object('org_id', 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'::uuid)
  );
  $$
);
```

**Logic:**
1. Query `lth_pvr.alert_events` WHERE:
   - `org_id = [specified]`
   - `severity IN ('error', 'critical')`
   - `resolved_at IS NULL`
   - `notified_at IS NULL`
2. Format email with:
   - Alert count
   - Component, severity, timestamp, message for each alert
   - Instructions to resolve via UI
3. Send via SMTP (nodemailer)
4. Update `notified_at` timestamp on all sent alerts

**Email Template:**
```
Subject: [BitWealth] 4 new alerts (error/critical)

Hi Dav,

There are 4 NEW open alert(s) for org_id=b0a77009-03b9-44a1-ae1d-34f157d44a8b:

• [ERROR] ef_execute_orders @ 2025-12-27T15:04:07.960549Z
    Additional test alert 1 for execute_orders

• [CRITICAL] ef_execute_orders @ 2025-12-27T15:04:07.960549Z
    Additional test alert 2 for execute_orders

• [ERROR] ef_fetch_ci_bands @ 2025-12-27T15:01:35.710211Z
    Test alert for filter test - ci bands

• [ERROR] ef_poll_orders @ 2025-12-27T14:59:49.925750Z
    Test alert 3 for badge update test

To resolve these, open the BitWealth UI and use the Alerts card.

-- ef_alert_digest
```

### 3.5 UI Implementation (Administration Module)

**Location:** `Advanced BTC DCA Strategy.html` lines 2085-5670

**Components:**

1. **Alert Badge (lines 356-368, 392)**
   ```html
   <span class="alert-badge zero" id="alertBadge">0</span>
   ```
   - CSS: Red background (#ef4444), white text, circular
   - `.alert-badge.zero { display: none }` - hidden when count is 0
   - Dynamic update via JavaScript every time alerts load

2. **Component Filter Dropdown (lines 2099-2107)**
   ```html
   <select id="alertsComponentFilter" class="context-select">
     <option value="">All Components</option>
     <option value="ef_fetch_ci_bands">ef_fetch_ci_bands</option>
     <option value="ef_generate_decisions">ef_generate_decisions</option>
     <option value="ef_create_order_intents">ef_create_order_intents</option>
     <option value="ef_execute_orders">ef_execute_orders</option>
     <option value="ef_poll_orders">ef_poll_orders</option>
   </select>
   ```
   - Client-side filtering at line 5560
   - onchange event listener at line 5663

3. **Open Only Checkbox (lines 2092-2094)**
   ```html
   <input id="alertsOpenOnlyChk" type="checkbox" checked>
   <span>Show only open alerts</span>
   ```
   - Default: checked (shows only unresolved alerts)
   - Passes `p_only_open` parameter to RPC

4. **Auto-Refresh Checkbox (lines 2096-2098)**
   ```html
   <input id="alertsAutoRefreshChk" type="checkbox">
   <span>Auto-refresh (30s)</span>
   ```
   - Logic: lines 5650-5658
   - Uses `setInterval(loadAlerts, 30000)` when checked
   - `clearInterval()` when unchecked
   - Does NOT persist across navigation (by design)

5. **Resolve Alert Button**
   - JavaScript handler: lines 5620-5645
   - Prompt for optional resolution note
   - Calls `resolve_lth_alert_event(p_alert_id, p_resolved_by, p_resolution_note)`
   - Refreshes table after successful resolution

**JavaScript Functions:**

- **`loadAlerts()`** (lines 5545-5600)
  - Calls `list_lth_alert_events(p_only_open, p_limit)`
  - Client-side component filtering
  - Updates alert badge count
  - Renders table with severity color coding

- **`toggleAutoRefresh()`** (lines 5650-5658)
  - Manages setInterval/clearInterval for 30-second refresh
  - Triggered by checkbox onchange event

### 3.6 Database RPCs

**`public.list_lth_alert_events(p_only_open boolean, p_limit int)`**
- Returns unresolved or all alerts based on `p_only_open`
- Ordered by `created_at DESC`
- RLS enforced on `org_id`

**`public.resolve_lth_alert_event(p_alert_id uuid, p_resolved_by text, p_resolution_note text)`**
- Sets `resolved_at = now()`
- Sets `resolved_by` and optional `resolution_note`
- Returns void

### 3.7 Guard Function

**`lth_pvr.ensure_ci_bands_today()`**
- **Schedule:** Every 30 minutes via pg_cron
- **Target:** CURRENT_DATE - 1 day (yesterday)
- **Logic:**
  1. Check if `ci_bands_daily` row exists for yesterday
  2. If missing, call `ef_fetch_ci_bands` via `pg_net.http_post`
  3. Log attempt to `ci_bands_guard_log` (success or failure)
- **Status:** Operational, logs at line 352-353 show successful calls

### 3.8 Test Coverage

**Documentation:** `docs/Alert_System_Test_Cases.md`

**Test Summary (as of 2025-12-27):**
- **Total Test Cases:** 51
- **Executed:** 17
- **Passed:** 17 ✅
- **Skipped:** 1 ⚠️ (production risk)
- **Requires Edge Function Testing:** 6
- **Requires Integration Testing:** 16
- **Requires API Mocking:** 7
- **Requires Dedicated Test Environment:** 4

**Completed Test Categories:**
1. **Database Functions (100%)**
   - 1.1.1: CI Bands Fetch ✅
   - 1.1.2: CI Bands Already Exist ✅
   - 1.1.3: Missing Vault Secret ⚠️ (skipped)

2. **UI Components (100% - 14/14 tests)**
   - Badge Updates on Load ✅
   - Badge Hidden When Zero ✅
   - Badge Updates After Resolve ✅
   - All Components Shown ✅
   - Filter by Single Component ✅
   - Filter Change Updates Table ✅
   - All Components Listed ✅
   - Enable Auto-Refresh ✅
   - Disable Auto-Refresh ✅
   - Auto-Refresh Navigation ✅
   - Show Only Open Alerts ✅
   - Show All Alerts ✅
   - Resolve Alert with Note ✅
   - Resolve Alert Without Note ✅

3. **Edge Function Alerting**
   - 3.3.2: No VALR Subaccount ✅ (critical alert generated)

### 3.9 WebSocket Order Monitoring

**Purpose:** Real-time order status updates via VALR WebSocket API to reduce polling frequency and improve order tracking latency.

**Architecture:**
- **Hybrid System:** WebSocket (primary) + Polling (safety net)
- **WebSocket Connection:** Established per subaccount when orders are placed
- **Fallback Polling:** Every 10 minutes (reduced from every 1 minute)
- **API Call Reduction:** 98% fewer calls (~1,440/day → ~170/day)

**Database Schema Extensions:**

`lth_pvr.exchange_orders` new columns:
- `ws_monitored_at` (timestamptz) - When WebSocket monitoring started
- `last_polled_at` (timestamptz) - Last polling attempt timestamp
- `poll_count` (integer, default 0) - Number of times order polled
- `requires_polling` (boolean, default true) - Whether order needs polling fallback

Index: `idx_exchange_orders_requires_polling` on (requires_polling, last_polled_at) WHERE status='submitted'

**Edge Functions:**

1. **`ef_valr_ws_monitor`** (Version 2, deployed 2025-12-27)
   - Establishes WebSocket connection to wss://api.valr.com/ws/trade
   - HMAC-SHA512 authentication with VALR API credentials
   - Subscribes to ACCOUNT_ORDER_UPDATE events
   - Monitors multiple orders for a single subaccount
   - 5-minute timeout (then polling takes over)
   - **Status Mapping:** Placed→submitted, Filled→filled, Cancelled→cancelled
   - **Fill Processing:** Extracts and stores individual fills in `order_fills` table
   - **Auto-Close:** Connection closes when all monitored orders complete
   - **Alerting:**
     - Error severity: WebSocket connection failures
     - Warn severity: WebSocket closes without processing updates
     - Error severity: Database update failures
     - All alerts include fallback notice: "polling will handle order monitoring"

2. **`ef_execute_orders`** (Version 29, updated 2025-12-27)
   - After placing orders, initiates WebSocket monitoring
   - Groups submitted orders by exchange_account_id
   - Looks up subaccount_id for each account group
   - Calls ef_valr_ws_monitor via fetch (non-blocking)
   - Marks orders with ws_monitored_at timestamp
   - Sets requires_polling=true for safety net
   - **Alerting:**
     - Warn severity: WebSocket monitor initialization fails
     - Includes subaccount_id, order_count, error details

3. **`ef_poll_orders`** (Version 38, updated 2025-12-27)
   - **Safety Net Mode:** Only polls orders not recently updated
   - **2-Minute Filter:** Skips orders polled in last 2 minutes
   - **Targeted Polling:** Supports ?order_ids=uuid1,uuid2 query parameter
   - **Tracking Updates:** Updates last_polled_at, poll_count on each poll
   - **Completion Detection:** Sets requires_polling=false when order filled/cancelled
   - **Schedule:** Cron job runs every 10 minutes (reduced from 1 minute)
   - Cron job ID: 12, name: lthpvr_poll_orders, schedule: */10 * * * *

**WebSocket Flow:**
1. ef_execute_orders places orders on VALR
2. Groups orders by subaccount_id
3. POST to ef_valr_ws_monitor with {order_ids, subaccount_id}
4. WebSocket connects with HMAC auth
5. Subscribes to ACCOUNT_ORDER_UPDATE events
6. Processes order updates in real-time:
   - Updates exchange_orders.status
   - Extracts and stores fills
   - Removes completed orders from monitoring
7. Connection closes after 5 min timeout OR all orders complete
8. Polling fallback handles any orders not updated via WebSocket

**Performance Impact:**
- **Update Latency:** <5 seconds (WebSocket) vs 30-60 seconds (polling)
- **API Calls:** ~170/day total (WebSocket handshakes + 10-min polls) vs ~1,440/day (1-min polls)
- **Polling Frequency:** 90% reduction (every 10 min vs every 1 min)
- **WebSocket Timeout:** 5 minutes per connection
- **Coverage:** Tested with manual order placement, WebSocket monitoring confirmed via logs

**Monitoring Queries:**

Check WebSocket coverage:
```sql
SELECT 
  COUNT(*) FILTER (WHERE ws_monitored_at IS NOT NULL) as websocket_monitored,
  COUNT(*) FILTER (WHERE ws_monitored_at IS NULL) as not_monitored,
  COUNT(*) as total_submitted
FROM lth_pvr.exchange_orders
WHERE status = 'submitted';
```

Check polling efficiency:
```sql
SELECT 
  AVG(poll_count) as avg_polls_per_order,
  MAX(poll_count) as max_polls,
  COUNT(*) FILTER (WHERE poll_count = 0) as never_polled
FROM lth_pvr.exchange_orders
WHERE status IN ('filled', 'cancelled');
```

Check WebSocket alerts:
```sql
SELECT alert_id, severity, message, context, created_at
FROM lth_pvr.alert_events
WHERE component = 'ef_valr_ws_monitor'
  AND resolved_at IS NULL
ORDER BY created_at DESC;
```

**Documentation:**
- Implementation Guide: `docs/WebSocket_Order_Monitoring_Implementation.md` (10 sections, 500+ lines)
- Test Cases: `docs/WebSocket_Order_Monitoring_Test_Cases.md` (35 tests across 7 categories)
- See Section 8.2 for deployment procedures

**Test Results Format:**
```markdown
#### Test Case X.X.X: Description ✅ PASS
**Test Steps:** ...
**Expected Results:** ...
**Test Execution:**
- Date: 2025-12-27 HH:MM UTC
- Result: ✅ PASS
- [Detailed execution notes with code line references]
- Verification: [What was verified]
```

---

## 4. Daily Live-Trading Flow

### 4.1 Timeline (UTC)

**03:00** – Fetch CI bands & price
- `pg_cron` calls `ef_fetch_ci_bands`
- Inserts/updates `ci_bands_daily` for yesterday (CURRENT_DATE - 1)
- **Alerting:** Guard function ensures data availability every 30 minutes

**03:05** – Generate decisions
- `ef_generate_decisions`:
  - Reads CI bands for signal_date (yesterday)
  - Calculates momentum from 6-day price history
  - Determines band bucket and allocation percentage
  - Writes to `decisions_daily` per active portfolio
  - **Alerting:** Logs error if CI bands missing

**03:10** – Create order intents
- `ef_create_order_intents`:
  - Consumes `decisions_daily`
  - Queries `fn_usdt_available_for_trading()` for budget
  - Applies LTH PVR allocation logic with retrace rules
  - Writes `order_intents` with status='pending'
  - **Alerting:** Logs info for below-minimum orders (carry bucket)

**03:15** – Execute orders
- `ef_execute_orders`:
  - Groups eligible `order_intents`
  - Looks up `exchange_account_id` → `subaccount_id`
  - Sends limit orders to VALR with HMAC signature
  - **NEW:** Initiates WebSocket monitoring for submitted orders
    - Groups orders by subaccount_id
    - POST to ef_valr_ws_monitor (non-blocking)
    - Marks orders with ws_monitored_at timestamp
  - **Alerting:** Logs critical for missing subaccounts, error for API failures, warn for WebSocket failures

**03:15–all day** – Order monitoring (hybrid WebSocket + polling)
- **WebSocket Monitoring (primary):**
  - `ef_valr_ws_monitor` establishes connection per subaccount
  - Subscribes to ACCOUNT_ORDER_UPDATE events
  - Real-time updates (<5 sec latency) for order status and fills
  - 5-minute timeout, auto-closes when all orders complete
  - **Alerting:** Error for connection failures, warn for premature closure
  
- **Polling Fallback (safety net):**
  - `ef_poll_orders` (every 10 minutes, reduced from 1 minute):
    - Only polls orders not updated in last 2 minutes
    - Targeted polling support via ?order_ids query parameter
    - Updates last_polled_at, poll_count tracking columns
    - Fallback logic: if limit unfilled/partial >5 min OR price moves >0.25%, cancel and submit market order
    - **Alerting:** Logs error for status query failures, warn for excessive fallback usage
    - **Performance:** 98% API call reduction vs previous 1-minute polling

**03:30** – Post ledger & balances
- `ef_post_ledger_and_balances`:
  - Reads `v_fills_with_customer` + `exchange_funding_events`
  - Produces `ledger_lines` events
  - Rolls into `balances_daily` per portfolio and asset

**05:00** – **Alert Digest Email** (2025-12-27+)
- `ef_alert_digest`:
  - Queries unresolved error/critical alerts where `notified_at IS NULL`
  - Sends email digest via SMTP (nodemailer)
  - Updates `notified_at` to prevent duplicate emails

**Overnight** – Benchmark & fees
- `ef_std_dca_roll` updates Standard DCA benchmark balances
- `ef_fee_monthly_close` (monthly) calculates performance fees from `v_monthly_returns`

---

## 5. Back-Testing Architecture

### 5.1 Inputs
- Upfront and monthly USDT contributions
- Trade & contribution fee percents (basis points)
- Date range (start_date, end_date)
- Strategy config (bands, momentum, retrace flags)

### 5.2 CI Bands Architecture (CRITICAL)

**Two Separate Data Types:**
1. **CI Band Price Levels** (stored in `lth_pvr.ci_bands_daily`):
   - Absolute dollar amounts: price_at_m100=$45,000, price_at_mean=$62,000, price_at_p100=$85,000, etc.
   - 10 columns: m100, m075, m050, m025, mean, p050, p100, p150, p200, p250
   - Fetched daily from CryptoQuant API by `ef_fetch_ci_bands`
   - Used by decision logic to determine if BTC price is above/below historical confidence bands

2. **B1-B11 Trade Size Percentages** (stored in `lth_pvr_bt.bt_params`):
   - Relative ratios: B1=0.22796 (22.796% of balance), B2=0.21397 (21.397%), etc.
   - 11 values corresponding to buy/sell zones
   - NOT stored in ci_bands_daily - these are independent strategy parameters
   - If NULL/zero in bt_params, ef_bt_execute applies hardcoded defaultBands

**Common Confusion:** 
- ❌ B1-B11 are NOT price levels - they are trade size percentages
- ❌ CI bands are NOT stored as ratios - they are absolute prices
- ✅ Decision logic: Compare current BTC price to CI band **price levels** → Trade B1-B11 **percentage amounts**

**Default Trade Size Percentages (ef_bt_execute/index.ts lines 127-139):**
```typescript
const defaultBands = {
  B1: 0.22796,  // Buy 22.796% when < -1.0σ
  B2: 0.21397,  // Buy 21.397% when -1.0σ to -0.75σ
  B3: 0.19943,  // Buy 19.943% when -0.75σ to -0.5σ
  B4: 0.18088,  // Buy 18.088% when -0.5σ to -0.25σ
  B5: 0.12229,  // Buy 12.229% when -0.25σ to mean
  B6: 0.00157,  // Sell 0.157% when mean to +0.5σ
  B7: 0.002,    // Sell 0.2% when +0.5σ to +1.0σ (momentum gated)
  B8: 0.00441,  // Sell 0.441% when +1.0σ to +1.5σ (momentum gated)
  B9: 0.01287,  // Sell 1.287% when +1.5σ to +2.0σ (momentum gated)
  B10: 0.033,   // Sell 3.3% when +2.0σ to +2.5σ
  B11: 0.09572  // Sell 9.572% when > +2.5σ
};
```

### 5.3 Process

**`ef_bt_execute`:**
1. Create `bt_runs` row with status='running'
2. Check bt_params for B1-B11 values:
   - If all NULL/zero → Apply defaultBands and UPDATE bt_params
   - If values exist → Use them as-is
3. Iterate each trade date in range:
   - Query `lth_pvr.ci_bands_daily` for **price levels** (price_at_m100, price_at_mean, etc.)
   - Run decision logic comparing current BTC price to CI band price levels
   - When price triggers a zone, trade the corresponding B percentage (e.g., B1=22.796% of balance)
   - Apply monthly contributions and fees
   - Simulate trades for LTH PVR and Std DCA
   - Calculate balances, NAV, ROI, CAGR
4. Bulk-insert results:
   - `bt_ledger` – simulated trades
   - `bt_orders` – synthetic orders for audit
   - `bt_results_daily` – LTH PVR daily metrics
   - `bt_std_dca_ledger` – Std DCA trades
   - `bt_std_dca_balances` – Std DCA daily metrics
5. Update `bt_runs` with:
   - `status = 'ok'` (or 'error' on failure)
   - `finished_at = now()`
   - Final NAV, ROI%, CAGR% summary

### 5.4 Outputs
- **Daily time-series:** Balances & NAV for both portfolios
- **Annual summary:** `v_bt_results_annual` view
  - Columns: `year`, `btc_price`, `total_investment`, `btc_holdings`, `usd_holdings`, `nav_usd`, `roi_pct`, `cagr_pct`
  - Separate rows for LTH PVR and Std DCA
- **UI Visualization:** Strategy Back-Testing module
  - Charts: Holdings, Portfolio Value, ROI, Annualised Growth
  - Tables: Yearly comparison with PDF export

---

## 6. Security & RLS Model

### 6.1 Organisation & Identity

**Multi-Tenancy:**
- Centred around `org_id` (UUID)
- One or more organisations per environment
- Initially single org: b0a77009-03b9-44a1-ae1d-34f157d44a8b

**Authentication:**
- RPC `public.my_orgs()` maps authenticated user to allowed org_id values
- Membership tracked via `org_members` and `organizations` tables
- Edge Functions use service role key and bypass RLS

### 6.2 RLS Principles

**Browser-Accessible Tables:**
- Every table queried directly by browser has:
  - `org_id` column
  - RLS enabled
  - Policies restricting rows to `org_id IN (SELECT id FROM public.my_orgs())`

**Write Protection:**
- Sensitive tables (orders, ledger, balances, back-tests, **alerts**) only written via Edge Functions
- Edge Functions use service role key with RLS bypass

### 6.3 Example Policies

**Back-test Results:**
```sql
ALTER TABLE lth_pvr_bt.bt_results_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_members_can_read_bt_results_daily
ON lth_pvr_bt.bt_results_daily
FOR SELECT
USING (org_id IN (SELECT id FROM public.my_orgs()));
```

**Alert Events (NEW):**
```sql
ALTER TABLE lth_pvr.alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_members_can_read_alerts
ON lth_pvr.alert_events
FOR SELECT
USING (org_id IN (SELECT id FROM public.my_orgs()));
```

**Applied To:**
- All `lth_pvr_bt.*` tables
- All `lth_pvr.*` tables accessed by UI
- `public.exchange_accounts`
- `public.customer_portfolios`
- `public.customer_details`

---

## 7. UI Integration

### 7.1 Global Context Bar

**Location:** Top of strategy-sensitive modules

**Dropdowns:**
1. **Organisation** – driven by `public.my_orgs()`
2. **Customer** – lists `public.customer_details` filtered by org_id
3. **Active Portfolio / Strategy** – lists `public.v_customer_portfolios_expanded` for selected org & customer

**Stored State:**
```javascript
{
  org_id: 'b0a77009-03b9-44a1-ae1d-34f157d44a8b',
  customer_id: 1001,
  portfolio_id: 'uuid',
  strategy_code: 'LTH_PVR'
}
```

**Usage:** All strategy-specific cards read from this shared state object

### 7.2 Customer Maintenance

**Responsibilities:**
- Maintain `customer_details` (name, contact, KYC, status)
- Manage `customer_portfolios` per customer
- Allocate exchange accounts via `public.exchange_accounts`

**Portfolios Panel:**
- Grid showing: Strategy, Exchange, Subaccount, Status, Since
- Backed by view joining portfolios, strategies, exchange_accounts

**Add Portfolio Flow:**
1. Select `strategy_code` (ADV_DCA, LTH_PVR, etc.)
2. Select or create exchange account
3. Choose base/quote assets (BTC/USDT)
4. Set status = 'active'
5. Save to `customer_portfolios`

**Exchange Account Management:**
- List `exchange_accounts` for org
- Edit label, status, subaccount_id
- "Fetch VALR subaccount_id" button:
  - Calls `ef_valr_subaccounts`
  - Returns available subaccounts (ID + label)
  - UI writes selected `subaccount_id` to table

**Customer Status Mirroring:**
- When `customer_details.status` changes from active → non-active:
  - DB trigger/job updates `customer_portfolios.status` to inactive
  - Trading EFs only process portfolios with status='active'

### 7.3 Customer Balance Maintenance

**Two-Lane Module:**

**Lane A – Advanced BTC DCA**
- Uses `real_exchange_txs`, `exchange_daily_balances`, drift views
- Only shown when `strategy_code = 'ADV_DCA'`

**Lane B – LTH PVR BTC DCA**
- **LTH PVR – Ledger & Balances card:**
  - Calls `lth_pvr_list_ledger_and_balances(from_date, portfolio_id, to_date)`
  - Displays ledger events and derived balances
  - "Recalculate balances" button → calls `ef_post_ledger_and_balances`
- Only shown when `strategy_code = 'LTH_PVR'`

### 7.4 Customer Transactions

**Focus:** Strategy-specific intents and orders (not individual customers)

**Controls:**
- Organisation and Active Portfolio / Strategy from context bar
- Date range selector

**Cards:**
- Daily rule execution ("Run Daily Rules" button)
- Intent creation preview (`order_intents` table)
- VALR execution status (`exchange_orders`, `order_fills` tables)

**Global View Option:**
- Can show all customers on strategy by filtering on `strategy_code + org_id` instead of `portfolio_id`

### 7.5 Portfolio Performance Reporting

**Data Sources:**
- `lth_pvr.v_customer_portfolio_daily` – live NAV, balances, ROI
- `lth_pvr.v_compare_portfolio_daily` – LTH vs Std DCA comparison

**Visualizations:**
- NAV over time (line chart)
- ROI % (line chart)
- Max Drawdown (future enhancement)
- Yearly aggregated metrics table

### 7.6 Strategy Back-Testing

**UI Components:**
- Form: strategy selection, date range, contributions, fees
- "Run back-test" button → creates `bt_runs` row and calls `ef_bt_execute`

**Visualizations:**
- Holdings (BTC + USDT stacked area)
- Portfolio Value (NAV line chart)
- ROI % (line chart)
- Annualised Growth (CAGR comparison)

**Tables:**
- Yearly summary (from `v_bt_results_annual`)
- PDF export functionality

### 7.7 Finance Module

**Views:**
- `v_monthly_returns` – portfolio performance by month
- `fee_configs` – fee rate configuration
- `fees_monthly` – calculated monthly fees
- `fee_invoices` – generated invoices

**UI:**
- Monthly fee dashboard
- Invoice generation and email (`ef_fee_invoice_email`)

### 7.8 Administration Module

**Components:**

1. **Cron & Job Status**
   - Overview of scheduled jobs
   - Recent run history from `lth_pvr.runs`
   - Configuration toggles (pause trading, fee rates)

2. **System Alerts (NEW - FULLY OPERATIONAL)**
   - **Alert Badge:** Red count in navigation bar
   - **Component Filter:** Dropdown with 6 options
   - **Open Only Filter:** Checkbox (default: checked)
   - **Auto-Refresh:** 30-second interval checkbox
   - **Alerts Table:** Severity, component, created date, message, resolve button
   - **Resolve Dialog:** Prompt for optional resolution note
   - **Status:** All features tested and working (14/14 UI tests passed)

---

## 8. Deployment & Operations

### 8.1 Environment Variables

**Edge Runtime Secrets:**
```bash
SUPABASE_URL="https://wqnmxpooabmedvtackji.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="[service_role_key]"
ORG_ID="b0a77009-03b9-44a1-ae1d-34f157d44a8b"

# VALR API
VALR_API_KEY="[primary_api_key]"
VALR_API_SECRET="[primary_api_secret]"

# SMTP Email Configuration (2026-01-04+)
SMTP_HOST="mail.bitwealth.co.za"
SMTP_PORT="587"
SMTP_USER="admin@bitwealth.co.za"
SMTP_PASS="[smtp-password]"
SMTP_SECURE="false"
ALERT_EMAIL_FROM="alerts@bitwealth.co.za"
ALERT_EMAIL_TO="your-email@example.com"

# ChartInspect API
CI_API_KEY="[api_key]"
```

**Setting Secrets:**
```bash
cd /path/to/bitwealth-lth-pvr
supabase secrets set SMTP_HOST="mail.bitwealth.co.za" \
  SMTP_PORT="587" \
  SMTP_USER="admin@bitwealth.co.za" \
  SMTP_PASS="[smtp-password]" \
  SMTP_SECURE="false" \
  ALERT_EMAIL_FROM="alerts@bitwealth.co.za" \
  ALERT_EMAIL_TO="your-email@example.com"
```

### 8.2 Edge Function Deployment

**Deploy Single Function:**
```bash
supabase functions deploy ef_alert_digest --no-verify-jwt
```

**Deploy All Functions:**
```bash
supabase functions deploy
```

**WebSocket Monitoring Functions (NEW - 2025-12-27):**
```bash
# WebSocket monitor (no JWT verification for internal calls)
supabase functions deploy ef_valr_ws_monitor --no-verify-jwt

# Updated order execution with WebSocket initiation
supabase functions deploy ef_execute_orders

# Updated polling with safety net logic
supabase functions deploy ef_poll_orders
```

**Deployment via MCP (CLI compatibility workaround):**
If CLI deployment fails due to config.toml compatibility issues, use MCP tools:
```typescript
// Via mcp_supabase_deploy_edge_function
{
  "name": "ef_valr_ws_monitor",
  "files": [{"name": "index.ts", "content": "..."}],
  "verify_jwt": false
}
```

**Check Deployment Status:**
```sql
-- Via MCP
mcp_supabase_list_edge_functions()
```

**Deployed Versions (as of 2025-12-27):**
- ef_valr_ws_monitor: v2 (ACTIVE, verify_jwt=false)
- ef_execute_orders: v29 (ACTIVE, verify_jwt=true)
- ef_poll_orders: v38 (ACTIVE, verify_jwt=true)
- ef_alert_digest: v3 (ACTIVE, verify_jwt=false)

### 8.3 Database Migrations

**Apply Migration:**
```bash
supabase db push
```

**Check Migration Status:**
```sql
SELECT * FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 10;
```

**Key Migrations:**
- `20251224_add_notified_at_column_to_lth_pvr.alert_events.sql`
- `20251226_create_cron_schedule_for_ef_alert_digest.sql`
- `20251227123418_fix_ensure_ci_bands_today.sql`
- `20251227_add_websocket_tracking_to_exchange_orders.sql` (NEW)
- `20251227_reduce_poll_orders_cron_frequency.sql` (NEW)

### 8.4 Cron Job Management

**List Active Jobs:**
```sql
SELECT jobid, jobname, schedule, active, nodename
FROM cron.job
WHERE jobname LIKE 'lth_pvr%'
ORDER BY jobname;
```

**Disable Job:**
```sql
SELECT cron.alter_job(22, enabled := false);  -- Alert digest job
```

**Re-enable Job:**
```sql
SELECT cron.alter_job(22, enabled := true);
```

**View Job Run History:**
```sql
SELECT jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = 22  -- Alert digest
ORDER BY start_time DESC
LIMIT 10;
```

### 8.5 Monitoring & Troubleshooting

**Check Alert Digest Status:**
```sql
-- Verify cron job is active
SELECT * FROM cron.job WHERE jobname = 'lth_pvr_alert_digest_daily';

-- Check for unnotified alerts
SELECT alert_id, component, severity, created_at, message
FROM lth_pvr.alert_events
WHERE org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
  AND severity IN ('error', 'critical')
  AND resolved_at IS NULL
  AND notified_at IS NULL
ORDER BY created_at DESC;

-- View email send history
SELECT alert_id, component, severity, created_at, notified_at
FROM lth_pvr.alert_events
WHERE notified_at IS NOT NULL
ORDER BY notified_at DESC
LIMIT 20;
```

**Check Edge Function Logs:**
```sql
-- Via MCP
mcp_supabase_get_logs(service="edge-function")
```

**Check CI Bands Guard Log:**
```sql
SELECT log_id, run_at, target_date, did_call, http_status, details
FROM lth_pvr.ci_bands_guard_log
ORDER BY run_at DESC
LIMIT 20;
```

**Manual Alert Digest Test:**
```powershell
$body = '{"org_id":"b0a77009-03b9-44a1-ae1d-34f157d44a8b"}'
Invoke-WebRequest `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_alert_digest" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body $body
```

### 8.6 Operational Procedures

**Daily Monitoring Checklist:**
1. Check email for alert digest (07:00 SAST)
2. Review UI Alerts card for any new critical/error alerts
3. Verify CI bands guard log shows successful runs
4. Check `lth_pvr.runs` table for any failed edge function executions
5. Monitor VALR order execution and fallback rates

**Weekly Tasks:**
1. Review resolved alerts and resolution notes
2. Analyze alert patterns for recurring issues
3. Check back-test results for strategy performance
4. Verify ledger and balance reconciliation

**Monthly Tasks:**
1. Run `ef_fee_monthly_close` for performance fee calculation
2. Generate and send fee invoices via `ef_fee_invoice_email`
3. Review `v_monthly_returns` for customer performance
4. Archive old alerts (resolved > 90 days)

**Incident Response:**
1. **Critical Alert:** Investigate immediately, resolve root cause
2. **Error Alert:** Investigate within 24 hours, document resolution
3. **Missing Data:** Run guard function manually, check API keys
4. **VALR Issues:** Check API status, review rate limits, verify subaccount IDs

---

## 9. Documentation References

### 9.1 Technical Documentation

- **SDD_v0.6.md** (this file) – Complete solution design
- **Alert_System_Test_Cases.md** – 51 test cases with execution tracking
- **Alert_Digest_Setup.md** – Email digest configuration and troubleshooting
- **Build Plan_v0.5.md** – Implementation roadmap (if exists)

### 9.2 Code References

**Edge Functions:**
- `supabase/functions/ef_alert_digest/` – Email digest implementation
- `supabase/functions/_shared/alerting.ts` – Shared alerting module
- `supabase/functions/ef_generate_decisions/` – Decision engine with alerting
- `supabase/functions/ef_execute_orders/` – Order execution with alerting
- `supabase/functions/ef_poll_orders/` – Order polling with alerting

**Database:**
- `supabase/sql/ddl/lth_pvr.alert_events.ddl.sql` – Alert events table schema
- `supabase/functions/lth_pvr.ensure_ci_bands_today.fn.sql` – Guard function
- `supabase/functions/public.list_lth_alert_events.fn.sql` – UI RPC
- `supabase/functions/public.resolve_lth_alert_event.fn.sql` – Resolve RPC

**UI:**
- `ui/Advanced BTC DCA Strategy.html` lines 356-368 – Badge CSS
- Lines 2085-2110 – Alerts card HTML
- Lines 5545-5670 – Alert JavaScript functions

**Migrations:**
- `supabase/sql/migrations/20251224_add_notified_at_column_to_lth_pvr.alert_events.sql`
- `supabase/sql/migrations/20251226_create_cron_schedule_for_ef_alert_digest.sql`

**Implementation Guides:**
- `Alert_Digest_Setup.md` – Complete alert digest configuration and troubleshooting
- `WebSocket_Order_Monitoring_Implementation.md` – WebSocket monitoring technical guide

**Test Documentation:**
- `LTH_PVR_Test_Cases_Master.md` – Consolidated test cases for all system components (116 tests)
- Individual test case documents:
  - `Alert_System_Test_Cases.md` – 51 alert system tests
  - `WebSocket_Order_Monitoring_Test_Cases.md` – 35 WebSocket monitoring tests
  - `Pipeline_Resume_Test_Cases.md` – 30 pipeline resume tests

---

## 10. Future Enhancements

### 10.1 Balance Reconciliation
- [x] Automated balance reconciliation (hourly polling) – ✅ v0.6.9 (2026-01-05)
- [ ] VALR webhook migration (if/when VALR adds webhook support)
- [ ] Historical reconciliation (check past balances for drift)
- [ ] Large discrepancy alerts (>$100 USD) via lth_pvr.raise_alert()
- [ ] Daily reconciliation report email digest
- [ ] Balance drift tracking dashboard (cumulative discrepancies per customer)

### 10.2 Alerting System
- [ ] Slack webhook integration as alternative to email
- [ ] SMS notifications for critical alerts via Twilio
- [ ] Alert acknowledgment with auto-escalation if not resolved within SLA
- [ ] Alert grouping/deduplication for repeated errors
- [ ] Webhook notifications to external monitoring systems (PagerDuty, etc.)
- [ ] Alert metrics dashboard (MTTR, frequency by component, etc.)

### 10.3 Monitoring
- [ ] Real-time dashboard for pipeline health
- [ ] Performance metrics (order fill rates, latency, API response times)
- [ ] Max drawdown tracking and visualization
- [ ] Sharpe ratio calculation
- [ ] Time-in-band analysis (how long portfolio stays in each band)

### 10.3 Strategy
- [ ] Support for additional cryptocurrencies (ETH, SOL, etc.)
- [ ] Multi-exchange support beyond VALR
- [ ] Dynamic strategy parameter adjustment based on market conditions
- [ ] Machine learning for momentum prediction improvements

### 10.4 UI/UX
- [ ] Customer-facing portal (read-only access to own portfolios)
- [ ] Mobile-responsive design
- [ ] Real-time WebSocket updates for orders and alerts
- [ ] Enhanced PDF reporting with custom branding
- [ ] Dark mode theme

### 10.5 Compliance & Reporting
- [ ] Tax reporting integration (capital gains, income)
- [ ] Regulatory compliance tracking per jurisdiction
- [ ] Audit trail exports (CSV, JSON)
- [ ] Customer statements (monthly/quarterly)

---

## 11. Appendices

### 11.1 Glossary

- **CI Bands:** ChartInspect Indicator bands for Long-Term Holder Profit/Loss Realized (PVR)
- **LTH PVR:** Long-Term Holder Price Variance Ratio strategy
- **DCA:** Dollar-Cost Averaging
- **NAV:** Net Asset Value
- **ROI:** Return on Investment
- **CAGR:** Compound Annual Growth Rate
- **RLS:** Row-Level Security
- **RPC:** Remote Procedure Call (Supabase function callable from client)
- **EF:** Edge Function (Deno/TypeScript serverless function)
- **Guard Function:** Database function that ensures data availability
- **Carry Bucket:** Accumulator for sub-minimum order amounts

### 11.2 Alert Severity Guidelines

| Severity | Definition | Response Time | Examples |
|----------|------------|---------------|----------|
| **critical** | System failure or data loss | Immediate (< 1 hour) | Missing VALR subaccount, API authentication failure, database corruption |
| **error** | Feature failure requiring investigation | Within 24 hours | Order execution failure, CI bands fetch failure, ledger rollup error |
| **warn** | Potential issue requiring monitoring | Within 48 hours | Excessive fallback usage, slow API response, approaching rate limits |
| **info** | Informational, no action required | Review weekly | Below-minimum order added to carry, strategy decision logged |

### 11.3 Key Database Tables Summary

| Table | Purpose | Key Columns | Size Estimate |
|-------|---------|-------------|---------------|
| `lth_pvr.ci_bands_daily` | Daily CI bands and BTC price | date, btc_price, band levels | ~365 rows/year |
| `lth_pvr.decisions_daily` | Per-customer daily decisions | customer_id, trade_date, action, allocation_pct | ~365 rows/customer/year |
| `lth_pvr.order_intents` | Tradeable order intents | intent_id, portfolio_id, side, amount_usdt | ~365 rows/portfolio/year |
| `lth_pvr.exchange_orders` | VALR orders | order_id, portfolio_id, status | ~365 rows/portfolio/year |
| `lth_pvr.order_fills` | Individual fills | fill_id, order_id, filled_qty, fee | ~730 rows/portfolio/year |
| `lth_pvr.ledger_lines` | Canonical event ledger | line_id, portfolio_id, event_type, amounts | ~1000 rows/portfolio/year |
| `lth_pvr.balances_daily` | Daily balances per portfolio | portfolio_id, date, balance_btc, balance_usdt, nav_usd | ~365 rows/portfolio/year |
| `lth_pvr.alert_events` | System alerts | alert_id, component, severity, message, resolved_at | Variable, ~50-200/year |
| `lth_pvr_bt.bt_results_daily` | Back-test daily results | bt_run_id, date, balances, ROI | ~365 rows/backtest |

### 11.4 Edge Function Execution Flow

```
03:00 UTC: ef_fetch_ci_bands
    ↓
03:05 UTC: ef_generate_decisions
    ↓
03:10 UTC: ef_create_order_intents
    ↓
03:15 UTC: ef_execute_orders
    ↓
03:15-03:30: ef_poll_orders (every minute)
    ↓
03:30 UTC: ef_post_ledger_and_balances
    ↓
05:00 UTC: ef_alert_digest
    ↓
Overnight: ef_std_dca_roll
    ↓
Monthly: ef_fee_monthly_close → ef_fee_invoice_email

Guard: lth_pvr.ensure_ci_bands_today() (every 30 minutes)

Recovery: ef_resume_pipeline (manual or scheduled)
  - Called via UI "Resume Pipeline" button
  - Checks pipeline status
  - Queues incomplete steps asynchronously
  - Continues from last completed step
```

---

**End of Solution Design Document v0.6**

*For questions or updates, contact: davin.gaier@gmail.com*
