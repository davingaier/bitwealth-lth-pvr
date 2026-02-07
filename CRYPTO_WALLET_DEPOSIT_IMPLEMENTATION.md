# Crypto Wallet Deposit Support - Implementation Complete

**Date:** February 7, 2026  
**Feature:** BTC and USDT Direct Deposit Support  
**Status:** ✅ DEPLOYED (Ready for Testing)

---

## Overview

Added support for customers to deposit Bitcoin (BTC) and Tether USDT (via TRON network) directly to their VALR subaccounts, alongside existing ZAR bank transfer deposits.

### Key Design Decision

**VALR API does NOT support automated wallet creation.** Wallet addresses must be created manually by admin in VALR portal. The implementation follows a hybrid approach:
- ✅ **Automated:** VALR subaccount creation via API
- ⚠️ **Manual:** BTC and USDT wallet creation in VALR portal
- ✅ **Automated:** Email dispatch with all 3 deposit options

---

## Changes Summary

### 1. Database Schema Changes

**File:** `supabase/migrations/20260207_add_crypto_wallet_columns.sql`

Added 5 new columns to `public.exchange_accounts`:

| Column Name | Type | Default | Purpose |
|-------------|------|---------|---------|
| `btc_wallet_address` | TEXT | NULL | Bitcoin deposit address from VALR |
| `btc_wallet_created_at` | TIMESTAMPTZ | NULL | Audit timestamp for BTC wallet |
| `usdt_wallet_address` | TEXT | NULL | USDT deposit address from VALR |
| `usdt_deposit_network` | TEXT | 'TRON' | Network for USDT deposits (TRC20) |
| `usdt_wallet_created_at` | TIMESTAMPTZ | NULL | Audit timestamp for USDT wallet |

**Deployment:** 
```powershell
supabase db push --project-ref wqnmxpooabmedvtackji --include-all
```

---

### 2. Email Template Update

**File:** `supabase/migrations/20260207_update_deposit_email_template.sql`

Updated `deposit_instructions` email template to include:

**Section 1: ZAR Bank Transfer** (Existing)
- Standard Bank details
- Unique deposit_ref
- Critical reference warning

**Section 2: Crypto Deposit Options** (NEW)
- **BTC Wallet:**
  - Monospace address display
  - Yellow warning box: "BTC only" message
  - Permanent loss warning
  
- **USDT Wallet (TRON):**
  - Monospace address display
  - Green emphasis box: "Network: TRON (TRC20)"
  - Critical warning: Select TRON not Ethereum
  - Fee comparison (TRON < $1 vs Ethereum ~$20+)

**Section 3: Deposit Method Guide** (NEW)
- Which method to choose explanation
- Processing time comparison
- Fee comparison
- Recommended method highlighted (USDT-TRON)

**Template Variables:**
- `{{deposit_ref}}` - ZAR bank reference
- `{{btc_wallet_address}}` - Bitcoin address
- `{{usdt_wallet_address}}` - USDT-TRC20 address
- `{{first_name}}` - Customer first name
- `{{website_url}}` - Portal URL

---

### 3. Admin UI Enhancements

**File:** `ui/Advanced BTC DCA Strategy.html`

#### 3.1 Data Model Updates
- Extended customer data fetch to include wallet columns
- Added flags: `hasBtcWallet`, `hasUsdtWallet`, `hasAllReferences`
- Updated validation logic for complete M4 workflow

#### 3.2 VALR Setup (M4) Table Updates
- **Column:** "Deposit Ref" now shows:
  - Deposit reference (first line)
  - Wallet status indicators (second line): `✓ BTC | ✓ USDT` or `⚠ BTC | ⚠ USDT`
  
- **Action Button Logic:**
  1. No subaccount: "⏳ Auto-creating..." + "🔄 Retry Manually"
  2. Subaccount exists, missing references: "💳 Enter All References"
  3. All references saved: "📧 Resend Email"

#### 3.3 New Modal: Wallet Address Entry

**Function:** `window.showWalletAddressModal()`

**Features:**
- Instructions for VALR portal wallet creation
- 3 input fields:
  - ZAR Deposit Reference (text, 20 chars max)
  - BTC Wallet Address (monospace, pattern validation)
  - USDT Wallet Address (monospace, pattern validation)
- Inline field help text
- Network selection emphasis (TRON for USDT)
- Critical warning banner before save
- "Cancel" and "💾 Save All & Send Email" buttons

**Validation:**
- All 3 fields required
- BTC address regex: `^(bc1|1|3)[a-zA-HJ-NP-Z0-9]{25,62}$`
- USDT address regex: `^T[a-zA-Z0-9]{33}$`
- User-friendly error messages

