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

### Priority 1: Transaction History View 🎯 NEXT
**Status:** NOT STARTED  
**Effort:** 2-3 hours  
**Value:** HIGH (customer-facing visibility)

**Implementation Plan:**
1. **Database Layer**
   - Create RPC function: `public.list_customer_transactions(p_customer_id BIGINT, p_limit INT)`
   - Returns: trade_date, kind, amount_btc, amount_usdt, fee_btc, fee_usdt, note
   - Source: `lth_pvr.ledger_lines` table
   - Security: RLS policy ensures customers see only their own transactions

2. **UI Layer** (`website/customer-portal.html`)
   - Add "Transactions" section below dashboard stats
   - Simple table: Date | Type | BTC | USDT | Fee | Note
   - Color coding:
     - Green: deposits, BUY orders
     - Red: withdrawals, SELL orders
     - Blue: fees
   - Display last 50 transactions (paginated)
   - Responsive design for mobile

3. **Testing**
   - Test with Customer 31 (has deposit + withdrawal transactions)
   - Verify RLS policy prevents cross-customer access
   - Test with zero transactions (new customer)
   - Test with 50+ transactions (pagination)

**Files to Create/Modify:**
```
supabase/migrations/
  20260117_add_list_customer_transactions_rpc.sql

website/
  customer-portal.html (lines 200-280, add Transactions section)
```

**Success Criteria:**
- ✅ Customer can view all trading activity
- ✅ Deposits/withdrawals from balance reconciliation visible
- ✅ Exchange fees and BitWealth fees clearly shown
- ✅ Data refreshes when balance updates

---

### Priority 2: Statement Generation (PDF Download)
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

### Priority 3: Admin Portal UX Improvements
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

1. **TODAY (Jan 14):** Create transaction history RPC function
2. **TODAY (Jan 14):** Add Transactions section to customer portal UI
3. **TODAY (Jan 14):** Test with Customer 31 (verify data displays correctly)
4. **Jan 15:** Deploy transaction history to production
5. **Jan 15:** Monitor for errors/performance issues
6. **Jan 17:** Begin statement generation feature
7. **Jan 20:** Begin admin portal UX improvements

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
