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

**Impact:** Public back-test tool now production-ready with accurate results.

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

### Priority 2: UI Transformation 🎯 CURRENT PRIORITY
**Status:** NOT STARTED  
**Effort:** 4-6 hours  
**Value:** HIGH (professional appearance, better UX)

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
**Status:** NOT STARTED  
**Effort:** 4-6 hours  
**Value:** MEDIUM (monthly reporting)

**Implementation Plan:**
1. **Backend Edge Function**
   - Create `ef_generate_statement_pdf`
   - Parameters: customer_id, year, month
   - Queries:
     - `lth_pvr.balances_daily` (opening/closing NAV)
     - `lth_pvr.ledger_lines` (all transactions)
     - `customer_portfolios` (strategy details)
     - `lth_pvr.std_dca_balances_daily` (benchmark comparison)
   - Generate PDF using jsPDF library
   - Return as downloadable blob

2. **PDF Design**
   - Header: BitWealth logo, customer name, statement period
   - Section 1: Performance Summary
     - Opening balance, closing balance, net change
     - ROI %, CAGR %
     - Total fees paid
   - Section 2: Transaction History
     - Table of all transactions for month
   - Section 3: Benchmark Comparison
     - LTH PVR vs Standard DCA chart
   - Footer: Disclaimer, contact info

3. **UI Integration**
   - Add "Download Statement" button to portal dashboard
   - Month/year selector dropdown
   - Generate on-demand (no pre-generation)

**Deferred to:** Jan 20-22 (Week 2 mid-point)

---

### Priority 4: Admin Portal UX Improvements
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
- [ ] Transaction history implemented
- [ ] Statement generation functional
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

1. **TODAY (Jan 14):** ✅ COMPLETE - Transaction history already deployed
2. **TODAY (Jan 14):** Begin UI transformation - Add portal.css to customer-portal.html
3. **TODAY (Jan 14):** Restructure customer-portal.html with sidebar layout
4. **TODAY (Jan 14):** Update stats display to use dashboard-stats grid
5. **Jan 15:** Complete UI transformation and test thoroughly
6. **Jan 15:** Delete portal.html demo file
7. **Jan 17:** Begin statement generation feature
8. **Jan 20:** Begin admin portal UX improvements

---

## 📝 Notes

- **Customer 31 (Jemaica Gaier)** is primary test account for portal features
- **Customer 39 (Integration TestUser)** used for integration testing only
- Production domain: https://bitwealth.co.za (SSL configured)
- Admin UI accessible at: https://bitwealth.co.za/ui/Advanced%20BTC%20DCA%20Strategy.html
- Customer portal: https://bitwealth.co.za/customer-portal.html

---

**Document Status:** Active roadmap  
**Last Updated:** January 14, 2026  
**Next Review:** January 17, 2026 (Week 2 planning)
