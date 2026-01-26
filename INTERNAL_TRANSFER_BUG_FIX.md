# Internal Transfer Bug Fix - 2026-01-26

## Bug Description

**Severity:** CRITICAL  
**Discovered:** 2026-01-26  
**Affected Component:** `ef_sync_valr_transactions` (version 11)

### Problem

VALR INTERNAL_TRANSFER transactions (platform fee transfers from subaccount → main account) are being incorrectly classified as **customer withdrawals** and creating duplicate funding events.

### Evidence

**Customer 47 (DEV TEST) - 2026-01-25:**
- 53 INTERNAL_TRANSFER transactions visible in VALR UI (screenshot shows "BTC Transfer")
- All occurred within 24 seconds (13:19:13 - 13:19:37 UTC)
- Total amount: -8,808 sats
- **Incorrectly classified as customer withdrawals** by ef_sync_valr_transactions

**Database Impact:**
- 107 withdrawal ledger entries created on 2026-01-25 (ledger_lines table)
- 53+ VALR_TX_ funding events with kind='withdrawal'
- Double-counting: Fees already transferred via ef_post_ledger_and_balances, then recorded AGAIN as withdrawals

### Root Cause

**File:** `supabase/functions/ef_sync_valr_transactions/index.ts`  
**Lines:** 287-301

```typescript
if (txType === "INTERNAL_TRANSFER") {
  // Main ↔ subaccount transfer
  if (creditValue > 0 && (creditCurrency === "BTC" || creditCurrency === "USDT")) {
    // Incoming transfer = deposit
    currency = creditCurrency;
    amount = creditValue;
    isDeposit = true;
  } else if (debitValue > 0 && (debitCurrency === "BTC" || debitCurrency === "USDT")) {
    // Outgoing transfer = withdrawal  ❌ INCORRECT
    currency = debitCurrency;
    amount = debitValue;
    isDeposit = false;
  } else {
    console.warn(`  Skipping INTERNAL_TRANSFER with no BTC/USDT:`, tx);
    continue;
  }
}
```

**Issue:** INTERNAL_TRANSFER represents:
1. **Platform fee transfers** (subaccount → main account) - System operation, NOT customer withdrawal
2. **User manual transfers** (main → subaccount OR subaccount → main) - Could be customer action

Current logic treats ALL INTERNAL_TRANSFER (debitValue > 0) as customer withdrawals, causing double-counting.

### Impact Assessment

**Financial Impact:**
- ❌ Customer balances INCORRECT (withdrawals double-counted)
- ❌ Platform fee accounting INCORRECT (fees recorded twice)
- ❌ NAV calculations WRONG
- ❌ Withdrawable balance WRONG

**Affected Customers:**
- All customers with platform fee transfers (likely ALL active customers)
- Severity increases with trading activity (more trades = more fee transfers = more duplicate withdrawals)

### Solution Options

#### Option 1: Skip ALL INTERNAL_TRANSFER transactions (RECOMMENDED)
```typescript
if (txType === "INTERNAL_TRANSFER") {
  // Skip internal transfers - these are system operations (fee transfers)
  // NOT customer deposits/withdrawals
  console.log(`  Skipping INTERNAL_TRANSFER (system operation): ${transactionId}`);
  continue;
}
```

**Pros:**
- Simple, safe fix
- Prevents double-counting
- Platform fee transfers already tracked via ef_post_ledger_and_balances

**Cons:**
- User manual transfers (main → subaccount) won't be detected
- But users shouldn't be manually transferring between accounts anyway

#### Option 2: Detect fee transfers vs user transfers (COMPLEX)
```typescript
if (txType === "INTERNAL_TRANSFER") {
  // Check if this is a platform fee transfer
  // Fee transfers have specific patterns (small amounts, frequent, subaccount → main)
  // Skip if detected as fee transfer, otherwise process as deposit/withdrawal
}
```

**Pros:**
- Theoretically more accurate

**Cons:**
- Complex heuristics required
- Risk of misclassification
- Fee transfers already properly tracked
- Not worth the complexity

### Recommended Fix

**Option 1** - Skip ALL INTERNAL_TRANSFER transactions

**Rationale:**
1. Platform fee transfers are already correctly handled by `ef_post_ledger_and_balances`
2. User manual transfers are not part of normal workflow
3. Simple, safe, prevents double-counting
4. Aligns with system design (VALR transaction sync for EXTERNAL events only)

### Data Cleanup Required

After fix deployment:
1. Delete all VALR_TX_ funding events with kind='withdrawal' where transaction type was INTERNAL_TRANSFER
2. Re-run ef_post_ledger_and_balances to recalculate balances
3. Verify all customer balances match VALR

### Testing Plan

1. Query VALR transaction history for test account with fee transfers
2. Verify INTERNAL_TRANSFER transactions are skipped (no funding events created)
3. Verify balances remain accurate
4. Compare ledger_lines before/after fix (should have fewer withdrawal entries)

### Deployment Steps

1. Update ef_sync_valr_transactions to skip INTERNAL_TRANSFER
2. Deploy new version
3. Run data cleanup script to remove duplicate withdrawals
4. Monitor alert_events for any new errors
5. Verify customer balances across multiple accounts

---

**Status:** PENDING FIX  
**Assigned To:** AI Agent + User Review  
**Target Completion:** 2026-01-26
