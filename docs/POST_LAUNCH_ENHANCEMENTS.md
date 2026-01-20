# BitWealth LTH PVR - Post-Launch Enhancement Roadmap

**Launch Date:** January 10, 2026  
**Current Date:** January 14, 2026  
**Phase:** Week 1 (Post-Launch Bug Fixes & Stabilization)  
**Status:** MVP Stable ✅

---

## 🎉 Launch Status: SUCCESSFUL

### MVP Achievements (Jan 10, 2026)
- ✅ 6-milestone customer onboarding pipeline operational
- ✅ Customer portal with real-time balance dashboard
- ✅ Automated balance reconciliation (hourly)
- ✅ Admin customer management interface
- ✅ Email notification system (17 templates)
- ✅ Security testing passed (RLS policies, storage access, JWT)
- ✅ Integration testing complete (IT1-IT3)
- ✅ Production deployment on bitwealth.co.za

### Week 1 Post-Launch Work (Jan 10-14)
**Focus:** Bug fixes, public website enhancements, customer acquisition

**Completed:**
1. ✅ **v0.6.17** - Contact form email notifications (Jan 12)
   - Database table: `contact_form_submissions`
   - Edge function: `ef_contact_form_submit`
   - Admin notifications to info@bitwealth.co.za
   - Auto-reply confirmations
   - reCAPTCHA integration

2. ✅ **v0.6.18** - Back-test form field validation fix (Jan 13)
   - Removed restrictive `step="100"` constraint
   - Users can now enter any dollar amount

3. ✅ **v0.6.19** - Back-test form UX improvements (Jan 14)
   - reCAPTCHA error handling for ad blockers
   - Date validation for LTH PVR data lag (yesterday max)
   - Fixed missing Standard DCA contribution data
   - Enhanced client-side validation

4. ✅ **v0.6.20** - Back-test execution bug fixes (Jan 14)
   - Fixed fee aggregation catastrophic over-counting
   - Corrected Standard DCA CAGR calculation (was 473,492%!)
   - Fixed column name mismatches in SQL functions
   - Variable scoping error resolved
   - Date validation timezone bug fixed

5. ✅ **v0.6.21** - Statement generation system (Jan 15)
   - PDF generation with professional formatting
   - Right-aligned numbers, NAV terminology, fee breakdown
   - Benchmark comparison table (LTH PVR vs Standard DCA)
   - Month dropdown restrictions (account creation → previous month)
   - Automated monthly generation cron job (00:01 UTC, 1st of month)
   - Email notifications with download links
   - Pre-generated statement retrieval from storage bucket
   - SDD file naming convention

**Impact:** Customers can now download monthly investment statements with full transaction history, performance metrics, and benchmark comparisons. Automated generation ensures statements are ready on the 1st of each month.

---

## 🗓️ Week 2 Roadmap (Jan 17-24)

### ✅ Priority 1: Transaction History View (COMPLETE)
**Status:** ✅ DEPLOYED (2026-01-05)  
**Effort:** 3 hours (actual)  
**Value:** HIGH (customer-facing visibility)

**What Was Built:**
1. **Database Layer** ✅
   - RPC function: `public.list_customer_transactions(p_customer_id BIGINT, p_limit INT)`
   - Returns: trade_date, kind, amount_btc, amount_usdt, fee_btc, fee_usdt, note, created_at
   - Source: `lth_pvr.ledger_lines` table
   - Security: SECURITY DEFINER with customer_id parameter filtering
   - File: `supabase/functions/public.list_customer_transactions.fn.sql`

2. **UI Layer** ✅ (`website/customer-portal.html` lines 254-290)
   - Transaction History card with full table
   - Columns: Date | Type | BTC | USDT | Fee (BTC) | Fee (USDT) | Note
   - Color coding implemented:
     - Green badges: deposits, BUY orders, topups
     - Red badges: withdrawals, SELL orders
     - Orange badges: fees
   - Amount color coding (green for positive, red for negative)
   - Date formatting: DD/MM/YYYY
   - Handles empty state: "📭 No transactions yet"
   - Displays last 100 transactions

3. **Features** ✅
   - Monospace font for numeric values (better alignment)
   - Note truncation for long descriptions (40 char limit with tooltip)
   - Loading state with spinner
   - Error state with retry message
   - Maps "topup" kind to "Deposit" for user-friendly display

**Production Status:** ✅ DEPLOYED AND TESTED

---

### ✅ Priority 2: UI Transformation (COMPLETE - 2026-01-14)
**Status:** ✅ COMPLETE  
**Effort:** 4 hours (actual)  
**Value:** HIGH (professional appearance, better UX)

**What Was Built:**
1. **Phase 1: Core Structure** ✅
   - Added portal.css and Inter font imports
   - Replaced body structure with sidebar + main layout
   - Transformed stats display to dashboard-stats grid
   - Updated JavaScript to populate new stat boxes

2. **Phase 2: Preserve Features** ✅
   - Kept all RPC calls and authentication logic
   - Added user avatar with initials
   - Verified transaction history working
   - Preserved onboarding status tracker

3. **Phase 3: New Features** ✅
   - Recent Activity card (shows last 5 transactions)
   - Strategy Metrics card (portfolio details)
   - Proper time-ago formatting for activity
   - Investment metrics calculation

4. **Phase 4: Cleanup** ✅
   - Deleted portal.html demo file
   - Deleted portal.js demo script  
   - Removed development backup files
   - Committed all changes to production

**Result:** Professional dark theme dashboard with sidebar navigation, modern stat boxes showing real customer data, and all existing functionality preserved.

---

### Priority 3: Statement Generation (PDF Download)

**Objective:** Transform `customer-portal.html` to use the modern dashboard design from `portal.html`, then deprecate the demo file.

**Current State Analysis:**
- **customer-portal.html**: Functional backend integration, basic card-based UI (blue gradient background)
- **portal.html**: Professional dashboard design with sidebar navigation, modern stat boxes, dark theme (demo data, no backend)

**Design System Comparison:**

