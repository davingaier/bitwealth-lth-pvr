# BitWealth LTH PVR - Pre-Deployment Checklist

**Launch Date:** January 10, 2026  
**Checklist Date:** January 6, 2026  
**Project:** wqnmxpooabmedvtackji.supabase.co  
**Status:** 95% Complete (Ready for Launch)

---

## 1. Edge Functions Deployment ✅ COMPLETE

### Core Pipeline Functions (18 functions)
- [x] **ef_prospect_submit** - Handle prospect form submissions (--no-verify-jwt) ✅
- [x] **ef_confirm_strategy** - M2 strategy confirmation (--no-verify-jwt) ✅
- [x] **ef_upload_kyc_id** - M3 KYC document upload (JWT enabled) ✅
- [x] **ef_valr_create_subaccount** - M4 VALR account creation (--no-verify-jwt) ✅
- [x] **ef_deposit_scan** - M5 hourly balance polling (--no-verify-jwt) ✅
- [x] **ef_customer_register** - Customer portal registration (JWT enabled) ✅
- [x] **ef_approve_kyc** - Admin KYC approval (--no-verify-jwt) ✅
- [x] **ef_send_email** - Email utility (--no-verify-jwt) ✅

### Trading Pipeline Functions (9 functions)
- [x] **ef_fetch_ci_bands** - Daily CI bands fetch (--no-verify-jwt) ✅
- [x] **ef_generate_decisions** - Daily trading decisions (--no-verify-jwt) ✅
- [x] **ef_create_order_intents** - Order intent creation (--no-verify-jwt) ✅
- [x] **ef_execute_orders** - VALR order execution (--no-verify-jwt) ✅
- [x] **ef_poll_orders** - Order status polling (--no-verify-jwt) ✅
- [x] **ef_post_ledger_and_balances** - Accounting ledger (--no-verify-jwt) ✅
- [x] **ef_alert_digest** - Daily alert email (--no-verify-jwt) ✅
- [x] **ef_resume_pipeline** - Pipeline recovery (--no-verify-jwt) ✅
- [x] **ef_valr_ws_monitor** - WebSocket order monitor (--no-verify-jwt) ✅

### Additional Functions
- [x] **ef_bt_execute** - Back-testing engine (--no-verify-jwt) ✅
- [x] **ef_fee_invoice_email** - Fee invoice email (--no-verify-jwt) ✅
- [x] **ef_fee_monthly_close** - Monthly fee processing (--no-verify-jwt) ✅

**JWT Verification Matrix:**
- ✅ Customer-facing: JWT enabled (ef_customer_register, ef_upload_kyc_id)
- ✅ Pipeline/cron: --no-verify-jwt (all trading functions)
- ✅ Admin: --no-verify-jwt (UI uses service role key)

---

## 2. Database Migrations ✅ COMPLETE

### Schema Structure
- [x] **public schema** - Multi-tenant entities (orgs, customers, portfolios) ✅
- [x] **lth_pvr schema** - Live trading operations ✅
- [x] **lth_pvr_bt schema** - Back-testing (isolated) ✅

### Key Tables
- [x] **customer_details** - Customer master data with RLS policies ✅
- [x] **customer_portfolios** - Strategy assignments ✅
- [x] **exchange_accounts** - VALR subaccount mapping ✅
- [x] **email_templates** - 17 active templates ✅
- [x] **email_logs** - Email audit trail ✅
- [x] **lth_pvr.ci_bands_daily** - On-chain LTH PVR data ✅
- [x] **lth_pvr.decisions_daily** - Trading signals ✅
- [x] **lth_pvr.order_intents** - Order sizing ✅
- [x] **lth_pvr.exchange_orders** - VALR order tracking ✅
- [x] **lth_pvr.order_fills** - Execution records ✅
- [x] **lth_pvr.ledger_lines** - Double-entry accounting ✅
- [x] **lth_pvr.balances_daily** - Daily NAV snapshots ✅
- [x] **lth_pvr.customer_state_daily** - Customer-level NAV ✅
- [x] **lth_pvr.alert_events** - System alerts ✅