#### 3.4 Updated Save Function

**Function:** `window.saveWalletAddresses()`

**Process:**
1. Validate all 3 addresses
2. Display confirmation with truncated addresses
3. Update `exchange_accounts` with:
   - deposit_ref
   - btc_wallet_address + btc_wallet_created_at (auto timestamp)
   - usdt_wallet_address + usdt_wallet_created_at (auto timestamp)
   - usdt_deposit_network = 'TRON'
4. Update customer status to 'deposit'
5. Call `ef_send_email` with:
   - template_key: 'deposit_instructions'
   - data: { first_name, deposit_ref, btc_wallet_address, usdt_wallet_address, website_url }
6. Close modal
7. Refresh customer table

#### 3.5 Updated Resend Email Function

**Function:** `window.resendDepositEmail()`

Now includes wallet addresses in email data:
- btc_wallet_address: customer.btc_wallet_address || 'Not yet configured'
- usdt_wallet_address: customer.usdt_wallet_address || 'Not yet configured'

Handles partial setup gracefully (email template shows "Not yet configured" if missing).

---

### 4. Documentation Updates

**File:** `docs/ADMIN_OPERATIONS_GUIDE.md`

**Section:** Milestone 4: VALR Subaccount & Wallet Setup

**Changes:**
- Updated title to reflect manual wallet setup
- Added detailed step-by-step VALR portal workflow:
  1. Log into VALR
  2. Navigate to subaccounts
  3. Create BTC wallet (copy address)
  4. Create USDT wallet on TRON network (copy address)
  5. Enter all 3 references in Admin UI
  6. Send email
  
- Added wallet address validation guidelines
- Updated monitoring SQL to include wallet columns
- Added troubleshooting for wallet-specific issues
- Updated SLA: 2 hours including manual wallet creation

---

## New Admin Workflow (Milestone 4)

### Previous Workflow
1. Admin approves KYC → System creates VALR subaccount
2. ~~Admin enters deposit_ref~~ (OLD)
3. ~~Admin sends email~~ (OLD)

### New Workflow
1. Admin approves KYC → System creates VALR subaccount (unchanged)
2. **Admin creates BTC wallet in VALR portal** (NEW)
3. **Admin creates USDT wallet in VALR portal** (NEW)
4. **Admin enters ALL THREE references in modal** (NEW):
   - ZAR deposit_ref
   - BTC wallet address
   - USDT wallet address (TRON)
5. Admin clicks "Save All & Send Email"
6. System sends email with all 3 deposit options

### Admin UI Flow

```
M4 Table Row for Customer:
┌─────────────────────────────────────────────────────────┐
│ Customer ID: 123                                        │
│ Name: John Smith                                        │
│ Email: john@example.com                                 │
│ Subaccount: 1419286489401798656                         │
│ Deposit Ref: Pending                                    │
│             ⚠ BTC | ⚠ USDT  (not configured yet)       │
│ Action: [💳 Enter All References]                       │
└─────────────────────────────────────────────────────────┘

Click "Enter All References" →

┌─────────────────────────────────────────────────────────┐
│            💳 Enter Deposit References                  │
│            for John Smith                               │
├─────────────────────────────────────────────────────────┤
│ ℹ️ Step 1: Create Wallets in VALR Portal               │
│   1. Log into VALR: valr.com                            │
│   2. Navigate to: Subaccounts → [John Smith]           │
│   3. Create BTC wallet → Copy address                   │
│   4. Create USDT wallet (TRON) → Copy address           │
├─────────────────────────────────────────────────────────┤
│ ZAR Deposit Reference:                                  │
│ [BWDEP7K2M9_____________________]                       │
│                                                         │
│ BTC Wallet Address:                                     │
│ [bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh_________] │
│                                                         │
│ USDT Wallet Address (TRON Network):                    │
│ [TYaSrzezRzezRzezRzezRzezRzezRzez12_________________] │
│                                                         │
│ ⚠️ Important: Verify addresses are correct              │
├─────────────────────────────────────────────────────────┤
│                [Cancel]  [💾 Save All & Send Email]     │
└─────────────────────────────────────────────────────────┘

After Save:

┌─────────────────────────────────────────────────────────┐
│ Customer ID: 123                                        │
│ Name: John Smith                                        │
│ Email: john@example.com                                 │
│ Subaccount: 1419286489401798656                         │
│ Deposit Ref: BWDEP7K2M9                                 │
│             ✓ BTC | ✓ USDT  (all configured)           │
│ Action: [📧 Resend Email]                               │
└─────────────────────────────────────────────────────────┘
```

---

