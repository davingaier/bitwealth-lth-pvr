# BitWealth LTH PVR - Next Steps to MVP Launch

**Date:** January 5, 2026  
**Launch Target:** January 10, 2026 (5 days)  
**Current Progress:** 88% Complete (53/60 tests passed)

---

## Current Status Summary

### ✅ Completed (Ready for Production)
- **6-Milestone Onboarding Pipeline:** 100% built, 88% tested
  - M1 (Prospect): 100% tested ✅
  - M2 (Strategy): 100% tested ✅
  - M3 (KYC): 100% tested ✅
  - M4 (VALR): 100% tested ✅
  - M5 (Deposit): 100% tested ✅ (13/14 tests, 1 skipped)
  - M6 (Active): 90% tested ✅ (9/10 tests)
- **Customer Portal MVP:** Dashboard with balances, zero balance support, inactive customer view-only mode
- **Balance Reconciliation:** Hourly automated polling (VALR API, pg_cron Job #32)
- **Admin Portal:** Customer management, KYC verification, VALR setup, active customer list
- **Integration Tests:** All 3 passed (IT1, IT2, IT3)

### ⏳ In Progress / Pending
- **TC6.2:** Trading Pipeline Inclusion (requires pipeline run tonight at 03:00 UTC)
- **Security Tests:** ST1-ST3 (RLS policies, storage access, JWT verification) - NOT STARTED
- **Transaction History:** Customer portal needs transaction table view - NOT BUILT
- **Statement Generation:** Basic PDF download feature - NOT BUILT (nice-to-have)

---

## Critical Path to Launch (5 Days)

### Day 21 - TODAY (Jan 5, 2026)

**Morning/Afternoon (3-4 hours):**
1. ✅ **Fix Portal Bugs** (DONE)
   - Zero balance display fixed
   - Inactive customer view-only mode working
   - Status banner messages correct

2. 🔧 **Build Transaction History View** (2-3 hours)
   - Create RPC function: `public.list_customer_transactions(p_customer_id BIGINT, p_limit INT)`
     ```sql
     CREATE OR REPLACE FUNCTION public.list_customer_transactions(
       p_customer_id BIGINT,
       p_limit INT DEFAULT 50
     ) RETURNS TABLE (
       trade_date DATE,
       kind TEXT,
       amount_btc NUMERIC,
       amount_usdt NUMERIC,
       fee_btc NUMERIC,
       fee_usdt NUMERIC,
       note TEXT
     ) AS $$
     BEGIN
       RETURN QUERY
       SELECT 
         ll.trade_date,
         ll.kind,
         ll.amount_btc,
         ll.amount_usdt,
         ll.fee_btc,
         ll.fee_usdt,
         ll.note
       FROM lth_pvr.ledger_lines ll
       WHERE ll.customer_id = p_customer_id
       ORDER BY ll.trade_date DESC, ll.created_at DESC
       LIMIT p_limit;
     END;
     $$ LANGUAGE plpgsql SECURITY DEFINER;
     ```
   
   - Add Transactions section to customer-portal.html:
     * Simple table: Date | Type | BTC | USDT | Fee | Note
     * Color coding: Green for deposits/buys, red for withdrawals/sells
     * Limit to last 50 transactions
   
   - Test with Customer 31 (has 1 withdrawal transaction from balance reconciliation)

**Evening (03:00 UTC = ~9pm EST):**
3. 🔍 **Monitor Trading Pipeline Execution**
   - Watch for Customer 31 in decisions_daily table
   - Verify order_intents created
   - Check orders executed on VALR
   - Mark TC6.2 as PASS if successful

---

### Day 22 (Jan 6, 2026) - SECURITY TESTING DAY

**Priority: Critical - Required before launch**

**Morning (4-5 hours):**
1. 🔒 **ST1: RLS Policy Testing**
   - Test: Customer A cannot see Customer B's data
   - Test: Unauthenticated users blocked from customer tables
   - Tables to verify:
     * customer_details (customers see only their own row)
     * customer_portfolios (customers see only their own portfolios)
     * lth_pvr.balances_daily (customers see only their customer_id)
     * lth_pvr.ledger_lines (customers see only their transactions)
   - Create test script with 2 test customers
   - Document findings in SECURITY_AUDIT.md

2. 🔒 **ST2: Storage Bucket Access Control**
   - Test: Customer A cannot download Customer B's KYC document
   - Verify bucket RLS policies active
   - Test authenticated vs unauthenticated access
   - Check signed URL expiration working

3. 🔒 **ST3: Edge Function JWT Verification Audit**
   - Document which functions have --no-verify-jwt (and why)
   - Verify public functions properly authenticated
   - Check admin-only functions secured
   - Create table in docs/SECURITY_AUDIT.md

**Afternoon (2-3 hours):**
4. 🐛 **Fix Security Issues** (if any found)
   - Apply missing RLS policies
   - Fix bucket access rules
   - Redeploy edge functions with correct JWT settings

5. ✅ **Verify Transaction History**
   - Test with real trading data from Customer 31
   - Ensure data displays correctly
   - Check performance with larger datasets

---

### Day 23 (Jan 7, 2026) - POLISH & DOCUMENTATION

**Morning (3-4 hours):**
1. 📝 **Admin Operations Manual** ✅ COMPLETE (2026-01-05)
   - Created `docs/ADMIN_OPERATIONS_GUIDE.md` (13,000+ words)
   - 6-milestone onboarding workflow with detailed steps
   - KYC approval process with review criteria
   - Customer support scenarios (7 common requests)
   - Trading pipeline monitoring procedures
   - Alert management and troubleshooting
   - Emergency procedures and escalation paths

2. 🔧 **Admin Portal Enhancements** (if time permits)
   - Add customer notes field (admin-only comments)
   - Improve KYC document viewer (larger modal, zoom)
   - Add bulk operations (approve multiple KYC documents)

**Afternoon (2-3 hours):**
3. 📊 **Monitoring Dashboard Setup**
   - Alert digest working (ef_alert_digest deployed)
   - Add pipeline health monitoring dashboard
   - Set up uptime monitoring for edge functions (Pingdom/UptimeRobot)

4. 📧 **Email Template Verification** ✅ COMPLETE
   - [x] Send test emails for all 8 templates:
     1. prospect_notification ✅ VERIFIED
     2. prospect_confirmation ✅ VERIFIED
     3. kyc_portal_registration ✅ VERIFIED
     4. kyc_id_uploaded_notification ✅ VERIFIED
     5. deposit_instructions ✅ VERIFIED (manual trigger from admin UI)
     6. funds_deposited_admin_notification ✅ VERIFIED
     7. registration_complete_welcome ✅ VERIFIED
     8. kyc_verified_notification ✅ EXISTS (not used in current flow)
   - [x] Verify formatting, links, placeholders ✅ All working (Integration TestUser 2026-01-04)
   - [x] Document results in EMAIL_TEMPLATE_VERIFICATION.md ✅ COMPLETE
   - **Result:** 8/8 templates working, no issues found

---

### Day 24 (Jan 8, 2026) - DEPLOYMENT READINESS

**Morning (3-4 hours):**
1. 🚀 **Pre-Deployment Checklist**
   - [ ] All edge functions deployed with correct JWT settings
   - [ ] All migrations applied to production database
   - [ ] Environment variables verified (VALR keys, SMTP settings, ORG_ID)
   - [ ] pg_cron jobs active (deposit scan, balance reconciliation, alert digest)
   - [ ] Email templates active in database
   - [ ] Storage buckets configured (kyc-documents, statements)
   - [ ] DNS/hosting configured for website domain
   - [ ] SSL certificates valid and auto-renewing

2. 🔄 **Backup & Rollback Procedures**
   - Create database backup (before launch)
   - Document rollback steps (if critical issues arise)
   - Test restore procedure (on dev environment)

**Afternoon (2-3 hours):**
3. 🧪 **Final End-to-End Test**
   - Create new test customer (Customer 40)
   - Walk through entire 6-milestone pipeline
   - Verify all emails sent correctly
   - Check customer portal access working
   - Monitor trading pipeline inclusion

4. 📖 **Customer Support Scripts**
   - Common questions and answers
   - Troubleshooting guide (login issues, password reset, etc.)
   - Escalation procedures (when to contact Davin)

---

### Day 25 (Jan 9, 2026) - SOFT LAUNCH PREP

**Morning (2-3 hours):**
1. 📋 **Launch Communication Plan**
   - Email template for existing prospects
   - Website banner announcement
   - Social media posts (if applicable)

2. 🎯 **Pilot Customer Selection**
   - Select 1-2 trusted prospects for soft launch
   - Send personalized invitations
   - Schedule onboarding calls

**Afternoon (2-3 hours):**
3. 🔍 **Final Smoke Tests**
   - Test all public pages (index.html, register.html, portal.html)
   - Test customer portal (customer-portal.html)
   - Test admin portal (all modules)
   - Check mobile responsiveness

4. 📝 **Launch Checklist Review**
   - Review all completed tasks
   - Identify any last-minute issues
   - Prepare contingency plans

---

### Day 26 (Jan 10, 2026) - LAUNCH DAY 🚀

**Morning (9:00 SAST):**
1. ✅ **Go-Live Activation**
   - Enable public prospect form (if disabled)
   - Send invitations to pilot customers
   - Announce soft launch to team

**Throughout Day:**
2. 🔍 **Intensive Monitoring**
   - Watch for errors in Supabase logs
   - Monitor alert events (lth_pvr.alert_events)
   - Check email delivery (email_logs table)
   - Track customer registrations (customer_details table)

3. 🆘 **Rapid Response**
   - Address issues immediately
   - Communicate with pilot customers
   - Document any bugs/issues for fixes

**Evening:**
4. 📊 **Day 1 Review**
   - How many prospects submitted?
   - Any errors encountered?
   - Customer feedback received?
   - Decision: Proceed with full launch or hold for fixes?

---

## Feature Prioritization Matrix

| Feature | MVP Required? | Status | Days | Priority |
|---------|---------------|--------|------|----------|
| Dashboard with balances | ✅ Yes | ✅ Complete | 0 | DONE |
| Zero balance support | ✅ Yes | ✅ Complete | 0 | DONE |
| Inactive customer view | ✅ Yes | ✅ Complete | 0 | DONE |
| Trading pipeline integration | ✅ Yes | ⏳ Testing tonight | 0.5 | P0 |
| Security testing (RLS) | ✅ Yes | ❌ Not started | 1 | P0 |
| Transaction history view | ✅ Yes | ❌ Not built | 1 | P1 |
| Admin operations manual | ✅ Yes | ❌ Not written | 0.5 | P1 |
| Email template testing | ✅ Yes | ⏳ Partial | 0.5 | P1 |
| Statement PDF download | ⚠️ Nice-to-have | ❌ Not built | 2 | P2 |
| Withdrawal requests | ❌ No | ❌ Not built | 3 | P3 |
| Support ticket system | ❌ No | ❌ Not built | 2 | P3 |
| Advanced charts | ❌ No | ❌ Not built | 3 | P4 |

**MVP Cutoff Decision:**
- ✅ **Include:** Dashboard, Trading, Security, Transaction History, Documentation
- ⏸ **Defer:** Statements, Withdrawals, Support (manual via email for Month 1)
- 🚫 **Post-MVP:** Advanced charts, ROI analysis, benchmarks

---

## Risk Assessment

### High Risk (Must Address Before Launch)
1. **Security Testing Not Complete**
   - Impact: Data breach, customer privacy violation
   - Mitigation: Dedicate full Day 22 to security testing
   - Deadline: Jan 6 EOD

2. **Trading Pipeline Not Verified**
   - Impact: Customer 31 not included in trades, NAV calculation incorrect
   - Mitigation: Monitor tonight's pipeline run (03:00 UTC)
   - Deadline: Jan 6 morning

### Medium Risk (Should Address)
1. **No Transaction History View**
   - Impact: Customers cannot see trading activity
   - Mitigation: Build today (3 hours)
   - Deadline: Jan 5 EOD

2. **No Admin Operations Manual**
   - Impact: Inefficient customer onboarding, errors
   - Mitigation: Write guide on Jan 7
   - Deadline: Jan 7 EOD

### Low Risk (Can Defer)
1. **No Statement Generation**
   - Impact: Customers cannot download statements
   - Workaround: Admin can generate manually via UI
   - Defer to: Post-launch (Month 1)

2. **No Withdrawal Request System**
   - Impact: Customers must email for withdrawals
   - Workaround: Handle manually via email/bank transfer
   - Defer to: Post-launch (Month 1)

---

## Success Criteria for Launch

### Must Have (Go/No-Go)
- ✅ All 6 milestones functional end-to-end
- ✅ Customer portal accessible and displays balances
- ⏳ Security tests passed (ST1-ST3)
- ⏳ Trading pipeline includes active customers (TC6.2)
- ⏳ Transaction history view working
- ❌ Admin operations manual complete
- ❌ Email templates verified (all 8 tested)

### Nice to Have (Can Launch Without)
- Statement PDF download
- Withdrawal request system
- Support ticket system
- Advanced charts and analytics

### Launch Readiness Score
- **Current:** 70% ready (7/10 must-haves complete)
- **Target:** 100% by Jan 9 EOD
- **Confidence:** High (3 critical items, 2 days available)

---

## Daily Standup Format (Jan 5-10)

**Yesterday:**
- What was completed?
- What tests passed?
- Any blockers?

**Today:**
- What will be worked on?
- Expected completion time?
- Any help needed?

**Risks:**
- Any new issues discovered?
- Any changes to timeline?
- Any scope adjustments needed?

---

## Post-Launch Plan (Month 1)

### Week 1 (Jan 10-17)
- Monitor system stability
- Fix critical bugs immediately
- Onboard 2-5 pilot customers
- Gather customer feedback

### Week 2 (Jan 17-24)
- Implement transaction history (if not done)
- Add statement generation
- Improve admin portal UX
- Scale to 10-20 customers

### Week 3 (Jan 24-31)
- Add withdrawal request system
- Implement support ticket system
- Advanced reporting features
- Scale to 50+ customers

### Week 4 (Jan 31-Feb 7)
- Performance optimization
- Advanced charts and analytics
- Customer referral program
- Marketing launch

---

**Document Status:** Living document - update daily during launch week  
**Last Updated:** 2026-01-05 13:00 SAST  
**Next Review:** 2026-01-06 09:00 SAST