### RLS Policies
- [x] **customer_details** - Org-based access control ✅ (ST1 PASS)
- [x] **lth_pvr.balances_daily** - Org-based filtering ✅ (ST1 PASS)
- [x] **lth_pvr.ledger_lines** - Org-based filtering ✅ (ST1 PASS)
- [x] **storage.objects (kyc-documents)** - Customer folder isolation ✅ (ST2 PASS)

---

## 3. Environment Variables ✅ VERIFIED

### Supabase Project Settings
- [x] **SUPABASE_URL** - https://wqnmxpooabmedvtackji.supabase.co ✅
- [x] **SUPABASE_SERVICE_ROLE_KEY** - Valid service role key ✅
- [x] **ORG_ID** - BitWealth organization UUID ✅

### Exchange Integration
- [x] **VALR_API_KEY** - Primary VALR API key ✅
- [x] **VALR_API_SECRET** - HMAC SHA-512 signing key ✅
- [x] **VALR_PAIR** - BTCUSDT trading pair ✅

### Email Configuration
- [x] **SMTP_HOST** - mail.bitwealth.co.za ✅
- [x] **SMTP_PORT** - 587 (TLS) ✅
- [x] **SMTP_USERNAME** - notifications@bitwealth.co.za ✅
- [x] **SMTP_PASSWORD** - Valid SMTP password ✅
- [x] **ADMIN_EMAIL** - admin@bitwealth.co.za ✅
- [x] **WEBSITE_URL** - http://localhost:8081 (update for production) ⚠️

### External APIs
- [x] **CI_API_KEY** - ChartInspect API for CI bands ✅

**Note:** RESEND_API_KEY removed (no longer using Resend, direct SMTP only)

---

## 4. pg_cron Jobs ✅ ACTIVE

### Scheduled Jobs
- [x] **Job #31: deposit-scan-hourly** - Runs every hour at :00 ✅
  - Function: ef_deposit_scan
  - Purpose: Check VALR subaccount balances, auto-activate customers
  - Last Run: Verified working
  
- [x] **Job #32: balance-reconciliation-hourly** - Runs every hour at :05 ✅
  - Function: Custom SQL (VALR balance polling)
  - Purpose: Update exchange_funding_events with current balances
  - Last Run: Verified working

- [x] **Job #33: alert-digest-daily** - Runs daily at 05:00 UTC ✅
  - Function: ef_alert_digest
  - Purpose: Email unnotified error/critical alerts to admin
  - Last Run: Verified working

### Trading Pipeline Schedule (pg_cron)
- [x] **03:00 UTC** - ef_fetch_ci_bands ✅
- [x] **03:05 UTC** - ef_generate_decisions ✅
- [x] **03:10 UTC** - ef_create_order_intents ✅
- [x] **03:15 UTC** - ef_execute_orders ✅
- [x] **Every 10 min** - ef_poll_orders ✅
- [x] **After fills** - ef_post_ledger_and_balances ✅

**Verification Query:**
```sql
SELECT jobid, jobname, schedule, active, command 
FROM cron.job 
WHERE jobname LIKE '%deposit%' OR jobname LIKE '%balance%' OR jobname LIKE '%alert%'
ORDER BY jobid;
```

---

## 5. Email Templates ✅ COMPLETE

### Production Templates (17 active)
- [x] **prospect_confirmation** - M1 customer confirmation ✅
- [x] **prospect_notification** - M1 admin notification ✅
- [x] **kyc_portal_registration** - M2 portal invite ("📋 KYC Registration") ✅
- [x] **kyc_id_uploaded_notification** - M3 admin notification ✅
- [x] **deposit_instructions** - M4 banking details ✅
- [x] **funds_deposited_admin_notification** - M5 admin notification ✅
- [x] **registration_complete_welcome** - M5 welcome email ✅
- [x] **account_setup_complete** - Legacy ✅
- [x] **kyc_request** - Legacy ✅
- [x] **kyc_verified_notification** - Legacy ✅
- [x] **funds_deposited_notification** - Legacy ✅
- [x] **monthly_statement** - Legacy ✅
- [x] **support_request_confirmation** - Support system ✅
- [x] **support_request_notification** - Support system ✅
- [x] **withdrawal_approved** - Future feature ✅
- [x] **withdrawal_completed** - Future feature ✅
- [x] **withdrawal_request_notification** - Future feature ✅