## Deposit Detection (Future Enhancement)

**Current Status:** Deposit scan (`ef_deposit_scan`) detects balance changes.

**Investigation Required:**
- Determine if VALR transaction history API differentiates:
  - `CRYPTO_DEPOSIT` (direct BTC/USDT deposit)
  - `SIMPLE_BUY` (ZAR conversion to USDT)
  - `FIAT_DEPOSIT` (ZAR bank transfer)

**Proposed Enhancement:**
```typescript
// In ef_deposit_scan
const txHistory = await fetch(`https://api.valr.com/v1/account/BTCUSDT/transactionhistory`);
const deposits = txHistory.filter(tx => tx.transactionType === 'DEPOSIT');

// Create exchange_funding_events with correct metadata:
{
  kind: 'deposit',
  asset: 'BTC' | 'USDT',
  amount: tx.quantity,
  deposit_method: tx.depositType, // 'CRYPTO_DEPOSIT' vs 'FIAT_DEPOSIT'
  occurred_at: tx.timestamp
}
```

**No changes needed immediately** - balance polling works for all deposit types.

---

## Testing Plan

### Test Case TC-CW-01: Wallet Address Entry
**Steps:**
1. Create test customer through M1-M3 (KYC approved)
2. Verify subaccount auto-created
3. Admin manually creates BTC wallet in VALR portal
4. Admin manually creates USDT wallet (TRON) in VALR portal
5. Admin clicks "Enter All References" in Admin UI
6. Enter all 3 values, click save

**Expected:**
- ✅ Modal validates address formats
- ✅ Timestamps auto-populated in database
- ✅ Customer status → 'deposit'
- ✅ Email queued/sent

**SQL Verification:**
```sql
SELECT 
  deposit_ref,
  btc_wallet_address,
  btc_wallet_created_at,
  usdt_wallet_address,
  usdt_deposit_network,
  usdt_wallet_created_at
FROM public.exchange_accounts
WHERE exchange_account_id = [TEST_ID];
```

---

### Test Case TC-CW-02: Email Template Display
**Steps:**
1. Complete TC-CW-01
2. Check customer's email inbox
3. Review email structure

**Expected:**
- ✅ Subject: "Fund Your BitWealth Account - Deposit Instructions"
- ✅ Section 1: ZAR bank transfer with deposit_ref
- ✅ Section 2: BTC wallet address in monospace, yellow warning
- ✅ Section 3: USDT wallet address in monospace, green TRON emphasis
- ✅ Section 4: Deposit method comparison guide
- ✅ All placeholders replaced correctly

---

### Test Case TC-CW-03: BTC Direct Deposit
**Steps:**
1. Complete TC-CW-01
2. Send small BTC amount to wallet address (e.g., 0.0001 BTC)
3. Wait for blockchain confirmations
4. Wait for hourly `ef_deposit_scan` or trigger manually
5. Check `exchange_funding_events`

**Expected:**
- ✅ Deposit detected (balance increase on VALR)
- ✅ `exchange_funding_events` record: kind='deposit', asset='BTC'
- ✅ `ef_balance_reconciliation` creates ledger entry
- ✅ If ≥ minimum, customer status → 'active'
- ✅ Customer receives "Deposit Received" email

---

### Test Case TC-CW-04: USDT Direct Deposit (TRON)
**Steps:**
1. Complete TC-CW-01
2. Send USDT via TRON network to wallet address (e.g., 100 USDT)
3. Wait for TRON confirmations (~1 minute)
4. Wait for hourly `ef_deposit_scan`
5. Check `exchange_funding_events`

**Expected:**
- ✅ Deposit detected rapidly (TRON fast)
- ✅ `exchange_funding_events` record: kind='deposit', asset='USDT'
- ✅ Customer activated if ≥ 100 USDT
- ✅ Confirmation email sent

---

### Test Case TC-CW-05: Resend Email Function
**Steps:**
1. Complete TC-CW-01
2. Click "Resend Email" button in M4 table
3. Check customer inbox

**Expected:**
- ✅ Email sent successfully
- ✅ All wallet addresses included
- ✅ Success message displayed in Admin UI

---

### Test Case TC-CW-06: Partial Setup Handling
**Steps:**
1. Create customer, subaccount created
2. Admin enters only deposit_ref and BTC (not USDT)
3. Attempt to save

**Expected:**
- ❌ Validation error: "Please enter all three deposit references"
- ✅ Modal remains open
- ✅ No database update

---

### Test Case TC-CW-07: Invalid Address Format
**Steps:**
1. Enter invalid BTC address (e.g., "invalid123")
2. Attempt to save

**Expected:**
- ❌ Validation error: "Invalid BTC wallet address format"
- ✅ Specific regex guidance shown

---

## Deployment Checklist

### Pre-Deployment
- [x] Database migration created and tested
- [x] Email template migration created
- [x] Admin UI updates implemented
- [x] Documentation updated
- [x] Deployment script created
- [x] Test plan documented

### Deployment Steps
```powershell
# Run deployment script
.\deploy-crypto-wallet-support.ps1

