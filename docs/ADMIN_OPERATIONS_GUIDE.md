# BitWealth Admin Operations Guide

**Version:** 1.1  
**Last Updated:** February 17, 2026  
**For:** BitWealth Operations Team  
**System:** LTH PVR Bitcoin DCA Service

---

## Table of Contents

1. [Overview](#overview)
2. [Daily Operations](#daily-operations)
3. [Customer Onboarding](#customer-onboarding)
4. [KYC Document Review](#kyc-document-review)
5. [Customer Support](#customer-support)
6. [Trading Pipeline Monitoring](#trading-pipeline-monitoring)
7. [Alert Management](#alert-management)
8. [Troubleshooting](#troubleshooting)
9. [Emergency Procedures](#emergency-procedures)
10. [Common Tasks Reference](#common-tasks-reference)

---

## Overview

### System Architecture

**BitWealth LTH PVR** is a Bitcoin Dollar-Cost Averaging service using the Long-Term Holder Price Variance Ratio strategy. The system:
- Accepts new customer prospects via website
- Processes KYC documents for compliance
- Creates VALR subaccounts for isolated trading
- Monitors deposits and activates customers automatically
- Executes daily trading decisions (03:00 UTC)
- Provides customer portal for balance/transaction viewing

### Admin Responsibilities

**Daily Tasks (5-10 minutes):**
- Check alert digest email (sent daily at 05:00 UTC)
- Review new prospect submissions
- Approve pending KYC documents
- Monitor active customer count

**Weekly Tasks (30 minutes):**
- Review trading performance metrics
- Check alert event history for patterns
- Review pending ZAR conversions (age > 7 days may indicate customer needs assistance)
- Verify deposit scanning working correctly
- Audit customer status consistency

**Monthly Tasks (1-2 hours):**
- Fee invoicing and collection
- Performance reporting to customers
- Security policy review
- Backup verification

---

## Daily Operations

### Morning Checklist (09:00 Local Time)

```
□ Check email for alert digest (sent 05:00 UTC = ~11pm prior evening EST)
□ Review any critical/error alerts from overnight
□ Check new prospect submissions (M1)
□ Check pending KYC documents (M3)
□ Check pending ZAR conversions (Administration → Pending ZAR Conversions)
□ Verify yesterday's trading executed successfully
□ Check customer portal functioning (spot check with test account)
```

### Admin Portal Access

**URL:** http://localhost:8000/ui/Advanced%20BTC%20DCA%20Strategy.html  
**Login:** davin@bitwealth.com.au  
**Session:** Persistent (Supabase Auth)

**Key Sections:**
1. **Customer Maintenance** - View/edit customers, approve KYC
2. **Administration** - Alerts, pipeline control, system status, pending ZAR conversions
3. **Reporting** - Customer balances, transaction history
4. **Back-Testing** - Strategy performance analysis

### Alert Monitoring

**Location:** Administration Module → Alert Events

**Alert Badge:**
- Shows count of unacknowledged error/critical alerts
- Updates every 30 seconds
- Click badge to open alert panel

**Alert Severity:**
- 🔴 **Critical:** System failure, requires immediate action
- 🟠 **Error:** Process failure, requires investigation
- 🟡 **Warning:** Potential issue, monitor
- 🔵 **Info:** Informational, no action required

**Daily Actions:**
1. Click alert badge to view events
2. Filter by component to group related issues
3. Click "Ack" (acknowledge) button after reviewing
4. Document recurring issues for engineering team

---

## Customer Onboarding

### 6-Milestone Pipeline

```
M1: PROSPECT → M2: STRATEGY → M3: KYC → M4: VALR → M5: DEPOSIT → M6: ACTIVE
```

#### Milestone 1: Prospect Submission ✅ Automated

**Trigger:** Customer submits website form  
**System Actions:**
1. Creates `customer_details` record (status: `prospect`)
2. Sends email to admin: "New prospect submission"
3. Sends email to customer: "Thanks for your interest"

**Admin Action:** None (proceeds to M2 automatically)

**Monitoring:**
```sql
-- Check recent prospects
SELECT customer_id, first_name, last_name, email, created_at
FROM customer_details
WHERE registration_status = 'prospect'
ORDER BY created_at DESC
LIMIT 10;
```

---

#### Milestone 2: Strategy Selection ✅ Automated

**Trigger:** Automatic after M1  
**System Actions:**
1. Assigns LTH_PVR strategy
2. Creates customer_portfolios record (status: `pending`)
3. Sends email to customer: "Portal registration instructions"
4. Customer creates portal account (Supabase Auth signup)

**Admin Action:** None (customer completes portal registration)

**Monitoring:**
```sql
-- Check customers waiting for portal registration
SELECT cd.customer_id, cd.email, cd.created_at,
       EXTRACT(EPOCH FROM (NOW() - cd.created_at))/3600 as hours_waiting
FROM customer_details cd
LEFT JOIN auth.users au ON au.email = cd.email
WHERE cd.registration_status = 'strategy_selected'
  AND au.id IS NULL
ORDER BY cd.created_at;
```

**Support Tip:** If customer hasn't registered after 24 hours, send follow-up email.

---

#### Milestone 3: KYC Document Upload ⚠️ Requires Admin Approval

**Trigger:** Customer uploads ID document via portal  
**System Actions:**
1. Stores document in `kyc-documents` storage bucket (org-id/customer-id/filename)
2. Updates `customer_details.registration_status` = `kyc_id_uploaded`
3. Sends email to admin: "New KYC document uploaded"
4. Creates alert event (info severity)

**Admin Action Required:** Review and approve/reject KYC document

**How to Approve KYC:**

1. **Open Admin Portal → Customer Maintenance**
2. **Locate customer** in Active Customers list
3. **Click "Review KYC" button** (appears for customers with status `kyc_id_uploaded`)
4. **Review Document:**
   - Photo quality sufficient for identity verification
   - All corners/edges visible
   - Name matches customer_details.first_name and last_name
   - Document not expired
   - Acceptable document types: Passport, Driver's License, National ID

5. **Approve:**
   - Click "Approve KYC" button
   - System creates VALR subaccount automatically (M4)
   - Status changes to `subaccount_created`
   - Customer receives "Deposit Instructions" email

6. **Reject (if document inadequate):**
   - Click "Reject" button
   - Enter reason: "Photo unclear", "Document expired", "Name mismatch", etc.
   - Customer receives rejection email with re-upload instructions
   - Status remains `kyc_id_uploaded` (customer can re-upload)

**KYC Review Criteria:**

| Check | Pass | Fail |
|-------|------|------|
| Document type | Passport/DL/National ID | Other documents |
| Photo quality | Clear, readable text | Blurry, dark, cropped |
| Name match | Exact match to registration | Different name |
| Expiration | Current (not expired) | Expired |
| All corners visible | Yes | Partially cropped |

**Monitoring:**
```sql
-- Check pending KYC approvals
SELECT customer_id, first_name, last_name, email, 
       created_at as registered_at,
       EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as hours_waiting
FROM customer_details
WHERE registration_status = 'kyc_id_uploaded'
ORDER BY created_at;
```

**SLA:** Approve within 24 hours of upload (check twice daily at 09:00 and 17:00 local time)

---

#### Milestone 4: VALR Subaccount & Wallet Setup ⚠️ Requires Admin Action

**Trigger:** Admin approves KYC (M3)  

**System Actions (Automated):**
1. Calls `ef_valr_create_subaccount` edge function
2. Creates VALR subaccount via API (uses main account credentials)
3. Stores subaccount_id in `exchange_accounts` table
4. Updates status to `subaccount_created`

**Admin Actions Required (Manual):**

**Step 1: Create Crypto Wallets in VALR Portal**
1. **Log into VALR Portal:** https://www.valr.com/
2. **Navigate to Subaccounts:**
   - Click "Subaccounts" in main menu
   - Locate customer's subaccount (label: "FirstName LastName - LTH PVR")
   - Click to open subaccount dashboard

3. **Create BTC Wallet:**
   - Click "Wallets" → "Create Wallet"
   - Select "Bitcoin (BTC)"
   - System generates deposit address (starts with `bc1`, `1`, or `3`)
   - **Copy the deposit address** (will look like: `bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh`)

4. **Create USDT Wallet:**
   - Click "Create Wallet" → Select "Tether (USDT-TRC20)"
   - **IMPORTANT:** Select **TRON (TRC20)** network for lowest fees
   - System generates TRON deposit address (starts with `T`)
   - **Copy the deposit address** (will look like: `TYaSrzezRzezRzezRzezRzezRzezRzez12`)
   - ⚠️ **Do NOT use Ethereum (ERC20)** - much higher fees

**Step 2: Enter All Deposit References in Admin UI**
1. Open BitWealth Admin Portal → Customer Maintenance → VALR Setup (M4) tab
2. Locate customer in setup table
3. Click **"Enter All References"** button
4. Modal form will appear with 3 required fields:
   - **ZAR Deposit Reference:** Generate unique code (e.g., `BWDEP7K2M9`)
   - **BTC Wallet Address:** Paste address from VALR portal (from Step 1.3)
   - **USDT Wallet Address:** Paste TRON address from VALR portal (from Step 1.4)
5. **Verify addresses are correct** - incorrect addresses = permanent loss of funds
6. Click **"Save All & Send Email"**

**Step 3: System Sends Deposit Email (Automated)**
- Customer receives email with **all three deposit options:**
  - ZAR bank transfer (Standard Bank, with unique reference)
  - BTC wallet address (with "BTC only" warning)
  - USDT wallet address (with TRON network emphasis)
- Status changes to `deposit` (Milestone 5)
- Customer can choose any deposit method

**Monitoring:**
```sql
-- Check customers waiting for wallet setup
SELECT cd.customer_id, cd.first_name, cd.last_name, cd.email,
       ea.subaccount_id,
       ea.deposit_ref,
       ea.btc_wallet_address,
       ea.usdt_wallet_address,
       ea.created_at as subaccount_created_at,
       EXTRACT(EPOCH FROM (NOW() - ea.created_at))/3600 as hours_waiting
FROM customer_details cd
JOIN customer_portfolios cp ON cd.customer_id = cp.customer_id
JOIN exchange_accounts ea ON cp.exchange_account_id = ea.exchange_account_id
WHERE cd.registration_status = 'subaccount_created'
ORDER BY ea.created_at;
```

**Troubleshooting:**
- If subaccount creation fails, check VALR API credentials in edge function logs
- Verify VALR_API_KEY and VALR_API_SECRET environment variables set
- Check alert events for `ef_valr_create_subaccount` errors
- **VALR wallet addresses are NOT created via API** - must be done manually in VALR portal
- If customer reports "wallet address not working", verify:
  - BTC address starts with `bc1`, `1`, or `3`
  - USDT address starts with `T` and is 34 characters
  - Customer selected TRON network (not Ethereum) for USDT deposits

**SLA:** Complete M4 within 2 hours of KYC approval (including manual wallet creation)

---

#### Milestone 5: Deposit Monitoring ✅ Automated

**Trigger:** Hourly pg_cron job (`ef_deposit_scan`)  
**System Actions:**
1. Queries VALR API for all subaccount balances
2. Compares to previous balance snapshot
3. Detects new deposits (USDT or BTC balance increase)
4. Creates record in `exchange_funding_events` (kind: `deposit`)
5. Runs `ef_balance_reconciliation` to update ledger
6. If first deposit ≥ minimum (e.g., 100 USDT):
   - Updates status to `deposit_received`
   - Sends "Funds Deposited" notification to admin
   - Sends "Welcome to BitWealth" email to customer
   - Status changes to `active` immediately

**Admin Action:** None (fully automated)

**Monitoring:**
```sql
-- Check recent deposits
SELECT cd.customer_id, cd.first_name, cd.last_name,
       efe.asset, efe.amount, efe.occurred_at
FROM exchange_funding_events efe
JOIN customer_details cd ON efe.customer_id = cd.customer_id
WHERE efe.kind = 'deposit'
  AND efe.occurred_at >= NOW() - INTERVAL '7 days'
ORDER BY efe.occurred_at DESC;
```

**Support Scenario: "I deposited but not activated"**
1. Check `exchange_funding_events` for deposit record
2. If no deposit found:
   - Verify deposit reference code matches `exchange_accounts.deposit_ref`
   - Check VALR dashboard for deposit status (may be pending confirmation)
   - Manually run deposit scan: `SELECT net.http_post('https://[project].supabase.co/functions/v1/ef_deposit_scan'...)`
3. If deposit found but status not `active`:
   - Check amount ≥ minimum (e.g., 100 USDT)
   - Verify `ef_balance_reconciliation` ran successfully (check alert events)
   - Manually update status if needed: `UPDATE customer_details SET registration_status = 'active' WHERE customer_id = X;`

---

#### Milestone 6: Active Trading ✅ Automated

**Trigger:** Customer status = `active`  
**System Actions:**
1. Customer included in daily trading pipeline (03:00 UTC)
2. `ef_generate_decisions` creates daily buy/sell/hold decision
3. `ef_create_order_intents` sizes orders based on available capital
4. `ef_execute_orders` places orders on VALR
5. `ef_poll_orders` monitors order fills (every 10 min + WebSocket)
6. `ef_post_ledger_and_balances` updates accounting daily

**Admin Action:** None (monitor alerts for trading errors)

**Monitoring:**
```sql
-- Check active customers included in today's pipeline
SELECT cd.customer_id, cd.first_name, cd.last_name,
       dd.decision, dd.signal_value, dd.ci_high, dd.ci_low
FROM customer_details cd
JOIN lth_pvr.decisions_daily dd ON cd.customer_id = dd.customer_id
WHERE dd.trade_date = CURRENT_DATE
  AND cd.registration_status = 'active'
ORDER BY cd.customer_id;
```

**Customer Portal Access:**
- URL provided in welcome email: http://localhost:8100/customer-portal.html
- Login: customer's email + password (created during M2)
- Features: Dashboard, Transaction History

---

### Onboarding Flowchart

```
┌─────────────────┐
│ M1: PROSPECT    │ ✅ Auto (website form)
│ Submit Info     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ M2: STRATEGY    │ ✅ Auto (assigns LTH_PVR)
│ Select Strategy │    Customer creates portal account
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ M3: KYC UPLOAD  │ ⚠️  ADMIN APPROVAL REQUIRED
│ Upload ID Doc   │    Review document → Approve/Reject
└────────┬────────┘
         │ (approved)
         ▼
┌─────────────────┐
│ M4: VALR SETUP  │ ✅ Auto (creates subaccount)
│ Create Subacct  │    Sends deposit instructions
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ M5: DEPOSIT     │ ✅ Auto (hourly scan)
│ Wait for Funds  │    Activates when ≥ minimum
└────────┬────────┘
         │ (deposit detected)
         ▼
┌─────────────────┐
│ M6: ACTIVE      │ ✅ Auto (daily trading)
│ Trading Active  │    Customer sees dashboard
└─────────────────┘
```

**Critical Milestone:** M3 (KYC Approval) - Only manual step in pipeline

---

## KYC Document Review

### Document Review Process

**Frequency:** Check twice daily (09:00, 17:00 local time) or on alert notification

**Steps:**

1. **Navigate to Admin Portal**
   - Open: http://localhost:8000/ui/Advanced%20BTC%20DCA%20Strategy.html
   - Module: Customer Maintenance

2. **Identify Pending KYC Documents**
   - Look for customers with status `kyc_id_uploaded`
   - Count displayed in status filter dropdown
   - Or check alert events for "KYC document uploaded" notifications

3. **Open Document Viewer**
   - Click customer row to select
   - Click "Review KYC" button
   - Document loads in modal viewer

4. **Review Checklist:**
   ```
   □ Document type acceptable (Passport, Driver's License, National ID)
   □ Photo quality: Clear and readable
   □ All text legible (name, date of birth, document number)
   □ All four corners visible (not cropped)
   □ Document not expired
   □ Name matches customer registration:
     - First name: _______________
     - Last name: _______________
   □ Photo of customer face visible and clear
   □ No obvious signs of tampering or editing
   ```

5. **Approval Decision:**

   **APPROVE** if all checklist items pass:
   - Click "Approve KYC" button
   - Confirmation dialog: "Approve KYC for [Customer Name]?"
   - Click "Yes"
   - System proceeds to M4 (VALR subaccount creation)
   - Customer receives deposit instructions email

   **REJECT** if any checklist item fails:
   - Click "Reject KYC" button
   - Enter rejection reason (examples below)
   - System sends rejection email to customer with reason
   - Customer can re-upload new document
   - Status remains `kyc_id_uploaded`

### Rejection Reason Templates

**Photo Quality Issues:**
- "Document photo is too dark/blurry. Please take a new photo in good lighting with all text clearly visible."
- "Document photo is cropped. Please upload a photo showing all four corners of the document."

**Document Issues:**
- "Document is expired. Please upload a current, valid form of identification."
- "This document type is not acceptable. Please upload a Passport, Driver's License, or National ID card."

**Name Mismatch:**
- "The name on the document does not match your registration. Please contact support if this is an error, or submit a document matching your registered name."

**Potential Fraud:**
- "We require additional verification for your account. Please contact support at support@bitwealth.co.za."

### Database Verification

After approval, verify subaccount creation:

```sql
-- Check customer progressed to M4
SELECT 
  cd.customer_id, 
  cd.registration_status,
  ea.subaccount_id,
  ea.deposit_ref,
  ea.created_at as subaccount_created_at
FROM customer_details cd
LEFT JOIN customer_portfolios cp ON cd.customer_id = cp.customer_id
LEFT JOIN exchange_accounts ea ON cp.exchange_account_id = ea.exchange_account_id
WHERE cd.customer_id = [CUSTOMER_ID];

-- Expected: 
-- registration_status = 'subaccount_created'
-- subaccount_id = VALR subaccount ID
-- deposit_ref = unique reference code (e.g., 'BWDEP7K2M9')
```

If subaccount_id is NULL after 5 minutes:
1. Check alert events for `ef_valr_create_subaccount` errors
2. Check edge function logs in Supabase dashboard
3. Verify VALR API credentials are valid
4. Manually retry: Call `ef_valr_create_subaccount` with customer_id parameter

---

## Customer Support

### Common Support Requests

#### 1. "I forgot my password"

**Resolution:**
1. Customer can use "Forgot Password" link on portal login page
2. Supabase sends password reset email automatically
3. If customer doesn't receive email:
   - Check spam folder
   - Verify email address correct in `customer_details` table
   - Resend via Supabase Auth dashboard (requires service role access)

**Admin Action:** None (self-service via Supabase Auth)

---

#### 2. "I deposited funds but my account isn't active"

**Resolution:**

**Step 1: Verify deposit received**
```sql
-- Check for deposit in exchange_funding_events
SELECT * FROM lth_pvr.exchange_funding_events
WHERE customer_id = [CUSTOMER_ID]
  AND kind = 'deposit'
ORDER BY occurred_at DESC;
```

**Step 2: Check deposit amount**
```sql
-- Get current balance
SELECT * FROM lth_pvr.balances_daily
WHERE customer_id = [CUSTOMER_ID]
ORDER BY trade_date DESC
LIMIT 1;
```

**If deposit found but customer not active:**
1. Verify amount ≥ minimum (100 USDT or equivalent BTC)
2. Check `registration_status`:
   ```sql
   SELECT registration_status FROM customer_details WHERE customer_id = [CUSTOMER_ID];
   ```
3. If status still `subaccount_created`, manually activate:
   ```sql
   UPDATE customer_details 
   SET registration_status = 'active' 
   WHERE customer_id = [CUSTOMER_ID];
   ```
4. Verify customer appears in next day's trading decisions

**If no deposit found:**
1. Check customer used correct deposit reference:
   ```sql
   SELECT deposit_ref FROM exchange_accounts ea
   JOIN customer_portfolios cp ON ea.exchange_account_id = cp.exchange_account_id
   WHERE cp.customer_id = [CUSTOMER_ID];
   ```
2. Check VALR dashboard for pending deposits (may need blockchain confirmations)
3. Manually run deposit scan:
   ```bash
   curl -X POST "https://[project].supabase.co/functions/v1/ef_deposit_scan" \
     -H "Authorization: Bearer [SERVICE_ROLE_KEY]"
   ```
4. If deposit on VALR but not detected:
   - Check deposit reference matches exactly (case-sensitive)
   - Verify pg_cron job `deposit-scan-hourly` is running
   - Check alert events for `ef_deposit_scan` errors

---

#### 3. "I don't see my transactions in the portal"

**Resolution:**

**Step 1: Verify customer is active**
```sql
SELECT registration_status FROM customer_details WHERE customer_id = [CUSTOMER_ID];
-- Expected: 'active'
```

**Step 2: Check if customer has transactions**
```sql
SELECT * FROM lth_pvr.ledger_lines
WHERE customer_id = [CUSTOMER_ID]
ORDER BY trade_date DESC, created_at DESC;
```

**Step 3: Verify portal function working**
```sql
-- Test RPC function directly
SELECT * FROM public.list_customer_transactions([CUSTOMER_ID], 100);
```

**If ledger has transactions but portal shows empty:**
1. Clear browser cache (Ctrl+F5 on portal page)
2. Check browser console for JavaScript errors (F12 → Console tab)
3. Verify Supabase client connection working (check network tab)

**If no transactions in ledger:**
1. Customer may not have completed first trading day yet
2. Check next expected trade date:
   ```sql
   SELECT MAX(trade_date) + INTERVAL '1 day' as next_trade_date
   FROM lth_pvr.decisions_daily
   WHERE customer_id = [CUSTOMER_ID];
   ```
3. Deposits/withdrawals should appear immediately after `ef_balance_reconciliation` runs

---

#### 4. "My dashboard shows $0 balance but I deposited funds"

**Resolution:**

**Step 1: Check balances_daily**
```sql
SELECT * FROM lth_pvr.balances_daily
WHERE customer_id = [CUSTOMER_ID]
ORDER BY trade_date DESC
LIMIT 1;
```

**Step 2: If balances_daily is empty or outdated:**
1. Verify deposit in `exchange_funding_events`
2. Manually run `ef_post_ledger_and_balances` to backfill:
   ```bash
   curl -X POST "https://[project].supabase.co/functions/v1/ef_post_ledger_and_balances" \
     -H "Authorization: Bearer [SERVICE_ROLE_KEY]" \
     -H "Content-Type: application/json" \
     -d '{"from_date":"2026-01-01","to_date":"2026-01-05"}'
   ```
3. Verify balances_daily updated:
   ```sql
   SELECT trade_date, balance_usdt_total, balance_btc_total
   FROM lth_pvr.balances_daily
   WHERE customer_id = [CUSTOMER_ID]
   ORDER BY trade_date DESC
   LIMIT 5;
   ```

---

#### 5. "I want to set up a withdrawal"

**Current Status:** Withdrawal functionality not yet implemented (post-MVP feature)

**Resolution:**
1. Inform customer withdrawals are coming soon (ETA: Q1 2026)
2. For urgent requests, manual withdrawal process:
   - Customer emails support with amount + receiving wallet address
   - Admin verifies customer identity
   - Admin processes withdrawal manually via VALR dashboard
   - Admin records in `exchange_funding_events`:
     ```sql
     INSERT INTO lth_pvr.exchange_funding_events 
     (org_id, customer_id, exchange_account_id, kind, asset, amount, occurred_at, idempotency_key)
     VALUES (
       '[ORG_ID]', [CUSTOMER_ID], '[EXCHANGE_ACCOUNT_ID]', 
       'withdrawal', 'BTC', [AMOUNT], NOW(), 
       'manual-withdrawal-' || [CUSTOMER_ID] || '-' || NOW()::date
     );
     ```
   - Run `ef_post_ledger_and_balances` to update accounting

---

#### 6. "I want to pause trading temporarily"

**Resolution:**

Set customer to `inactive` status:

```sql
-- Pause trading
UPDATE customer_details 
SET registration_status = 'inactive' 
WHERE customer_id = [CUSTOMER_ID];
```

**Effect:**
- Customer excluded from daily trading decisions
- Portal shows "Account Inactive" message
- Balances preserved, no trades executed
- No fees charged

**To reactivate:**
```sql
-- Resume trading
UPDATE customer_details 
SET registration_status = 'active' 
WHERE customer_id = [CUSTOMER_ID];
```

**Note:** Customer will rejoin trading pipeline the next day (03:00 UTC run)

---

#### 7. "My ZAR conversion is stuck as 'pending'"

**Resolution:**

**Scenario:** Customer deposited ZAR via bank transfer and converted some to USDT on VALR, but Admin UI still shows the full amount as pending.

**Step 1: Verify conversion detected**
```sql
-- Check for USDT deposits with ZAR linkage
SELECT 
  funding_id,
  amount as usdt_amount,
  metadata->>'zar_amount' as zar_converted,
  metadata->>'zar_deposit_id' as linked_deposit,
  occurred_at
FROM lth_pvr.exchange_funding_events
WHERE customer_id = [CUSTOMER_ID]
  AND kind = 'deposit'
  AND asset = 'USDT'
  AND metadata->>'zar_deposit_id' IS NOT NULL
ORDER BY occurred_at DESC
LIMIT 5;
```

**Step 2: Check pending conversion status**
```sql
-- View pending ZAR conversions
SELECT 
  funding_id,
  zar_amount as original,
  converted_amount,
  remaining_amount,
  occurred_at
FROM lth_pvr.pending_zar_conversions
WHERE customer_id = [CUSTOMER_ID]
  AND remaining_amount > 0.01
ORDER BY occurred_at DESC;
```

**If conversion not detected:**
1. Verify customer converted on VALR (check VALR transaction history)
2. Manually trigger transaction sync:
   ```powershell
   Invoke-WebRequest `
     -Uri "https://[project].supabase.co/functions/v1/ef_sync_valr_transactions" `
     -Method POST `
     -Headers @{"Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"; "Content-Type" = "application/json"} `
     -Body '{}'
   ```
3. Check Admin UI → Pending ZAR Conversions panel (auto-refreshes every 30 min)
4. If still not detected after manual sync:
   - Verify customer converted in correct subaccount (not main account)
   - Check alert events for `ef_sync_valr_transactions` errors
   - Check VALR transaction type (must be SIMPLE_BUY, LIMIT_BUY, or MARKET_BUY for ZAR→USDT)

**If conversion detected but remaining amount wrong:**
1. May indicate multiple conversions not all synced
2. Check conversion history:
   ```sql
   SELECT 
     occurred_at,
     metadata->>'zar_amount' as zar_amount,
     amount as usdt_amount
   FROM lth_pvr.exchange_funding_events
   WHERE customer_id = [CUSTOMER_ID]
     AND metadata->>'zar_deposit_id' = '[DEPOSIT_FUNDING_ID]'
   ORDER BY occurred_at;
   ```
3. Recalculate and update pending conversion if needed (contact engineering)

**How ZAR Conversion Tracking Works:**
- ✅ **Automatic:** 30-minute auto-sync detects ZAR→USDT conversions on VALR
- ✅ **Zero-touch:** No customer action required after converting on VALR
- ✅ **FIFO allocation:** Conversions allocated to oldest pending deposit first
- ✅ **Smart overflow:** Large conversions automatically split across multiple pendings
- ✅ **Completion threshold:** Remaining < R0.01 treated as completed

---

#### 8. "I converted more ZAR than shows in my pending balance"

**Resolution:**

**Scenario:** Customer says "I converted R100 but portal only shows R50 pending"

**This is expected behavior** - System uses FIFO allocation:

**Example:**
- Customer deposited R75 on Feb 10 (oldest pending)
- Customer deposited R50 on Feb 12 (newest pending)
- Customer converts R100 on VALR
- **System allocates:** R75 to first pending (depletes it), R25 to second pending
- **Result:** First pending completed (removed from UI), second shows R25 remaining

**Verification:**
```sql
-- Show all conversions linked to customer's pending deposits
SELECT 
  efe.occurred_at as conversion_date,
  efe.metadata->>'zar_amount' as zar_converted,
  efe.amount as usdt_received,
  pzc.zar_amount as deposit_amount,
  pzc.occurred_at as deposit_date
FROM lth_pvr.exchange_funding_events efe
JOIN lth_pvr.pending_zar_conversions pzc 
  ON (efe.metadata->>'zar_deposit_id')::uuid = pzc.funding_id
WHERE efe.customer_id = [CUSTOMER_ID]
  AND efe.kind = 'deposit'
  AND efe.asset = 'USDT'
  AND efe.metadata->>'zar_deposit_id' IS NOT NULL
ORDER BY efe.occurred_at DESC;
```

**Customer Communication:**
"Your ZAR conversions are processed in order of deposit (oldest first). When you convert R100 and you have two pending deposits (R75 and R50), the system allocates R75 to complete the first deposit, and R25 toward the second. This is why your pending balance shows less than the total amount you converted."

---

#### 9. "I want to close my account"

**Resolution:**

**Step 1: Verify zero balance or process withdrawal**
```sql
-- Check current balance
SELECT balance_usdt_total, balance_btc_total
FROM lth_pvr.balances_daily
WHERE customer_id = [CUSTOMER_ID]
ORDER BY trade_date DESC
LIMIT 1;
```

If balance > 0:
1. Process withdrawal (see #5 above)
2. Wait for withdrawal confirmation
3. Verify balance = 0

**Step 2: Set account to `cancelled` status**
```sql
UPDATE customer_details 
SET registration_status = 'cancelled'
WHERE customer_id = [CUSTOMER_ID];
```

**Step 3: Close VALR subaccount** (optional, for full cleanup)
1. Login to VALR dashboard
2. Navigate to subaccounts
3. Locate customer's subaccount (use `exchange_accounts.subaccount_id`)
4. Close subaccount (requires zero balance)

**Step 4: Archive data** (retain for compliance)
- Do NOT delete customer_details or transaction records
- Retain for 7 years per financial regulations
- Mark as archived for reporting purposes

---

### Customer Communication

**Email Templates Location:** `email_templates` table

**Available Templates:**
1. prospect_confirmation - "Thanks for your interest"
2. kyc_portal_registration - "Create your portal account"
3. kyc_id_uploaded_notification - "KYC document received" (to admin)
4. deposit_instructions - "How to deposit funds"
5. registration_complete_welcome - "Welcome to BitWealth"

**Sending Manual Email:**
```sql
-- Example: Send custom email via ef_send_email
SELECT net.http_post(
  'https://[project].supabase.co/functions/v1/ef_send_email',
  jsonb_build_object(
    'to_email', 'customer@example.com',
    'subject', 'Your BitWealth Account',
    'body_html', '<p>Message content here</p>'
  ),
  headers => jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer [SERVICE_ROLE_KEY]'
  )
);
```

---

## Trading Pipeline Monitoring

### Pipeline Overview

**Schedule:** Daily at 03:00 UTC (automated via pg_cron)

**6-Step Process:**
1. **CI Bands Fetch** (03:00) - Get LTH PVR bands from ChartInspect
2. **Generate Decisions** (03:05) - Determine buy/sell/hold for each customer
3. **Create Order Intents** (03:10) - Size orders based on available capital
4. **Execute Orders** (03:15) - Place LIMIT orders on VALR
5. **Poll Orders** (every 10 min) - Monitor fills, fallback to MARKET after 5 min
6. **Post Ledger** (after fills) - Update accounting and balances

### Monitoring Dashboard

**Admin Portal → Administration Module → Pipeline Control**

**Status Indicators:**
- ✅ Green checkmark = Step completed
- ⏳ Gray circle = Step pending
- ❌ Red X = Step failed

**Get Pipeline Status:**
```sql
SELECT lth_pvr.get_pipeline_status();
```

**Example Output:**
```json
{
  "trade_date": "2026-01-06",
  "signal_date": "2026-01-05",
  "current_date": "2026-01-06",
  "ci_bands_available": true,
  "window_valid": true,
  "can_resume": true,
  "steps": {
    "ci_bands": true,
    "decisions": true,
    "order_intents": true,
    "execute_orders": true,
    "poll_orders": true,
    "ledger_posted": true
  }
}
```

### Pipeline Resume

**When to Use:**
- CI bands fetch failed (ChartInspect API down)
- Order execution failed (VALR API issue)
- Ledger posting incomplete

**How to Resume:**

**Option 1: Admin Portal (Recommended)**
1. Administration Module → Pipeline Control
2. Check status boxes (see which steps completed)
3. Click "Resume Pipeline" button
4. System sequentially executes incomplete steps

**Option 2: SQL Function**
```sql
-- Resume today's pipeline
SELECT lth_pvr.resume_daily_pipeline();

-- Resume specific date
SELECT lth_pvr.resume_daily_pipeline('2026-01-06'::date);
```

**Validation:** Resume function checks:
- CI bands available (can't trade without signal)
- Trading window valid (03:00-17:00 UTC)
- No duplicate execution (skips completed steps)

### Common Pipeline Issues

#### Issue 1: CI Bands Unavailable

**Symptom:** `ci_bands_available: false` in status

**Causes:**
- CryptoQuant API down or rate limited
- Invalid API key
- Network connectivity issue

**Resolution:**
1. Check alert events for `ef_fetch_ci_bands` errors
2. Verify CryptoQuant API key valid (check environment variables)
3. Wait 30 minutes (guard function retries automatically every 30 min)
4. If still failing after 2 hours, manually fetch:
   ```bash
   curl -X POST "https://[project].supabase.co/functions/v1/ef_fetch_ci_bands" \
     -H "Authorization: Bearer [SERVICE_ROLE_KEY]"
   ```

**Fallback:** Use yesterday's bands (degraded mode):
```sql
-- Copy yesterday's bands to today
INSERT INTO lth_pvr.ci_bands_daily (org_id, trade_date, ci_high, ci_low, ...)
SELECT org_id, CURRENT_DATE, ci_high, ci_low, ...
FROM lth_pvr.ci_bands_daily
WHERE trade_date = CURRENT_DATE - INTERVAL '1 day';

-- Resume pipeline
SELECT lth_pvr.resume_daily_pipeline();
```

---

#### Issue 2: Orders Not Executing

**Symptom:** `execute_orders: false` in status

**Causes:**
- VALR API down
- Invalid API credentials
- Insufficient balance in subaccount
- Network connectivity

**Resolution:**
1. Check alert events for `ef_execute_orders` errors
2. Verify VALR API credentials (VALR_API_KEY, VALR_API_SECRET)
3. Check VALR status page: https://status.valr.com
4. Verify customer balances:
   ```sql
   SELECT customer_id, balance_usdt_total, balance_btc_total
   FROM lth_pvr.balances_daily
   WHERE trade_date = CURRENT_DATE - INTERVAL '1 day'
   ORDER BY customer_id;
   ```
5. Manually retry execution:
   ```bash
   curl -X POST "https://[project].supabase.co/functions/v1/ef_execute_orders" \
     -H "Authorization: Bearer [SERVICE_ROLE_KEY]"
   ```

---

#### Issue 3: Orders Stuck in PENDING

**Symptom:** Orders in `exchange_orders` table with status `PENDING` for > 10 minutes

**Resolution:**
1. Check order status on VALR dashboard
2. If filled on VALR but not updated in system:
   ```sql
   -- Manually update order status
   UPDATE lth_pvr.exchange_orders
   SET status = 'FILLED'
   WHERE order_id = '[ORDER_ID]';
   ```
3. Run poll function to sync:
   ```bash
   curl -X POST "https://[project].supabase.co/functions/v1/ef_poll_orders" \
     -H "Authorization: Bearer [SERVICE_ROLE_KEY]"
   ```

**5-Minute Fallback:** System automatically cancels LIMIT orders after 5 min and places MARKET orders for guaranteed fill

---

#### Issue 4: Ledger Not Posted

**Symptom:** `ledger_posted: false` in status, orders filled but balances not updated

**Resolution:**
1. Verify fills recorded:
   ```sql
   SELECT * FROM lth_pvr.order_fills
   WHERE trade_date = CURRENT_DATE
   ORDER BY created_at;
   ```
2. Manually run post function:
   ```bash
   curl -X POST "https://[project].supabase.co/functions/v1/ef_post_ledger_and_balances" \
     -H "Authorization: Bearer [SERVICE_ROLE_KEY]" \
     -H "Content-Type: application/json" \
     -d "{\"from_date\":\"$(date +%Y-%m-%d)\",\"to_date\":\"$(date +%Y-%m-%d)\"}"
   ```
3. Verify balances updated:
   ```sql
   SELECT customer_id, trade_date, balance_usdt_total, balance_btc_total
   FROM lth_pvr.balances_daily
   WHERE trade_date = CURRENT_DATE
   ORDER BY customer_id;
   ```

---

### Performance Metrics

**Check Trading Activity:**
```sql
-- Today's decisions summary
SELECT 
  decision,
  COUNT(*) as customer_count,
  SUM(order_qty_usdt) as total_usdt_volume
FROM lth_pvr.decisions_daily
WHERE trade_date = CURRENT_DATE
GROUP BY decision;
```

**Check Order Fill Rate:**
```sql
-- Order execution success rate
SELECT 
  status,
  COUNT(*) as order_count,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) as avg_fill_time_minutes
FROM lth_pvr.exchange_orders
WHERE DATE(created_at) = CURRENT_DATE
GROUP BY status;
```

**Check Customer Growth:**
```sql
-- Active customer count by day
SELECT 
  DATE(created_at) as date,
  COUNT(*) as new_active_customers
FROM customer_details
WHERE registration_status = 'active'
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;
```

---

## ZAR Transaction Monitoring

### Pending ZAR Conversions Panel

**Location:** Admin Portal → Administration Module → Pending ZAR Conversions

**Purpose:** Monitor customers who have deposited ZAR via bank transfer and are progressively converting it to USDT on VALR.

### How ZAR Conversion Tracking Works

**Deposit Flow:**
1. Customer deposits ZAR to their VALR subaccount via bank EFT (using unique deposit reference)
2. System detects ZAR deposit via hourly scan (`ef_deposit_scan`)
3. Creates `zar_deposit` funding event
4. Creates pending conversion record in `pending_zar_conversions` table
5. Customer sees their ZAR balance on VALR

**Conversion Flow:**
1. Customer converts ZAR → USDT on VALR (any amount, any time)
2. **Automatic detection** (30-minute auto-sync via `ef_sync_valr_transactions`)
   - Detects SIMPLE_BUY, LIMIT_BUY, or MARKET_BUY transaction types
   - Allocates conversion to oldest pending deposit (FIFO)
   - Updates `pending_zar_conversions.converted_amount` and `remaining_amount`
   - Creates USDT `deposit` funding event with `zar_deposit_id` metadata link
3. If conversion > remaining amount of oldest pending:
   - **Smart overflow** automatically splits across multiple pendings
   - Creates multiple funding events with `split_part` metadata ("1 of 2", "2 of 2")
   - Logs info alert: "Split ZAR→USDT conversion across N pending deposits"
4. When `remaining_amount <= 0.01` (rounding tolerance):
   - Pending conversion marked completed
   - Removed from Admin UI panel
   - System ready for next ZAR deposit

### Monitoring Panel Features

**Auto-Refresh:** Panel updates every 30 minutes (matches sync frequency)

**Displayed Information:**
- Customer name
- Original ZAR deposit amount
- Amount already converted to USDT
- **Remaining ZAR balance** (highlighted, customer must convert this)
- Age of pending conversion (days since deposit)
- Current USDT balance

**Manual Sync:**
- Click "🔄 Sync Now" button to trigger immediate sync
- Useful if customer reports conversion not showing

**No Action Required:**
- ✅ **Zero-touch workflow** - System automatically detects conversions
- ✅ No "Mark Done" buttons or manual steps
- ✅ Customer simply converts on VALR, system handles the rest

### Common ZAR Conversion Patterns

#### Pattern 1: Progressive Conversion (Most Common)
```
Day 1: Deposit R1000 → Pending: R1000
Day 2: Convert R200  → Pending: R800 (auto-detected)
Day 5: Convert R300  → Pending: R500 (auto-detected)
Day 7: Convert R500  → Complete (removed from panel)
```

#### Pattern 2: Smart Overflow Allocation
```
Pending #1: R75 (Feb 10)
Pending #2: R50 (Feb 12)
Convert R100 → System splits:
  - R75 to Pending #1 (depletes it, removed from panel)
  - R25 to Pending #2 (shows R25 remaining)
```

#### Pattern 3: Full Immediate Conversion
```
Day 1: Deposit R500 → Pending: R500
Day 1: Convert R500 → Complete (never appears in panel, filtered by remaining > 0.01)
```

### SQL Queries for ZAR Monitoring

**View all pending conversions:**
```sql
SELECT 
  cd.customer_id,
  cd.first_name || ' ' || cd.last_name as customer_name,
  pzc.zar_amount as original,
  pzc.converted_amount,
  pzc.remaining_amount,
  pzc.occurred_at as deposit_date,
  EXTRACT(EPOCH FROM (NOW() - pzc.occurred_at))/86400 as age_days
FROM lth_pvr.pending_zar_conversions pzc
JOIN customer_details cd ON pzc.customer_id = cd.customer_id
WHERE pzc.remaining_amount > 0.01
ORDER BY pzc.occurred_at ASC;
```

**View conversion history for specific customer:**
```sql
SELECT 
  efe.occurred_at as conversion_date,
  efe.metadata->>'zar_amount' as zar_converted,
  efe.amount as usdt_received,
  efe.metadata->>'is_split_allocation' as is_split,
  efe.metadata->>'split_part' as split_part,
  pzc.zar_amount as original_deposit,
  pzc.converted_amount as total_converted,
  pzc.remaining_amount
FROM lth_pvr.exchange_funding_events efe
JOIN lth_pvr.pending_zar_conversions pzc 
  ON (efe.metadata->>'zar_deposit_id')::uuid = pzc.funding_id
WHERE efe.customer_id = [CUSTOMER_ID]
  AND efe.kind = 'deposit'
  AND efe.asset = 'USDT'
ORDER BY efe.occurred_at DESC;
```

**Check for orphaned conversions (conversions without pending):**
```sql
-- These should be rare - indicates conversion before deposit was synced
SELECT 
  cd.customer_id,
  cd.first_name || ' ' || cd.last_name as customer_name,
  efe.occurred_at,
  efe.metadata->>'zar_amount' as zar_amount,
  efe.amount as usdt_amount
FROM lth_pvr.exchange_funding_events efe
JOIN customer_details cd ON efe.customer_id = cd.customer_id
WHERE efe.kind = 'deposit'
  AND efe.asset = 'USDT'
  AND efe.metadata->>'zar_amount' IS NOT NULL
  AND efe.metadata->>'zar_deposit_id' IS NULL
ORDER BY efe.occurred_at DESC;
```

### Troubleshooting ZAR Conversions

#### Issue: Customer converted but Admin UI still shows full amount pending

**Diagnostic Steps:**
1. Check if conversion detected:
   ```sql
   SELECT COUNT(*) as conversion_count
   FROM lth_pvr.exchange_funding_events
   WHERE customer_id = [CUSTOMER_ID]
     AND metadata->>'zar_deposit_id' = '[DEPOSIT_FUNDING_ID]';
   ```
2. If count = 0, conversion not detected:
   - Verify customer converted in correct subaccount (not main account)
   - Check VALR transaction type (must be SIMPLE_BUY/LIMIT_BUY/MARKET_BUY)
   - Manually trigger sync: Click "🔄 Sync Now" or call `ef_sync_valr_transactions`
3. If count > 0 but remaining amount wrong:
   - Check `pending_zar_conversions.converted_amount` matches sum of conversions
   - May need database trigger re-execution (contact engineering)

#### Issue: Conversion shows as "orphaned" in alerts

**Meaning:** System detected ZAR→USDT conversion but found no matching pending deposit

**Causes:**
1. Customer converted before deposit was synced (timing issue)
2. Customer converted in wrong subaccount
3. Manual ZAR deposit directly to VALR (bypassed our system)

**Resolution:**
1. Check if ZAR deposit exists:
   ```sql
   SELECT * FROM lth_pvr.exchange_funding_events
   WHERE customer_id = [CUSTOMER_ID]
     AND kind = 'zar_deposit'
   ORDER BY occurred_at DESC;
   ```
2. If no ZAR deposit, create manually:
   ```sql
   -- Only if customer confirms they deposited ZAR
   INSERT INTO lth_pvr.exchange_funding_events (
     org_id, customer_id, exchange_account_id, 
     kind, asset, amount, occurred_at, 
     idempotency_key
   ) VALUES (
     '[ORG_ID]', [CUSTOMER_ID], '[EXCHANGE_ACCOUNT_ID]',
     'zar_deposit', 'ZAR', [ZAR_AMOUNT], '[OCCURRED_AT]',
     'manual-zar-deposit-' || [CUSTOMER_ID] || '-' || NOW()
   );
   ```
3. Then manually link conversion to deposit (contact engineering)

---

## Alert Management

### Alert System Overview

**Purpose:** Centralized error tracking and notification

**Components:**
1. **Alert Events Table** (`lth_pvr.alert_events`) - Stores all alerts
2. **Alert Logging Function** (`lth_pvr.raise_alert`) - Creates alerts
3. **Alert Digest Email** (`ef_alert_digest`) - Daily summary (05:00 UTC)
4. **Admin Portal Badge** - Real-time unacknowledged count

### Alert Severities

| Severity | Description | Action Required | SLA |
|----------|-------------|-----------------|-----|
| 🔴 Critical | System failure, trading halted | Immediate action | < 30 min |
| 🟠 Error | Process failure, degraded service | Investigate within 1 hour | < 4 hours |
| 🟡 Warning | Potential issue, monitoring needed | Review daily | < 24 hours |
| 🔵 Info | Informational, no action needed | Acknowledge | None |

### Viewing Alerts

**Admin Portal:**
1. Administration Module → Alert Events section
2. Badge shows count of unacknowledged error/critical alerts
3. Click badge or "View Alerts" button to open panel
4. Filter by:
   - Component (ef_fetch_ci_bands, ef_execute_orders, etc.)
   - Severity (critical, error, warning, info)
   - Date range
5. Click "Ack" button to acknowledge (marks `acknowledged_at`)

**SQL Query:**
```sql
-- View unacknowledged errors/critical
SELECT * FROM public.list_lth_alert_events()
WHERE severity IN ('error', 'critical')
  AND acknowledged_at IS NULL
ORDER BY created_at DESC;
```

### Acknowledging Alerts

**Purpose:** Indicates alert has been reviewed by admin

**Effect:**
- Removes from unacknowledged count
- Excluded from next day's alert digest
- Does NOT resolve the underlying issue (resolution requires fix)

**How to Acknowledge:**

**Option 1: Admin Portal**
- Click "Ack" button next to alert

**Option 2: SQL Function**
```sql
-- Acknowledge single alert
SELECT public.resolve_lth_alert_event([ALERT_ID]);

-- Acknowledge all alerts for a component
UPDATE lth_pvr.alert_events
SET acknowledged_at = NOW()
WHERE component = 'ef_fetch_ci_bands'
  AND acknowledged_at IS NULL;
```

### Alert Digest Email

**Schedule:** Daily at 05:00 UTC (11pm prior evening EST)  
**Recipients:** admin@bitwealth.co.za  
**Content:** Summary of unacknowledged error/critical alerts from past 24 hours

**Sample Email:**
```
Subject: BitWealth LTH PVR - Daily Alert Digest (3 alerts)

Alert Digest for 2026-01-06

You have 3 unacknowledged alerts (2 errors, 1 critical):

CRITICAL ALERTS (1):
- [03:05] ef_fetch_ci_bands: ChartInspect API returned 429 (rate limit)
  Context: {"retry_count": 3, "trade_date": "2026-01-06"}

ERROR ALERTS (2):
- [03:15] ef_execute_orders: No exchange account found for customer 42
  Context: {"customer_id": 42, "intent_id": "..."}
- [10:45] ef_deposit_scan: VALR API timeout after 30s
  Context: {"retry_count": 1}

Please review and acknowledge in the admin portal:
http://localhost:8000/ui/Advanced%20BTC%20DCA%20Strategy.html
```

**Disabling Digest:**
```sql
-- Disable alert digest (emergency use only)
SELECT cron.unschedule('lthpvr_alert_digest');

-- Re-enable
SELECT cron.schedule(
  'lthpvr_alert_digest',
  '0 5 * * *', -- Daily at 05:00 UTC
  $$ SELECT net.http_post(...) $$
);
```

### Component-Specific Alerts

**Common Components:**
- `ef_fetch_ci_bands` - CI bands fetching
- `ef_generate_decisions` - Decision generation
- `ef_create_order_intents` - Order sizing
- `ef_execute_orders` - Order placement
- `ef_poll_orders` - Order monitoring
- `ef_post_ledger_and_balances` - Accounting
- `ef_deposit_scan` - Deposit monitoring
- `ef_sync_valr_transactions` - ZAR conversion detection and allocation (30-min auto-sync)
- `ef_balance_reconciliation` - Balance adjustments
- `ef_approve_kyc` - KYC approval workflow

**Filtering by Component:**
```sql
-- View all ef_execute_orders errors today
SELECT * FROM lth_pvr.alert_events
WHERE component = 'ef_execute_orders'
  AND severity = 'error'
  AND DATE(created_at) = CURRENT_DATE
ORDER BY created_at DESC;
```

---

## Troubleshooting

### Database Queries

**Customer Status Check:**
```sql
-- Full customer status
SELECT 
  cd.customer_id,
  cd.first_name,
  cd.last_name,
  cd.email,
  cd.registration_status,
  cp.status as portfolio_status,
  ea.subaccount_id,
  ea.deposit_ref,
  (SELECT COUNT(*) FROM lth_pvr.balances_daily WHERE customer_id = cd.customer_id) as balance_records,
  (SELECT COUNT(*) FROM lth_pvr.ledger_lines WHERE customer_id = cd.customer_id) as transaction_count
FROM customer_details cd
LEFT JOIN customer_portfolios cp ON cd.customer_id = cp.customer_id
LEFT JOIN exchange_accounts ea ON cp.exchange_account_id = ea.exchange_account_id
WHERE cd.customer_id = [CUSTOMER_ID];
```

**Pipeline Status Check:**
```sql
-- Check if customer in today's pipeline
SELECT 
  dd.customer_id,
  dd.decision,
  dd.signal_value,
  oi.intent_id,
  oi.status as intent_status,
  eo.order_id,
  eo.status as order_status
FROM lth_pvr.decisions_daily dd
LEFT JOIN lth_pvr.order_intents oi ON dd.customer_id = oi.customer_id AND dd.trade_date = oi.intent_date
LEFT JOIN lth_pvr.exchange_orders eo ON oi.intent_id = eo.intent_id
WHERE dd.trade_date = CURRENT_DATE
  AND dd.customer_id = [CUSTOMER_ID];
```

**Balance History:**
```sql
-- Last 7 days of balances
SELECT 
  trade_date,
  balance_usdt_total,
  balance_btc_total,
  nav_usdt,
  ROUND((nav_usdt - LAG(nav_usdt) OVER (ORDER BY trade_date)) / LAG(nav_usdt) OVER (ORDER BY trade_date) * 100, 2) as daily_return_pct
FROM lth_pvr.balances_daily
WHERE customer_id = [CUSTOMER_ID]
ORDER BY trade_date DESC
LIMIT 7;
```

### Common Error Messages

**"No exchange account found for customer"**
- **Cause:** customer_portfolios.exchange_account_id is NULL
- **Fix:** Customer never progressed past M3, KYC not approved or M4 failed
- **Resolution:** Check KYC status, manually approve if needed, verify M4 subaccount creation succeeded

**"ChartInspect API returned 429"**
- **Cause:** Rate limit exceeded on ChartInspect API
- **Fix:** Wait 30 minutes (guard function retries automatically)
- **Resolution:** If persistent, check API key limits or upgrade plan

**"VALR API timeout after 30s"**
- **Cause:** VALR API slow or down
- **Fix:** Check https://status.valr.com
- **Resolution:** Wait and retry, or use resume pipeline function

**"Insufficient balance for order"**
- **Cause:** Customer balance < order size
- **Fix:** Check balances_daily for accurate balance
- **Resolution:** May indicate accounting error, run ef_post_ledger_and_balances to reconcile

---

## Emergency Procedures

### System Outage

**Scenario:** Complete system unavailability (database, edge functions, website)

**Steps:**
1. Check Supabase status: https://status.supabase.com
2. Check Vercel/hosting status (if website hosted separately)
3. If Supabase outage:
   - No action required during outage
   - System will auto-resume when service restored
   - Use pipeline resume function after restoration
4. If prolonged (> 4 hours), notify customers via external email

**Customer Communication Template:**
```
Subject: Temporary Service Interruption

Dear BitWealth Customer,

We are currently experiencing a temporary system outage affecting 
account access and trading. Our technical team is working to restore 
service as quickly as possible.

Your funds are safe and secure. Any missed trades will be processed 
once service is restored.

Expected resolution: [TIME]

We apologize for the inconvenience.

BitWealth Support Team
```

---

### Trading Halt

**Scenario:** Need to stop all trading (e.g., market anomaly, system bug)

**Emergency Trading Halt:**
```sql
-- Set ALL customers to inactive (stops trading immediately)
UPDATE customer_details
SET registration_status = 'inactive'
WHERE registration_status = 'active';

-- Verify halt
SELECT COUNT(*) as active_customers
FROM customer_details
WHERE registration_status = 'active';
-- Expected: 0
```

**Resume Trading:**
```sql
-- Restore all customers to active
UPDATE customer_details
SET registration_status = 'active'
WHERE registration_status = 'inactive'
  AND customer_id IN (
    -- Only customers who were active (have trading history)
    SELECT DISTINCT customer_id FROM lth_pvr.decisions_daily
  );
```

**Partial Halt (Single Customer):**
```sql
UPDATE customer_details
SET registration_status = 'inactive'
WHERE customer_id = [CUSTOMER_ID];
```

---

### Data Corruption

**Scenario:** Incorrect balances, duplicate transactions, or inconsistent data

**Step 1: Identify Affected Customers**
```sql
-- Find customers with potential balance issues
SELECT 
  bd.customer_id,
  bd.trade_date,
  bd.balance_usdt_total,
  bd.balance_btc_total,
  (SELECT SUM(amount_usdt) FROM lth_pvr.ledger_lines WHERE customer_id = bd.customer_id AND trade_date <= bd.trade_date) as calc_usdt,
  (SELECT SUM(amount_btc) FROM lth_pvr.ledger_lines WHERE customer_id = bd.customer_id AND trade_date <= bd.trade_date) as calc_btc
FROM lth_pvr.balances_daily bd
WHERE ABS(bd.balance_usdt_total - (SELECT SUM(amount_usdt) FROM lth_pvr.ledger_lines WHERE customer_id = bd.customer_id AND trade_date <= bd.trade_date)) > 0.01
ORDER BY bd.customer_id, bd.trade_date;
```

**Step 2: Backup Affected Data**
```sql
-- Create backup tables
CREATE TABLE lth_pvr.balances_daily_backup_[DATE] AS
SELECT * FROM lth_pvr.balances_daily WHERE customer_id IN ([AFFECTED_IDS]);

CREATE TABLE lth_pvr.ledger_lines_backup_[DATE] AS
SELECT * FROM lth_pvr.ledger_lines WHERE customer_id IN ([AFFECTED_IDS]);
```

**Step 3: Reconcile**
```sql
-- Delete incorrect balances
DELETE FROM lth_pvr.balances_daily
WHERE customer_id IN ([AFFECTED_IDS])
  AND trade_date >= '[START_DATE]';

-- Regenerate balances
SELECT net.http_post(
  'https://[project].supabase.co/functions/v1/ef_post_ledger_and_balances',
  jsonb_build_object('from_date', '[START_DATE]', 'to_date', CURRENT_DATE::text),
  headers => jsonb_build_object('Authorization', 'Bearer [SERVICE_ROLE_KEY]')
);
```

**Step 4: Verify**
```sql
-- Compare old vs new balances
SELECT 
  b.customer_id,
  b.trade_date,
  bb.balance_usdt_total as old_balance,
  b.balance_usdt_total as new_balance,
  b.balance_usdt_total - bb.balance_usdt_total as difference
FROM lth_pvr.balances_daily b
JOIN lth_pvr.balances_daily_backup_[DATE] bb ON b.customer_id = bb.customer_id AND b.trade_date = bb.trade_date
WHERE ABS(b.balance_usdt_total - bb.balance_usdt_total) > 0.01;
```

---

### Security Breach

**Scenario:** Unauthorized access detected

**Immediate Actions:**
1. **Rotate API Keys:**
   ```bash
   # VALR API keys (via VALR dashboard)
   # Supabase service role key (via Supabase dashboard)
   # CryptoQuant API key (via CryptoQuant dashboard)
   ```

2. **Revoke User Sessions:**
   ```sql
   -- Force logout all users (except service role)
   DELETE FROM auth.sessions;
   ```

3. **Review Audit Logs:**
   ```sql
   -- Check recent admin actions
   SELECT * FROM auth.audit_log_entries
   WHERE created_at >= NOW() - INTERVAL '24 hours'
   ORDER BY created_at DESC;
   ```

4. **Verify Data Integrity:**
   - Check no unauthorized customer changes
   - Verify no unauthorized withdrawals
   - Review RLS policies still intact

5. **Notify Affected Users:**
   - Send password reset emails
   - Notify of security incident (if customer data accessed)

---

## Common Tasks Reference

### Quick Commands

**Check System Health:**
```sql
-- Pipeline status
SELECT lth_pvr.get_pipeline_status();

-- Active customers
SELECT COUNT(*) FROM customer_details WHERE registration_status = 'active';

-- Recent alerts
SELECT * FROM public.list_lth_alert_events() 
WHERE created_at >= NOW() - INTERVAL '24 hours' 
ORDER BY created_at DESC LIMIT 10;
```

**Manually Trigger Pipeline Steps:**
```bash
# Fetch CI bands
curl -X POST "https://[project].supabase.co/functions/v1/ef_fetch_ci_bands" \
  -H "Authorization: Bearer [SERVICE_ROLE_KEY]"

# Generate decisions
curl -X POST "https://[project].supabase.co/functions/v1/ef_generate_decisions" \
  -H "Authorization: Bearer [SERVICE_ROLE_KEY]"

# Execute orders
curl -X POST "https://[project].supabase.co/functions/v1/ef_execute_orders" \
  -H "Authorization: Bearer [SERVICE_ROLE_KEY]"

# Post ledger
curl -X POST "https://[project].supabase.co/functions/v1/ef_post_ledger_and_balances" \
  -H "Authorization: Bearer [SERVICE_ROLE_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"from_date":"2026-01-06","to_date":"2026-01-06"}'
```

**Customer Management:**
```sql
-- Activate customer
UPDATE customer_details SET registration_status = 'active' WHERE customer_id = [ID];

-- Deactivate customer
UPDATE customer_details SET registration_status = 'inactive' WHERE customer_id = [ID];

-- Check customer status
SELECT registration_status FROM customer_details WHERE customer_id = [ID];
```

### Keyboard Shortcuts (Admin Portal)

- `Ctrl+F` - Search customers
- `Esc` - Close modal/dialog
- `Tab` - Navigate form fields
- `Enter` - Submit form/confirm action

---

## Support Escalation

### When to Escalate to Engineering

**Immediate Escalation (< 30 min):**
- Database connection failures
- Complete system outage
- Security breach detected
- Data corruption affecting multiple customers

**Same-Day Escalation (< 4 hours):**
- Trading pipeline completely failing (no workaround)
- VALR API integration broken
- ChartInspect API failing (after retries)
- Multiple customers reporting same issue

**Next-Day Escalation:**
- Feature requests
- UI improvements
- Non-critical bugs
- Performance optimization suggestions

### Contact Information

**Engineering Team:**
- Email: davin@bitwealth.com.au
- Slack: #bitwealth-lth-pvr-alerts (if available)
- Phone: [Emergency contact for critical issues only]

**Third-Party Support:**
- VALR Support: support@valr.com
- Supabase Support: https://supabase.com/support
- ChartInspect Support: support@chartinspect.com (or appropriate contact)

---

## Appendices

### Appendix A: Database Schema Quick Reference

**Key Tables:**
- `customer_details` - Customer registration and status
- `customer_portfolios` - Portfolio assignments
- `exchange_accounts` - VALR subaccounts and deposit references (includes btc_wallet_address, usdt_wallet_address)
- `lth_pvr.ci_bands_daily` - Daily LTH PVR signal data
- `lth_pvr.decisions_daily` - Daily buy/sell/hold decisions
- `lth_pvr.order_intents` - Sized orders ready for execution
- `lth_pvr.exchange_orders` - Orders placed on VALR
- `lth_pvr.order_fills` - Executed trade fills
- `lth_pvr.ledger_lines` - Transaction ledger (GAAP accounting)
- `lth_pvr.balances_daily` - Daily NAV and balances
- `lth_pvr.exchange_funding_events` - All deposits and withdrawals (ZAR, BTC, USDT)
- `lth_pvr.pending_zar_conversions` - Active ZAR deposits awaiting conversion to USDT
- `lth_pvr.alert_events` - System alerts and errors

### Appendix B: Edge Function Deployment

**Redeploy All Functions:**
```bash
cd bitwealth-lth-pvr
./redeploy-all-functions.ps1
```

**Redeploy Single Function:**
```bash
supabase functions deploy ef_execute_orders --project-ref wqnmxpooabmedvtackji
```

**Check Function Logs:**
```bash
supabase functions logs ef_execute_orders --project-ref wqnmxpooabmedvtackji
```

### Appendix C: Email Template Management

**View Templates:**
```sql
SELECT template_key, subject, active
FROM email_templates
WHERE active = true
ORDER BY template_key;
```

**Update Template:**
```sql
UPDATE email_templates
SET body_html = '[NEW HTML]',
    subject = '[NEW SUBJECT]'
WHERE template_key = 'deposit_instructions';
```

**Test Email Sending:**
```sql
SELECT net.http_post(
  'https://[project].supabase.co/functions/v1/ef_send_email',
  jsonb_build_object(
    'template_key', 'deposit_instructions',
    'to_email', 'davin@bitwealth.com.au',
    'substitutions', jsonb_build_object(
      'CUSTOMER_NAME', 'Test Customer',
      'DEPOSIT_REF', 'BWDEPTEST1'
    )
  ),
  headers => jsonb_build_object('Authorization', 'Bearer [SERVICE_ROLE_KEY]')
);
```

---

**Document Version:** 1.1  
**Last Reviewed:** February 17, 2026  
**Next Review:** March 17, 2026  
**Owner:** BitWealth Operations Team

---

*For technical documentation, see: docs/SDD_v0.6.md*  
*For deployment guide, see: DEPLOYMENT_COMPLETE.md*  
*For security audit, see: docs/SECURITY_AUDIT_RESULTS.md*