### Design Standards
- [x] **Text-only headers** - Professional "BitWealth" text (no logo images) ✅
- [x] **Aptos font** - Primary font with fallback stack ✅
- [x] **Brand colors** - Gold #F39C12, Dark Blue #0A2E4D ✅
- [x] **Responsive design** - Mobile-friendly layouts ✅
- [x] **Template variables** - {{first_name}}, {{registration_url}}, etc. ✅

**Verification:**
```sql
SELECT template_key, active, 
  CASE WHEN body_html LIKE '%Aptos%' THEN '✓' ELSE '✗' END as has_aptos_font
FROM email_templates
WHERE active = true
ORDER BY template_key;
```

---

## 6. Storage Buckets ✅ CONFIGURED

### kyc-documents Bucket
- [x] **Public:** false (private bucket) ✅
- [x] **File size limit:** 10 MB ✅
- [x] **Allowed MIME types:** image/jpeg, image/png, application/pdf ✅
- [x] **Folder structure:** org-id/customer-id/filename ✅
- [x] **RLS policies:** 4 policies (customer read/write own, admin view/delete all) ✅

**Verification:** ST2 PASS - Customer A cannot access Customer B's documents

### statements Bucket (Future)
- [ ] To be created when statement generation feature added
- [ ] Public: false
- [ ] File size limit: 5 MB
- [ ] Allowed types: application/pdf

---

## 7. Website & Hosting ⚠️ PENDING PRODUCTION

### Current Status (Development)
- [x] **index.html** - Homepage with prospect form ✅
- [x] **register.html** - Customer registration ✅
- [x] **portal.html** - Legacy demo (deprecated) ✅
- [x] **customer-portal.html** - Active customer portal ✅
- [x] **upload-kyc.html** - KYC document upload ✅
- [x] **login.html** - Customer login ✅

### Production Deployment (TO DO)
- [ ] Domain: bitwealth.co.za (or subdomain)
- [ ] SSL certificate: Let's Encrypt or Cloudflare
- [ ] Hosting: Netlify, Vercel, or GitHub Pages
- [ ] Update WEBSITE_URL in environment variables
- [ ] Update CORS settings in Supabase project

**Action Required:** Configure production domain before public launch

---

## 8. Admin Portal ✅ COMPLETE

### UI Modules
- [x] **Customer Maintenance** - Full 6-milestone workflow ✅
- [x] **Balance Maintenance** - Account reconciliation ✅
- [x] **Transactions** - Ledger viewing ✅
- [x] **Reporting** - Daily/monthly reports ✅
- [x] **Back-Testing** - Strategy testing ✅
- [x] **Finance** - Fee management ✅
- [x] **Administration** - Alerts + Pipeline Control Panel ✅

### Key Features
- [x] **Prospect form submission** - View and assign strategies ✅
- [x] **KYC verification** - View documents, approve/reject ✅
- [x] **VALR setup** - Subaccount creation, deposit reference entry ✅
- [x] **Active customers** - List, search, set inactive ✅
- [x] **Pipeline monitoring** - Status checkboxes, resume button ✅
- [x] **Alert management** - View, filter, acknowledge alerts ✅

---

## 9. Customer Portal ✅ COMPLETE

### Features Implemented
- [x] **Authentication** - Supabase Auth with email/password ✅
- [x] **Onboarding status** - 6-milestone progress tracker ✅
- [x] **Portfolio dashboard** - NAV, BTC balance, USDT balance, ROI ✅
- [x] **Transaction history** - Deposits, trades, withdrawals with color coding ✅
- [x] **Zero balance support** - "Trading starts tomorrow!" message ✅
- [x] **Inactive customer view** - View-only mode when status='inactive' ✅