| Component | customer-portal.html | portal.html | Decision |
|-----------|---------------------|-------------|----------|
| **Layout** | Single column, full-width cards | Sidebar + main content area | ✅ Use portal.html |
| **Navigation** | None (single page) | Left sidebar with icons | ✅ Use portal.html |
| **Header** | Simple text header with logout | Top bar with user avatar, actions | ✅ Use portal.html |
| **Stats Display** | Simple grid in card | Large stat boxes with icons | ✅ Use portal.html |
| **Color Scheme** | Blue gradient (#1e3a8a → #3b82f6) | Dark theme (--bg-dark, --bg-card) | ✅ Use portal.html |
| **Typography** | Basic sans-serif | Inter font family | ✅ Use portal.html |
| **Backend** | ✅ Real Supabase integration | ❌ Demo data only | ✅ Keep customer-portal |

**Implementation Plan:**

**Phase 1: Merge CSS and Structure (2-3 hours)**
1. Add `css/portal.css` import to customer-portal.html
2. Restructure HTML to use sidebar + main content layout
3. Replace card-based stats with dashboard-stats grid
4. Add sidebar navigation (Dashboard active, others coming soon)
5. Update color scheme to use CSS variables from portal.css

**Phase 2: Preserve Functionality (1-2 hours)**
6. Keep all existing Supabase RPC calls and data loading
7. Maintain authentication/session logic
8. Preserve transaction history table (already built)
9. Keep onboarding status tracker (unique to customer-portal)
10. Retain portfolio list functionality

**Phase 3: Enhance with Portal Features (1-2 hours)**
11. Add user avatar with initials in header
12. Add "Download Statement" button (placeholder for future feature)
13. Implement Recent Activity card (from transaction history data)
14. Add Strategy Metrics card (calculated from customer data)
15. Make navigation items functional (link to sections on page)

**Phase 4: Testing & Cleanup (30 min)**
16. Test with Customer 31 (active with transactions)
17. Test responsive behavior (mobile, tablet, desktop)
18. Delete portal.html and portal.js (demo files)
19. Update login.html redirect to point to customer-portal.html

**Files to Modify:**
```
website/
  customer-portal.html (restructure entire file ~600 lines)
  css/portal.css (already exists, may need minor tweaks)

Files to Delete:
  website/portal.html (demo file)
  website/js/portal.js (demo script)
```

**Success Criteria:**
- ✅ Professional dark theme dashboard with sidebar
- ✅ All existing functionality preserved (transactions, balances, status)
- ✅ Responsive design works on mobile/tablet/desktop
- ✅ User avatar shows customer initials
- ✅ Navigation sidebar present (future-ready)
- ✅ No broken links or styling issues

**Next Steps After Completion:**
- Statement generation (download PDF from header button)
- Performance charts (populate chart placeholder)
- Withdrawal request form (activate Withdrawals nav item)

---

### Priority 3: Statement Generation (PDF Download)
**Status:** ✅ COMPLETE (2026-01-15)
**Effort:** 8 hours (actual)  
**Value:** HIGH (monthly reporting)

**What Was Built:**

1. **Edge Function: ef_generate_statement** ✅
   - Parameters: customer_id, year, month
   - Queries: balances_daily, ledger_lines, customer_portfolios, std_dca_balances_daily
   - PDF Generation: jsPDF library (2.5.1)
   - Returns: JSON with downloadUrl (signed 30-day expiry)
   - Storage: Uploads to customer-statements bucket with SDD naming

2. **PDF Design Enhancements** ✅
   - **Header:** Customer name, Customer ID, Statement Period (logo placeholder added)
   - **Performance Summary:**
     - Opening/Closing Net Asset Value (terminology updated)
     - Contributions, Net Change with %
     - ROI %, CAGR %
     - Fee Breakdown: Platform ($0), Performance ($0), Exchange Fees
     - Total Fees Paid (bold)
     - BTC/USDT Balances
     - All numeric values right-aligned for professional appearance
   - **Benchmark Comparison:**
     - 3-column table: Metric | LTH PVR Bitcoin DCA | Standard DCA
     - Rows: NAV, ROI, CAGR
     - Outperformance summary
   - **Transaction History:**
     - 8 columns with right-aligned numbers
     - Rolling BTC/USDT balances
     - Totals row at bottom
     - Replaces "topup" with "deposit" for display
   - **Footer:**
     - Shows actual filename (SDD convention)
     - Generated date, page number
     - Adjusted margins to prevent overflow

3. **UI Integration** ✅
   - Month/year dropdowns with smart filtering
   - Month dropdown restricted to past months only (account creation → previous month)
   - Checks storage bucket first for pre-generated statements
   - Generates on-demand if not found
   - Download via signed URL

4. **Automated Monthly Generation** ✅
   - **Edge Function: ef_monthly_statement_generator**
   - **Schedule:** pg_cron job runs 00:01 UTC on 1st of every month
   - Generates previous month's statements for all active customers
   - Sends professional email notification with download link
   - Email template: Modern HTML design with BitWealth branding

5. **Storage Architecture** ✅
   - Bucket: customer-statements (private)
   - Path: `{org_id}/customer-{id}/{filename}`
   - Filename: `CCYY-MM-DD_LastName_FirstNames_statement_M##_CCYY.pdf`
   - RLS Policies: Customers view own, service role full access
   - 5MB file size limit, PDF only

**Files Modified:**
- `supabase/functions/ef_generate_statement/index.ts` (450 lines)
- `supabase/functions/ef_monthly_statement_generator/index.ts` (220 lines)
- `website/customer-portal.html` (statement section + download logic)
- `supabase/migrations/20260115_add_monthly_statement_generation_cron.sql`

**Known Issues:**
- ✅ FIXED: Month dropdown showing no options (ORG_ID undefined)
- ✅ FIXED: Month dropdown logic (correctly excludes current month)
- ⏳ Logo: 522KB file too large for PDF embedding (needs compression to <50KB)

**Production Status:** ✅ DEPLOYED AND FUNCTIONAL

---

### Priority 4: Statement Generation Enhancements
**Status:** PLANNED  
**Effort:** 6-8 hours  
**Value:** MEDIUM (professional polish)

**Planned Improvements:**

#### 4.1 Logo Optimization
**Effort:** 30 minutes  
**Priority:** MEDIUM
- Current logo is 522KB (too large for PDF embedding)
- **Action:** Compress to <50KB using TinyPNG or ImageOptim
- Target: 20x20 pixels at 72 DPI, PNG format
- Update `ef_generate_statement/index.ts` with optimized base64

#### 4.2 Multi-Page Support
**Effort:** 1 hour  
**Priority:** LOW
- Current PDF only shows "Page 1" hardcoded
- **Action:** Add dynamic page numbering
- jsPDF code: Track page count, update footer dynamically
- Format: `Page ${currentPage} of ${totalPages}`

#### 4.3 Performance Metrics Period Clarification
**Effort:** 30 minutes  
**Priority:** MEDIUM
- ROI and CAGR calculated from inception but not labeled
- **Action:** Add "Since Inception: DD MMM YYYY" under ROI/CAGR
- Improves transparency for customers

#### 4.4 Visual Table Enhancements
**Effort:** 1 hour  
**Priority:** LOW
- Benchmark table has basic styling
- **Action:** Add subtle background colors, border lines
- Use `doc.setFillColor(240, 247, 255)` for header rows
- Add thin borders around table cells

#### 4.5 Transaction Type Icons
**Effort:** 45 minutes  
**Priority:** LOW
- Text-only transaction types (deposit, buy, sell, withdrawal)
- **Action:** Add emoji icons before text
- deposit: 💰, withdrawal: 💸, buy: 📈, sell: 📉
- Makes transaction scanning faster

#### 4.6 Year-to-Date Summary Section
**Effort:** 2 hours  
**Priority:** MEDIUM
- No YTD summary for months after January
- **Action:** Add YTD section if month != January
- Show: YTD Contributions, YTD Fees, YTD Net Change, YTD ROI
- Helps customers track annual progress

#### 4.7 Footnotes and Disclaimers
**Effort:** 30 minutes  
**Priority:** MEDIUM
- No explanation for $0 platform/performance fees
- **Action:** Add small disclaimer at bottom
- Text: "Platform and Performance Fees coming in Q2 2026. Exchange Fees charged by VALR."
- Font size 7, gray text, bottom of page 1

#### 4.8 CSV Export Option
**Effort:** 3 hours  
**Priority:** LOW
- Customers may want transaction data in spreadsheet format
- **Action:** Add "Download as CSV" button next to PDF button
- Export: Date, Type, BTC Amount, USDT Amount, Fee BTC, Fee USDT, BTC Balance, USDT Balance
- Useful for tax reporting and personal analysis

#### 4.9 Statement Archive UI
**Effort:** 2 hours  
**Priority:** MEDIUM
- Current UI: Manual month/year selection only
- **Action:** Add statement history list below dropdown
- Display: Month/Year, Status (Generated/Not Available), File Size, Download link
- Faster access to historical statements without dropdown navigation

#### 4.10 Mobile PDF Optimization
**Effort:** 2 hours  
**Priority:** LOW
- jsPDF may not render optimally on mobile browsers
- **Action:** Test on iOS Safari, Android Chrome
- Adjust font sizes and column widths if needed
- Consider separate mobile-optimized template

#### 4.11 Error Handling in Email Delivery
**Effort:** 2 hours  
**Priority:** HIGH
- Email failures are logged but no retry mechanism
- **Action:** Log failed emails to lth_pvr.alert_events
- Implement 3-attempt retry with exponential backoff
- Send admin notification if >5 emails fail in one batch

#### 4.12 Statement History Audit Table
**Effort:** 1 hour  
**Priority:** MEDIUM
- No tracking of statement generation/download events
- **Action:** Create lth_pvr.statement_history table
- Columns: customer_id, year, month, generated_at, emailed_at, download_count, file_size_kb
- Enables analytics: How often do customers download? Which months most popular?

**Total Effort:** 17-18 hours  
**Recommended Timeline:** Week 4-5 (Jan 24 - Feb 7)

---

### Priority 5: Admin Portal UX Improvements
**Status:** ✅ COMPLETE (2026-01-20)  
**Effort:** 4 hours (actual)  
**Value:** MEDIUM (operational efficiency)

**What Was Built:**
1. **Customer Search/Filter** ✅
   - Search by name, email, customer_id (real-time filtering)
   - Filter by status dropdown (All statuses, prospect, kyc, setup, deposit, active, inactive)
   - Clear button resets filters
   - Match count displayed ("17 customers")
   - Default filter changed to "All statuses" (was "active" only)

2. **Dashboard Metrics** ✅
   - Total active customers: 17
   - Active portfolios: 6
   - Total AUM: $157,183
   - Unresolved alerts: 0
   - Live org_id filtering fixed

**Deferred:**
- Bulk Operations (batch status changes, CSV export)
- KYC Document Viewer Enhancements (zoom, side-by-side)

**Production Status:** ✅ DEPLOYED

---

### Task 5: Real Customer Fees with HWM Logic (v0.6.23)
**Status:** ⏳ IN PROGRESS (2026-01-20)  
**Effort:** 20-24 hours (estimated)  
**Value:** CRITICAL (revenue generation)

**Objective:** Align live trading fees with back-tester HWM (High Water Mark) logic from v0.6.15, fix platform fee bug, and consolidate duplicate table architecture.

---

#### 🔴 Critical Prerequisite: Table Consolidation

**Problem Identified:**
- `public.customer_portfolios` (global multi-strategy table) ❌
- `lth_pvr.customer_strategies` (LTH_PVR-specific trading table) ❌
- **Duplication Issue:** "Portfolio" and "strategy" used interchangeably, causing unnecessary complexity
- **Current State:** 22 edge functions reference both tables (ef_generate_decisions, ef_deposit_scan, ef_execute_orders, etc.)

**Solution: Consolidate into Single Source of Truth**
- **New Table:** `public.customer_strategies` (replaces both tables)
- **Rationale:** Strategy-specific schemas (lth_pvr, future adv_dca, etc.) should NOT contain customer routing tables. Customer→Strategy mapping belongs in `public` schema.
- **Migration Strategy:** Zero-downtime consolidation with column merging

**Consolidated Schema Design:**
```sql
CREATE TABLE public.customer_strategies (
  customer_strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  customer_id BIGINT NOT NULL REFERENCES public.customer_details(customer_id),
  
  -- Strategy assignment
  strategy_code TEXT NOT NULL REFERENCES public.strategies(strategy_code),
  strategy_version_id UUID REFERENCES lth_pvr.strategy_versions(strategy_version_id),
  
  -- Exchange routing
  exchange TEXT NOT NULL DEFAULT 'VALR',
  exchange_account_id UUID NOT NULL REFERENCES lth_pvr.exchange_accounts(exchange_account_id),
  exchange_subaccount TEXT,
  
  -- Trading configuration
  base_asset TEXT NOT NULL DEFAULT 'BTC',
  quote_asset TEXT NOT NULL DEFAULT 'USDT',
  min_order_usdt NUMERIC(20,2) DEFAULT 1.00,
  
  -- Fee configuration (strategy-specific overrides)
  performance_fee_rate NUMERIC(5,4) DEFAULT NULL,  -- NULL = use strategy default (0.10 for LTH_PVR)
  platform_fee_rate NUMERIC(5,4) DEFAULT NULL,     -- NULL = use strategy default (0.0075)
  
  -- Status & lifecycle
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'closed')),
  live_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  
  -- UI metadata
  label TEXT NOT NULL,  -- e.g., "John Doe - LTH PVR BTC DCA"
  
  UNIQUE(customer_id, strategy_code, effective_from)
);

CREATE INDEX idx_customer_strategies_org_cust ON public.customer_strategies(org_id, customer_id, strategy_code, status);
CREATE INDEX idx_customer_strategies_live ON public.customer_strategies(org_id, strategy_code, live_enabled) WHERE live_enabled = TRUE;
```

**Migration Steps:**
1. **Migration 1:** Create new `public.customer_strategies` table with all columns
2. **Migration 2:** Backfill data from both `customer_portfolios` and `lth_pvr.customer_strategies` with LEFT JOIN merging
3. **Migration 3:** Update all 22 edge functions to query new table
4. **Migration 4:** Deprecate old tables (rename to `_deprecated_customer_portfolios` and `_deprecated_lth_pvr_customer_strategies`)
5. **Migration 5:** Drop deprecated tables after 30-day safety period

**Affected Edge Functions (22):**
- ef_generate_decisions
- ef_deposit_scan
- ef_execute_orders
- ef_fee_monthly_close
- ef_valr_create_subaccount
- ef_confirm_strategy
- ef_balance_reconciliation
- ef_monthly_statement_generator
- ef_generate_statement
- RPC: list_customer_portfolios
- RPC: get_customer_dashboard
- UI: Advanced BTC DCA Strategy.html (portfolio dropdown)
- UI: customer-portal.html (dashboard)
- (Plus 9 more - full audit required)

---

#### Fee Implementation Specifications

**User Answers to Clarifying Questions (2026-01-20):**

**Q1a: Fee Defaults Per Strategy**
✅ **ANSWER:** Yes, default fee rates per strategy (10% performance, 0.75% platform for LTH_PVR), with admin UI override capability at customer_strategy level.

**Implementation:**
- Create `lth_pvr.strategy_fee_defaults` table:
  ```sql
  CREATE TABLE lth_pvr.strategy_fee_defaults (
    strategy_code TEXT PRIMARY KEY REFERENCES public.strategies(strategy_code),
    performance_fee_rate NUMERIC(5,4) NOT NULL DEFAULT 0.10,  -- 10%
    platform_fee_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0075,   -- 0.75%
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO lth_pvr.strategy_fee_defaults VALUES ('LTH_PVR', 0.10, 0.0075);
  ```
- Admin UI: Add "Fee Overrides" section in portfolio editing
- Edge functions: Coalesce customer_strategies.performance_fee_rate with strategy defaults

---

**Q2a: BTC Deposit Platform Fee - Charge Method**
✅ **ANSWER:** Charge 0.75% of BTC amount (e.g., 0.1 BTC deposit → 0.00075 BTC platform fee).

**Q2b: BTC Deposit Platform Fee - Deduction Method**
✅ **ANSWER:** Deduct proportionally from BTC deposit itself (0.1 BTC → 0.09925 BTC after 0.75% fee). Once transferred to BitWealth main account, auto-convert to USDT via MARKET order.

**Implementation:**
- Modify `ef_deposit_scan` (lines 230-250):
  ```typescript
  const depositedBTC = transaction.amount_btc;
  const platformFeeRate = await getPlatformFeeRate(customer_id);  // 0.0075
  const platformFeeBTC = depositedBTC * platformFeeRate;  // 0.00075 BTC
  const netBTC = depositedBTC - platformFeeBTC;  // 0.09925 BTC
  
  // Insert ledger entry
  await sb.from("ledger_lines").insert({
    customer_id,
    kind: "deposit",
    amount_btc: netBTC,  // Customer receives 0.09925 BTC
    platform_fee_btc: platformFeeBTC,  // 0.00075 BTC
    note: `Crypto deposit (0.75% platform fee: ${platformFeeBTC} BTC)`
  });
  
  // Transfer platform fee to main account
  await transferPlatformFeeToMainAccount(platformFeeBTC, "BTC");
  ```
- New helper function: `transferPlatformFeeToMainAccount(amount, currency)`
- VALR API call: `POST /v1/account/subaccount/transfer` (confirmed available, 20/s rate limit)
- Auto-convert BTC→USDT after transfer using MARKET order

---

**Q3a: Interim Performance Fee at Withdrawal - Logic**
✅ **ANSWER:** Use same HWM logic (compare current NAV to HWM, charge 10% on profit).

**Q3b: Interim Performance Fee at Withdrawal - HWM Update**
✅ **ANSWER:** HWM updates immediately after interim fee. **However**, if withdrawal request is declined or fails, HWM should revert to pre-withdrawal value.

**Implementation:**
- New edge function: `ef_calculate_interim_performance_fee`
  ```typescript
  async function calculateInterimPerformanceFee(customer_id, withdrawal_request_id) {
    const state = await getCustomerState(customer_id);  // Current NAV, HWM, hwmContribNetCum
    const performanceFeeRate = await getPerformanceFeeRate(customer_id);  // 0.10
    
    const nav = state.nav_usd;
    const hwm = state.high_water_mark_usd ?? nav;  // Initialize if first time
    const contributionsNet = state.hwm_contrib_net_cum ?? 0;
    
    if (nav <= hwm + contributionsNet) {
      return { fee_usd: 0, new_hwm: hwm };  // No profit, no fee
    }
    
    const profit = nav - (hwm + contributionsNet);
    const performanceFee = profit * performanceFeeRate;  // 10% of profit
    const newHWM = nav - contributionsNet;  // Update HWM after fee deduction
    
    // Store pre-withdrawal state for potential reversion
    await sb.from("lth_pvr.withdrawal_fee_snapshots").insert({
      withdrawal_request_id,
      customer_id,
      snapshot_date: new Date(),
      pre_withdrawal_hwm: hwm,
      pre_withdrawal_contrib_net_cum: contributionsNet,
      calculated_performance_fee: performanceFee,
      new_hwm: newHWM
    });
    
    return { fee_usd: performanceFee, new_hwm: newHWM };
  }
  ```
- New table: `lth_pvr.withdrawal_fee_snapshots` (stores pre-withdrawal state)
- Withdrawal cancellation handler: Revert HWM from snapshot
- Withdrawal failure handler: Revert HWM from snapshot
- Withdrawal success: Delete snapshot (state is permanent)

---

**Q4a: Auto BTC→USDT Conversion - Approval Required**
✅ **ANSWER:** Require customer approval. Show message: "Insufficient USDT. Sell 0.05 BTC to cover $500 fee?"

**Q4b: Auto BTC→USDT Conversion - Order Type**
✅ **ANSWER:** Attempt LIMIT order first, fall back to MARKET if not filled in 5 minutes (same logic as `ef_poll_orders`).

**Q4c: Auto BTC→USDT Conversion - Slippage Buffer**
✅ **ANSWER:** Yes, add 2% buffer rule. **CRITICAL:** Must be stipulated in compliance agreements.

**Implementation:**
- New edge function: `ef_auto_convert_btc_to_usdt`
  ```typescript
  async function autoConvertBTCtoUSDT(customer_id, required_usdt) {
    const btcPrice = await getBTCPrice();  // e.g., $50,000
    const btcRequired = required_usdt / btcPrice;  // e.g., 0.01 BTC for $500 USDT
    const btcWithBuffer = btcRequired * 1.02;  // 2% slippage buffer → 0.0102 BTC
    
    const btcBalance = await getBTCBalance(customer_id);
    
    if (btcBalance < btcWithBuffer) {
      throw new Error(`Insufficient BTC: ${btcBalance} (need ${btcWithBuffer})`);
    }
    
    // Create customer approval request
    const approvalRequest = await sb.from("lth_pvr.fee_conversion_approvals").insert({
      customer_id,
      btc_amount: btcWithBuffer,
      usdt_target: required_usdt,
      status: "pending",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)  // 24hr expiry
    }).select().single();
    
    // Send email notification
    await sendEmail({
      template: "fee_conversion_approval",
      subject: "Action Required: Approve BTC Sale for Fee Payment",
      data: {
        btc_amount: btcWithBuffer,
        usdt_target: required_usdt,
        approval_url: `https://bitwealth.co.za/approve-conversion/${approvalRequest.id}`
      }
    });
    
    return { status: "awaiting_approval", approval_id: approvalRequest.id };
  }
  
  // Customer clicks approval link
  async function executeApprovedConversion(approval_id) {
    const approval = await getApproval(approval_id);
    
    // Place LIMIT order 1% below current price
    const btcPrice = await getBTCPrice();
    const limitPrice = btcPrice * 0.99;  // 1% below market
    
    const orderId = await placeVALROrder({
      pair: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      quantity: approval.btc_amount,
      price: limitPrice,
      customerOrderId: `fee-conversion-${approval_id}`
    });
    
    // Monitor order for 5 minutes
    const filled = await monitorOrderWithTimeout(orderId, 5 * 60 * 1000);
    
    if (!filled) {
      // Cancel LIMIT, place MARKET order
      await cancelVALROrder(orderId);
      const marketOrderId = await placeVALROrder({
        pair: "BTCUSDT",
        side: "SELL",
        type: "MARKET",
        baseAmount: approval.btc_amount
      });
    }
  }
  ```
- New table: `lth_pvr.fee_conversion_approvals`
- New email template: `fee_conversion_approval`
- **Compliance:** Update `customer_agreements` table to include 2% slippage disclosure

---

**Q5a: VALR Fee Transfer - Timing**
✅ **ANSWER:** Real-time transfer (immediately after platform fee deduction).

**Q5b: VALR Fee Transfer - API Availability**
✅ **CONFIRMED:** VALR has `/v1/account/subaccount/transfer` API endpoint.
- **Rate Limit:** 20 requests/second
- **Permission:** "Transfer" scope required on API Key
- **Headers:** Same HMAC authentication as other VALR endpoints

**Implementation:**
- New helper module: `supabase/functions/_shared/valrTransfer.ts`
  ```typescript
  export async function transferBetweenSubaccounts(
    fromSubaccountId: string,
    toSubaccountId: string,  // "primary" for main account
    currency: string,  // "BTC" or "USDT"
    amount: number
  ) {
    const timestamp = Date.now().toString();
    const path = "/v1/account/subaccount/transfer";
    const body = JSON.stringify({
      fromSubaccountId,
      toSubaccountId,
      currency,
      amount: amount.toString()
    });
    
    const signature = await signVALR(timestamp, "POST", path, body, VALR_API_SECRET);
    
    const response = await fetch(`${VALR_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VALR-API-KEY": VALR_API_KEY,
        "X-VALR-SIGNATURE": signature,
        "X-VALR-TIMESTAMP": timestamp
      },
      body
    });
    
    if (!response.ok) {
      throw new Error(`VALR transfer failed: ${await response.text()}`);
    }
    
    return await response.json();
  }
  ```
- Usage in `ef_post_ledger_and_balances`:
  ```typescript
  // After recording platform fee in ledger
  await transferBetweenSubaccounts(
    customerSubaccountId,
    "primary",  // BitWealth main account
    "USDT",
    platformFeeUSDT
  );
  ```

---

**Q6a: Platform Fee Calculation - Confirm NET vs GROSS**
✅ **ANSWER:** Platform fee should be charged on NET USDT (after VALR conversion fee), not GROSS ZAR.

**Bug Identified in Back-Tester:**
- **Current Code** (ef_bt_execute/index.ts, applyContrib function):
  ```typescript
  // ❌ WRONG: Charges platform fee on GROSS
  const platformFee = gross * platformFeeRate;  // Charges on ZAR amount BEFORE exchange fee
  ```
- **Correct Code:**
  ```typescript
  // ✅ CORRECT: Charges platform fee on NET USDT (after VALR fee)
  const exchangeFeeUSDT = gross * VALR_CONVERSION_FEE_RATE;  // 0.18% = 0.0018
  const netUSDT = gross - exchangeFeeUSDT;
  const platformFee = netUSDT * platformFeeRate;  // Charges on NET USDT
  ```

**Fix Required:**
1. Update `ef_bt_execute/index.ts` applyContrib() function (lines ~350-370)
2. Rerun all public back-tests to correct historical data
3. Update SDD v0.6.24 with platform fee bug fix documentation
4. Apply same NET-based logic to live trading in `ef_post_ledger_and_balances`

---

**Q7a: Invoice Payment Tracking**
✅ **ANSWER:** Yes, track payment status in invoice table.

**Implementation:**
- Create `lth_pvr.fee_invoices` table:
  ```sql
  CREATE TABLE lth_pvr.fee_invoices (
    invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    customer_id BIGINT NOT NULL REFERENCES public.customer_details(customer_id),
    invoice_month DATE NOT NULL,  -- First day of month (e.g., 2026-01-01)
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Fee breakdown
    platform_fees_due NUMERIC(20,2) NOT NULL DEFAULT 0,
    platform_fees_paid NUMERIC(20,2) NOT NULL DEFAULT 0,
    performance_fees_due NUMERIC(20,2) NOT NULL DEFAULT 0,
    performance_fees_paid NUMERIC(20,2) NOT NULL DEFAULT 0,
    exchange_fees_paid NUMERIC(20,2) NOT NULL DEFAULT 0,  -- Info only, paid to VALR directly
    
    total_fees_due NUMERIC(20,2) GENERATED ALWAYS AS (platform_fees_due + performance_fees_due) STORED,
    total_fees_paid NUMERIC(20,2) GENERATED ALWAYS AS (platform_fees_paid + performance_fees_paid) STORED,
    balance_outstanding NUMERIC(20,2) GENERATED ALWAYS AS ((platform_fees_due + performance_fees_due) - (platform_fees_paid + performance_fees_paid)) STORED,
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'overdue')),
    due_date DATE NOT NULL,  -- e.g., 15th of following month
    paid_date DATE,
    
    -- Metadata
    emailed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(customer_id, invoice_month)
  );
  
  CREATE INDEX idx_fee_invoices_customer ON lth_pvr.fee_invoices(customer_id);
  CREATE INDEX idx_fee_invoices_status ON lth_pvr.fee_invoices(status, due_date);
  ```
- Monthly invoice generation: `ef_fee_monthly_close` (replace old non-HWM logic)
- Payment recording: `ef_record_fee_payment` (updates `*_fees_paid` columns)
- Overdue alerts: Cron job checks `due_date < CURRENT_DATE AND status != 'paid'`

---

#### Database Schema Changes

**New Tables:**
1. `public.customer_strategies` (consolidates customer_portfolios + lth_pvr.customer_strategies)
2. `lth_pvr.strategy_fee_defaults` (default fee rates per strategy)
3. `lth_pvr.fee_invoices` (monthly invoice tracking with payment status)
4. `lth_pvr.withdrawal_fee_snapshots` (stores pre-withdrawal HWM state for reversion)
5. `lth_pvr.fee_conversion_approvals` (BTC→USDT conversion approval workflow)

**Modified Tables:**
- `lth_pvr.ledger_lines` - Add columns:
  - `amount_zar NUMERIC(20,2)`
  - `exchange_rate NUMERIC(20,8)`  -- ZAR→USDT rate
  - `platform_fee_usdt NUMERIC(20,8)`
  - `performance_fee_usdt NUMERIC(20,8)`
  - Keep existing: `fee_btc`, `fee_usdt` (VALR exchange fees)

- `lth_pvr.customer_state_daily` - Add columns:
  - `high_water_mark_usd NUMERIC(20,2)`
  - `hwm_contrib_net_cum NUMERIC(20,2)`  -- Net contributions since HWM
  - `last_perf_fee_month DATE`  -- Prevents double-charging

- `lth_pvr.balances_daily` - Add column:
  - `platform_fees_paid_cum NUMERIC(20,2)`
  - `performance_fees_paid_cum NUMERIC(20,2)`

**Deprecated Tables:**
- `public.customer_portfolios` → Rename to `_deprecated_customer_portfolios` (after migration)
- `lth_pvr.customer_strategies` → Rename to `_deprecated_lth_pvr_customer_strategies` (after migration)
- `lth_pvr.fee_configs` → Already customer-level (will be replaced by strategy-level defaults + overrides)

---

#### Edge Function Changes

**New Functions:**
1. `ef_calculate_performance_fees` - Monthly HWM-based fee calculation
2. `ef_calculate_interim_performance_fee` - Mid-month withdrawal fee calculation
3. `ef_auto_convert_btc_to_usdt` - BTC→USDT conversion for fee payment
4. `ef_record_fee_payment` - Update invoice payment status
5. `ef_revert_withdrawal_fees` - Revert HWM if withdrawal cancelled/failed

**Modified Functions:**
1. `ef_post_ledger_and_balances` - Add platform fee on deposits, ZAR tracking, real-time transfer to main account
2. `ef_deposit_scan` - Add BTC deposit platform fee (0.75% deducted from deposit)
3. `ef_bt_execute` - Fix platform fee bug (NET vs GROSS), update applyContrib() function
4. `ef_fee_monthly_close` - Replace with HWM-based logic (currently uses old nav_end - nav_start)
5. All 22 functions referencing customer_portfolios/customer_strategies - Update to use new consolidated table

---

#### Admin UI Changes

**Fee Management Card Updates:**
- Current: Customer-level fee editing (lines 794-829)
- New: Strategy-level fee editing with portfolio dropdown
- Show: Performance Fee %, Platform Fee %, "Using Strategy Default" indicator
- RPC: `update_portfolio_fee_rates(portfolio_id, performance_rate, platform_rate)` (replaces `update_customer_fee_rate`)

**Invoice Management Module (New):**
- List all invoices: Month, Customer, Total Due, Total Paid, Outstanding, Status
- Filter: Overdue, Pending, Paid
- Actions: Mark as Paid, Send Reminder Email, Download PDF
- RPC: `list_fee_invoices(org_id, status_filter)`

---

#### Compliance & Legal Requirements

**Customer Agreements Update:**
1. **2% Slippage Buffer Disclosure:**
   - Add to `customer_agreements` table, version 1.1
   - Text: "When converting BTC to USDT for fee payment, BitWealth may sell up to 2% more BTC than the exact fee amount to account for market price fluctuations. Any excess USDT will be returned to your account."

2. **Platform Fee Disclosure:**
   - "BitWealth charges a 0.75% platform fee on all ZAR deposits (charged in USDT after currency conversion). This fee is separate from VALR's 0.18% conversion fee."

3. **Performance Fee Disclosure:**
   - "BitWealth charges a 10% performance fee on profits exceeding your previous High Water Mark. Fees are calculated and deducted monthly, or at the time of withdrawal requests."

**Email Templates (3 new):**
1. `fee_invoice_monthly` - Monthly fee invoice with breakdown
2. `fee_conversion_approval` - BTC→USDT conversion approval request
3. `fee_overdue_reminder` - 7-day and 14-day overdue notices

---

#### Testing Strategy

**Test Document:** `docs/TASK_5_FEE_IMPLEMENTATION_TEST_CASES.md`

**Layer 1: Development Subaccount ($50-100 real funds)**
- TC1.1: ZAR deposit → Platform fee charged on NET USDT ✅
- TC1.2: BTC deposit → 0.75% fee deducted, auto-converted to USDT ✅
- TC1.3: Month-end HWM profit → 10% performance fee charged ✅
- TC1.4: Month-end HWM loss → No performance fee, HWM unchanged ✅
- TC1.5: Withdrawal request → Interim performance fee calculated ✅
- TC1.6: Withdrawal declined → HWM reverted to pre-withdrawal state ✅
- TC1.7: Insufficient USDT → BTC conversion approval workflow ✅
- TC1.8: Invoice generation → Correct breakdown (platform vs performance) ✅

**Layer 2: Back-Tester Validation**
- TC2.1: Run back-test with fees enabled → Compare live trading result
- TC2.2: Platform fee NET vs GROSS → Verify bug fix
- TC2.3: Performance fee HWM logic → Month-boundary-only updates
- TC2.4: Net contributions tracking → Excludes performance fees

**Layer 3: Manual SQL Testing**
- TC3.1: `SELECT lth_pvr.calculate_performance_fee(customer_id)` → Verify formula
- TC3.2: Simulate withdrawal → Check `withdrawal_fee_snapshots` insertion
- TC3.3: Simulate cancellation → Verify HWM reversion
- TC3.4: Invoice query → `SELECT * FROM lth_pvr.fee_invoices WHERE status = 'overdue'`

**Layer 4: Unit Tests (TypeScript with Deno)**
- TC4.1: `calculatePerformanceFee()` function → Edge cases (zero profit, negative NAV)
- TC4.2: `transferBetweenSubaccounts()` → VALR API mocking
- TC4.3: `autoConvertBTCtoUSDT()` → Slippage buffer calculation

---

#### Implementation Phases

**Phase 0: Table Consolidation (Days 1-3)**
1. Create `public.customer_strategies` table
2. Backfill data from both source tables
3. Update all 22 edge functions
4. Update Admin UI portfolio dropdown
5. Test with Customer 31 (ensure no data loss)
6. Deploy consolidation
7. Deprecate old tables

**Phase 1: Schema & Migrations (Days 4-5)**
1. Add HWM columns to `customer_state_daily`
2. Add fee columns to `ledger_lines`
3. Create `strategy_fee_defaults`, `fee_invoices`, `withdrawal_fee_snapshots`, `fee_conversion_approvals` tables
4. Insert default fees: LTH_PVR (10% performance, 0.75% platform)
5. Deploy migrations to development

**Phase 2: Platform Fees (Days 6-7)**
1. Update `ef_post_ledger_and_balances` → Platform fee on ZAR deposits
2. Update `ef_deposit_scan` → BTC deposit fees (0.75% deduction)
3. Implement `transferBetweenSubaccounts()` helper (VALR API)
4. Test real-time transfer with development subaccount
5. Fix `ef_bt_execute` platform fee bug (NET vs GROSS)
6. Rerun public back-tests

**Phase 3: Performance Fees (Days 8-10)**
1. Create `ef_calculate_performance_fees` → Monthly HWM logic
2. Create `ef_calculate_interim_performance_fee` → Withdrawal HWM logic
3. Update `customer_state_daily` initialization (day 1 HWM)
4. Create `ef_revert_withdrawal_fees` → Cancellation handler
5. Schedule cron: 1st of month, 00:05 UTC
6. Test with Customer 31 historical data

**Phase 4: BTC Conversion & Invoicing (Days 11-13)**
1. Create `ef_auto_convert_btc_to_usdt` → Approval workflow
2. Create `fee_conversion_approval` email template
3. Implement LIMIT→MARKET fallback (5-minute timeout)
4. Create `ef_record_fee_payment` → Invoice updates
5. Create `ef_fee_monthly_close` → Invoice generation (replace old logic)
6. Create `fee_invoice_monthly` email template
7. Test approval flow end-to-end

**Phase 5: Admin UI & RPC Updates (Days 14-15)**
1. Update fee management card → Strategy-level editing
2. Create `update_portfolio_fee_rates()` RPC
3. Add invoice management module → List/filter/mark paid
4. Create `list_fee_invoices()` RPC
5. Update customer agreements with fee disclosures
6. Test Admin UI with multiple strategies

**Phase 6: Testing & Documentation (Days 16-17)**
1. Execute all test cases (Layers 1-4)
2. Update SDD v0.6.24 with fee implementation details
3. Update POST_LAUNCH_ENHANCEMENTS.md (this document)
4. Create `TASK_5_FEE_IMPLEMENTATION_TEST_CASES.md`
5. Update compliance documentation
6. Deploy to production

---

#### Known Risks & Mitigation

**Risk 1: VALR Transfer API Failures**
- **Impact:** Platform fees not transferred to main account (revenue loss)
- **Mitigation:** Implement retry logic (3 attempts, exponential backoff), alert on failure, manual reconciliation report

**Risk 2: HWM Reversion Bugs**
- **Impact:** Customer charged twice, or not charged (revenue/reputation loss)
- **Mitigation:** Extensive testing with withdrawal cancellations, manual verification for first 10 withdrawals, database transaction rollback on failure

**Risk 3: BTC→USDT Slippage Exceeds 2%**
- **Impact:** Insufficient USDT after conversion (customer needs to approve again)
- **Mitigation:** Monitor actual slippage in first 30 days, adjust buffer to 3% if needed (requires customer agreement update)

**Risk 4: Table Consolidation Migration Failure**
- **Impact:** Data loss, trading pipeline broken
- **Mitigation:** Zero-downtime migration with side-by-side tables, rollback script tested in staging, 30-day deprecation period before deletion

**Risk 5: Platform Fee Bug Impact on Existing Back-Tests**
- **Impact:** Public website shows incorrect historical performance
- **Mitigation:** Rerun all 24,818 back-tests with corrected fee logic, display "Recalculated Jan 2026" badge

---

#### Success Metrics

**Week 1 Validation (Days 1-7):**
- ✅ Table consolidation complete, zero data loss
- ✅ Platform fees charged correctly on 5+ deposits
- ✅ VALR transfers successful (100% success rate)
- ✅ Back-tester bug fixed, public data refreshed

**Week 2 Validation (Days 8-14):**
- ✅ Performance fees calculated correctly for 3+ customers
- ✅ HWM logic matches back-tester (zero discrepancy)
- ✅ Withdrawal interim fees tested (3+ scenarios)
- ✅ BTC conversion approval workflow functional

**Week 3 Production (Days 15-21):**
- ✅ First monthly invoice sent to all active customers
- ✅ Admin UI fee management functional
- ✅ Customer agreements updated and re-signed
- ✅ Revenue tracking dashboard accurate

**Financial Impact:**
- Platform fees: ~$50-100/month per customer (assuming $10K/month deposits at 0.75%)
- Performance fees: Variable (10% on profits)
- Target: $500-1,000 monthly recurring revenue by end of implementation

---

**Implementation Start Date:** January 21, 2026  
**Estimated Completion:** February 10, 2026  
**Status:** Phase 0 (Table Consolidation) in progress

---

## 🗓️ Week 3 Roadmap (Jan 24-31)

### Withdrawal Request System
**Status:** PLANNED  
**Effort:** 6-8 hours  
**Value:** HIGH (customer self-service)

**Components:**
1. Database table: `public.withdrawal_requests` (already designed)
2. Edge function: `ef_withdrawal_request_submit`
3. Admin UI: Withdrawal approval workflow
4. Edge function: `ef_process_withdrawal` (VALR API integration)
5. Customer portal: Request form + status tracking

**Current Workaround:** Manual withdrawals via email to support@bitwealth.co.za

---

### Support Ticket System
**Status:** PLANNED  
**Effort:** 5-6 hours  
**Value:** MEDIUM (customer service)

**Components:**
1. Database table: `public.support_requests` (already designed)
2. Edge function: `ef_support_request_submit`
3. Admin UI: Ticket management dashboard
4. Customer portal: Submit ticket form + view ticket history
5. Email notifications: New ticket, status updates

**Current Workaround:** Email-based support via support@bitwealth.co.za

---

### Advanced Reporting Features
**Status:** PLANNED  
**Effort:** 4-5 hours  
**Value:** LOW (nice-to-have)

**Features:**
- Performance charts (NAV over time)
- Trade history visualization
- Fee breakdown analysis
- Benchmark comparison charts (LTH PVR vs Standard DCA)

---

## 🗓️ Week 4 Roadmap (Jan 31 - Feb 7)

### Performance Optimization
- Database query optimization
- Index analysis and creation
- Edge function cold start reduction
- Caching strategy for dashboard data

### Customer Acquisition Features
- Referral program (refer-a-friend)
- Promotional landing pages
- Email marketing integration (Mailchimp/SendGrid)
- Analytics tracking (Google Analytics)

### Marketing Launch
- Social media campaign
- Content marketing (blog posts)
- Paid advertising (Google Ads, Facebook)
- Partnership outreach

---

## 📊 Success Metrics (Week 1-4)

### Week 1 Targets (Jan 10-17) ✅ ON TRACK
- ✅ Zero critical bugs reported
- ✅ Public back-test tool functional
- ⏳ 2-5 pilot customers onboarded
- ⏳ 90%+ uptime for edge functions
- ⏳ Email delivery rate > 95%

### Week 2 Targets (Jan 17-24)
- [✅] Transaction history implemented (Jan 5)
- [✅] Statement generation functional (Jan 15)
- [✅] UI transformation complete (Jan 14)
- [ ] 5-10 active customers
- [ ] < 24hr response time for support requests

### Week 3 Targets (Jan 24-31)
- [ ] Withdrawal system operational
- [ ] Support ticket system live
- [ ] 10-20 active customers
- [ ] Average order execution time < 30 seconds

### Week 4 Targets (Jan 31 - Feb 7)
- [ ] Marketing campaign launched
- [ ] 20-50 active customers
- [ ] Customer satisfaction > 4.5/5 stars
- [ ] Referral program active

---

## 🐛 Known Issues / Technical Debt

### Minor Issues (Non-Blocking)
1. **Portal dashboard**: No loading spinner during balance fetch (confusing for slow connections)
2. **Admin UI**: KYC document sometimes requires page refresh to display after upload
3. **Email templates**: Some clients (Outlook 2010) render Aptos font incorrectly (fallback to Arial)

### Technical Debt (Future Refactoring)
1. **Supabase client initialization**: Duplicated code across edge functions (needs shared module)
2. **Error handling**: Inconsistent error response formats across edge functions
3. **RPC function permissions**: Some functions use SECURITY DEFINER unnecessarily
4. **Database migrations**: Need migration rollback scripts for disaster recovery

---

## 🚀 Next Action Items (Priority Order)

1. **✅ COMPLETE (Jan 5):** Transaction history deployed
2. **✅ COMPLETE (Jan 14):** UI transformation complete
3. **✅ COMPLETE (Jan 15):** Statement generation deployed
4. **Jan 16-17:** Test December 2025 statement generation with Customer 31
5. **Jan 17-20:** Begin Admin Portal UX improvements (search, filters, bulk ops)
6. **Jan 20-24:** Statement generation enhancements (logo, YTD summary, disclaimers)
7. **Jan 24:** Begin withdrawal request system planning

---

## 📝 Notes

- **Customer 31 (Jemaica Gaier)** is primary test account for portal features
- **Customer 39 (Integration TestUser)** used for integration testing only
- Production domain: https://bitwealth.co.za (SSL configured)
- Admin UI accessible at: https://bitwealth.co.za/ui/Advanced%20BTC%20DCA%20Strategy.html
- Customer portal: https://bitwealth.co.za/customer-portal.html

---

**Document Status:** Active roadmap  
**Last Updated:** January 15, 2026  
**Next Review:** January 17, 2026 (Week 2 mid-point)