# Script will:
# 1. Apply migration 20260207_add_crypto_wallet_columns.sql
# 2. Apply migration 20260207_update_deposit_email_template.sql
# 3. Verify schema changes
# 4. Display next steps
```

### Post-Deployment
- [ ] Verify columns exist: `SELECT * FROM information_schema.columns WHERE table_name='exchange_accounts' AND column_name LIKE '%wallet%';`
- [ ] Test email template preview in Supabase
- [ ] Run TC-CW-01 (Wallet Address Entry)
- [ ] Run TC-CW-02 (Email Template Display)
- [ ] Train admin team on new M4 workflow
- [ ] Update SLA monitoring (2 hours for M4 completion)
- [ ] Test deposit detection with small amounts

---

## Known Limitations

1. **VALR API Limitation:** Wallet addresses cannot be created programmatically
   - **Impact:** Admin must manually create wallets in VALR portal
   - **Mitigation:** Clear step-by-step instructions in Admin UI modal and docs

2. **Deposit Detection:** Current implementation detects balance changes, not transaction types
   - **Impact:** Cannot distinguish ZAR conversion from direct crypto deposit in logs
   - **Mitigation:** Future enhancement to query VALR transaction history API

3. **Network Selection:** USDT supports multiple networks (ERC20, TRC20, BEP20)
   - **Impact:** Customer may send USDT on wrong network → funds lost
   - **Mitigation:** Strong warnings in email, default network field = 'TRON', green emphasis

4. **Address Validation:** Regex validation only, not on-chain verification
   - **Impact:** Theoretically valid but non-existent addresses could be entered
   - **Mitigation:** Admin must copy-paste from VALR (not manually type)

---

## Future Enhancements

### Priority 1: Deposit Type Tracking
- Investigate VALR transaction history API fields
- Add `deposit_method` column to `exchange_funding_events`
- Differentiate: 'ZAR_BANK_TRANSFER', 'BTC_DIRECT', 'USDT_DIRECT'

### Priority 2: Multi-Network USDT Support
- Add UI selector for USDT network (TRON vs Ethereum)
- Store network selection in `usdt_deposit_network` column
- Update email template to dynamically show selected network

### Priority 3: Wallet Status Dashboard
- Add "Wallet Status" section to Admin UI
- Show: Wallet created date, last deposit timestamp, total deposits by method
- Alert if wallet addresses missing for active customers

### Priority 4: Customer Portal Enhancement
- Show deposit options in customer portal (currently email only)
- Add QR codes for BTC and USDT addresses
- Real-time deposit status tracking

---

## Rollback Plan

If issues discovered post-deployment:

1. **Database Rollback:**
   ```sql
   ALTER TABLE public.exchange_accounts 
   DROP COLUMN IF EXISTS btc_wallet_address,
   DROP COLUMN IF EXISTS btc_wallet_created_at,
   DROP COLUMN IF EXISTS usdt_wallet_address,
   DROP COLUMN IF EXISTS usdt_deposit_network,
   DROP COLUMN IF EXISTS usdt_wallet_created_at;
   ```

2. **Email Template Rollback:**
   ```sql
   -- Restore original template from backup
   UPDATE public.email_templates
   SET body_html = '[ORIGINAL_HTML_FROM_BACKUP]'
   WHERE template_key = 'deposit_instructions';
   ```

3. **Admin UI Rollback:**
   - Revert `ui/Advanced BTC DCA Strategy.html` via Git
   - Or comment out modal functions temporarily

**Note:** Rollback should NOT be needed - feature is additive and backward compatible.

---

## Support Contact

**Feature Owner:** Davin  
**Implementation Date:** February 7, 2026  
**Related Documentation:**
- `docs/ADMIN_OPERATIONS_GUIDE.md` (Milestone 4)
- `docs/SDD_v0.6.md` (Pending corrections update)
- This document: `CRYPTO_WALLET_DEPOSIT_IMPLEMENTATION.md`

**Deployment Script:** `deploy-crypto-wallet-support.ps1`

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-07 | Davin | Initial implementation - BTC/USDT wallet deposit support |

---

**Status:** ✅ IMPLEMENTATION COMPLETE - READY FOR DEPLOYMENT & TESTING