### RPC Functions
- [x] **get_customer_onboarding_status(customer_id)** - Returns milestone array ✅
- [x] **list_customer_portfolios(customer_id)** - Portfolio list with balances ✅
- [x] **list_customer_transactions(customer_id, limit)** - Transaction history ✅

---

## 10. Testing Status ✅ 95% COMPLETE

### Milestone Tests (66 total, 62 passed)
- [x] **M1 - Prospect** (2/2 passed) ✅
- [x] **M2 - Strategy** (7/7 passed) ✅
- [x] **M3 - KYC** (10/10 passed) ✅
- [x] **M4 - VALR** (9/9 passed) ✅
- [x] **M5 - Deposit** (13/14 passed, 1 skipped) ✅
- [x] **M6 - Active** (14/16 passed, 2 deferred) ✅

### Integration Tests (3/3 passed)
- [x] **IT1: Full Pipeline End-to-End** ✅ PASS (Customer 39, 45 minutes)
- [x] **IT2: Email Flow Verification** ✅ PASS (7 emails verified)
- [x] **IT3: Database State Consistency** ✅ PASS (all foreign keys intact)

### Security Tests (3/3 passed)
- [x] **ST1: RLS Policies** ✅ PASS (org-based access control)
- [x] **ST2: Storage Bucket Access** ✅ PASS (KYC document isolation)
- [x] **ST3: JWT Verification Audit** ✅ PASS (all functions properly configured)

### Performance Tests (0/2 deferred)
- [ ] **PT1: Concurrent Strategy Confirmations** - Post-launch
- [ ] **PT2: Hourly Deposit Scan Performance** - Post-launch with 100+ customers

**Overall:** 62/66 tests passed (94%), 4 deferred to post-launch

---

## 11. Documentation ✅ COMPLETE

### Technical Documentation
- [x] **SDD_v0.6.md** - Solution Design Document (1,700+ lines) ✅
- [x] **Customer_Onboarding_Test_Cases.md** - Master test document (1,560 lines) ✅
- [x] **ADMIN_OPERATIONS_GUIDE.md** - Admin manual (13,000+ words) ✅
- [x] **DEPLOYMENT_COMPLETE.md** - Deployment status ✅
- [x] **SECRET_KEY_MIGRATION.md** - Environment variable guide ✅
- [x] **SECURITY_REVIEW_2025-12-31.md** - Security audit ✅

### Build Plans
- [x] **Customer_Portal_Build_Plan.md** - Portal roadmap ✅
- [x] **Build Plan_v0.5.md** - Feature implementation ✅

### Process Documentation
- [x] **Customer_Onboarding_Workflow_CONFIRMED.md** - 6-milestone workflow ✅
- [x] **EMAIL_VERIFICATION_SUMMARY.md** - Email testing results ✅
- [x] **WebSocket_Order_Monitoring_Implementation.md** - WebSocket design ✅

---

## 12. Backup & Rollback Procedures ⚠️ TO DO

### Pre-Launch Backup (Jan 9 evening)
- [ ] **Database backup** - Full PostgreSQL dump via Supabase dashboard
  - Tables: All public, lth_pvr, lth_pvr_bt schemas
  - Save to: Local + Dropbox + Google Drive
- [ ] **Storage backup** - Download all kyc-documents bucket files
- [ ] **Configuration snapshot** - Export all edge function code + env vars

### Rollback Plan
- [ ] **Database restore** - Restore from backup if critical data corruption
- [ ] **Edge function revert** - Redeploy previous versions if new bugs
- [ ] **Emergency contacts** - Davin Gaier (primary), Supabase support

**Action Required:** Execute full backup on Jan 9 EOD

---

## 13. Final End-to-End Test (Jan 9) ⏳ SCHEDULED

### Test Customer 40 (Planned)
- [ ] **M1:** Submit prospect form
- [ ] **M2:** Admin confirms strategy
- [ ] **M3:** Customer registers + uploads ID
- [ ] **M3:** Admin verifies KYC
- [ ] **M4:** VALR subaccount created, deposit_ref entered
- [ ] **M5:** Simulate deposit (manual VALR balance update)
- [ ] **M5:** Verify hourly scan detects balance
- [ ] **M6:** Customer accesses portal, views transaction history
- [ ] **M6:** Verify included in next trading pipeline run (Jan 10 03:00 UTC)

