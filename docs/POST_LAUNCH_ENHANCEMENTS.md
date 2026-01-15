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
**Status:** NOT STARTED  
**Effort:** 3-4 hours  
**Value:** MEDIUM (operational efficiency)

**Planned Improvements:**
1. **Customer Search/Filter**
   - Search by name, email, customer_id
   - Filter by status (prospect, kyc, setup, deposit, active, inactive)
   - Sort by creation date, NAV, status

2. **Bulk Operations**
   - Select multiple KYC documents for approval
   - Batch status changes
   - Export customer list to CSV

3. **KYC Document Viewer Enhancements**
   - Larger modal for document review
   - Zoom in/out functionality
   - Side-by-side comparison (ID vs selfie)
   - Rejection reason dropdown with notes

4. **Dashboard Metrics**
   - Total active customers
   - Total AUM (assets under management)
   - Monthly performance summary
   - Alert counts by severity

**Deferred to:** Jan 23-24 (Week 2 end)

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