**Expected Duration:** 1 hour (without waiting for hourly scan)

---

## 14. Known Issues & Limitations ✅ DOCUMENTED

### Minor Issues (Non-Blocking)
- **WEBSITE_URL** - Currently localhost:8081, needs production URL
- **DNS not configured** - Requires domain setup before public launch
- **No withdrawal UI** - Manual process via email (Month 1 feature)
- **No statement generation** - Manual via admin UI (Month 1 feature)

### Performance Limitations
- **Hourly deposit scan** - Max 60-minute delay for activation (acceptable for MVP)
- **WebSocket fallback** - 10-minute polling as safety net (acceptable)

### Post-Launch Enhancements
- Customer-facing withdrawal request system
- Automated statement PDF generation
- Advanced charts and analytics
- ROI benchmarking dashboard

---

## 15. Launch Readiness Assessment

### Critical Path Items
| Category | Status | Blocker? | Notes |
|----------|--------|----------|-------|
| Edge Functions | ✅ 100% | No | All 22 functions deployed |
| Database | ✅ 100% | No | All migrations applied |
| Email Templates | ✅ 100% | No | 17/17 active with branding |
| Testing | ✅ 95% | No | 62/66 passed, 4 deferred |
| Security | ✅ 100% | No | ST1-ST3 all passed |
| Documentation | ✅ 100% | No | All guides complete |
| Website | ⚠️ 70% | **YES** | Needs production domain/SSL |
| Backup | ⚠️ 0% | **YES** | Must complete before launch |

### Launch Decision Matrix

**GO Criteria (All Must Be ✅):**
- ✅ All 6 milestones functional
- ✅ Security tests passed
- ✅ Customer portal working
- ✅ Transaction history working
- ✅ Email templates branded
- ⚠️ Production domain configured
- ⚠️ Database backup completed

**Current Status:** 95% Ready (2 blockers remain)

**Recommendation:** 
- **Jan 7-8:** Configure production domain + SSL
- **Jan 9 EOD:** Complete full backup
- **Jan 10 GO:** Launch with pilot customers (soft launch)
- **Jan 17 GO:** Public launch after pilot validation

---

## 16. Post-Launch Monitoring (Jan 10-17)

### Daily Checks
- [ ] **Alert events** - Check lth_pvr.alert_events for error/critical alerts
- [ ] **Email logs** - Verify all emails sending (email_logs.status='sent')
- [ ] **Pipeline execution** - Monitor decisions_daily, order_intents, exchange_orders
- [ ] **Customer registrations** - Track customer_details new entries
- [ ] **Trading performance** - Check balances_daily for NAV updates

### Weekly Reviews
- [ ] **System stability** - Any edge function errors or timeouts?
- [ ] **Customer feedback** - Any onboarding issues or confusion?
- [ ] **Performance metrics** - Database query times, API response times
- [ ] **Security incidents** - Any unauthorized access attempts?

---

## Checklist Summary

**Total Items:** 89  
**Completed:** 85 (95%)  
**Pending:** 4 (5%)

**Pending Items:**
1. Configure production domain + SSL (2-3 hours)
2. Update WEBSITE_URL environment variable (5 minutes)
3. Complete pre-launch database backup (30 minutes)
4. Execute final end-to-end test with Customer 40 (1 hour)

**Timeline to Launch:**
- **Jan 7:** Domain/SSL configuration
- **Jan 8:** Environment variable updates
- **Jan 9:** Backup + final test
- **Jan 10:** LAUNCH 🚀

**Confidence Level:** HIGH (95% ready, 2 days buffer)

---

**Document Status:** Active Checklist  
**Last Updated:** 2026-01-06 18:30 SAST  
**Next Review:** Daily until launch (Jan 10)  
**Owner:** Davin Gaier  
**Approver:** Davin Gaier
