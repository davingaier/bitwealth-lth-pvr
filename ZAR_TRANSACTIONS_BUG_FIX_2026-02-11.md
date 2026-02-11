# ZAR Transactions Bug Fix - 2026-02-11

## Version: v0.6.46

## Problem Discovery

**User Report (2026-02-11):**
- Deposited $999 USDT to personal subaccount (customer 999) on 2026-02-10
- Converted all USDT to 16,016.68 ZAR via multiple trades
- Withdrew 15,986.71 ZAR to bank account
- **Issue:** Only the USDT deposit was recorded in the database
- **Missing:** 5 USDT→ZAR trades and 1 ZAR bank withdrawal

## Root Cause Analysis

### 1. Database Schema Constraints ❌

The `exchange_funding_events` table had restrictive CHECK constraints:

```sql
-- Old constraints (TOO RESTRICTIVE)
CHECK (asset IN ('USDT', 'BTC'))           -- ❌ No ZAR support
CHECK (kind IN ('deposit', 'withdrawal'))  -- ❌ No ZAR-specific kinds
```

The code was trying to insert:
- `asset = 'ZAR'` → **Rejected by constraint**
- `kind = 'zar_balance'` → **Rejected by constraint**
- `kind = 'zar_withdrawal'` → **Rejected by constraint**

### 2. Transaction Type Mismatch ❌

VALR API returns `FIAT_WITHDRAWAL` for ZAR bank withdrawals, but the code only filtered for `SIMPLE_SELL`:

```typescript
// Old filter (INCOMPLETE)
return [
  "INTERNAL_TRANSFER",
  "LIMIT_BUY", "MARKET_BUY",
  "LIMIT_SELL", "MARKET_SELL",
  "SIMPLE_SELL",           // ❌ Wrong - VALR uses FIAT_WITHDRAWAL
  "BLOCKCHAIN_RECEIVE",
  "BLOCKCHAIN_SEND"
].includes(txType);
```

### 3. Error Manifestation

**Symptoms observed:**
- `ef_sync_valr_transactions` reported: `new_transactions: 0, errors: 5`
- Alert events were created (handler logic executed)
- But INSERT operations failed silently due to constraint violations
- 5 errors = 5 LIMIT_SELL trades that failed to insert
- FIAT_WITHDRAWAL was filtered out entirely (not counted as error)

## VALR Transaction Types (Actual API Response)

Investigation via direct VALR API query revealed:

```json
{
  "LIMIT_SELL - Limit Sell": 5,        // USDT→ZAR conversions
  "FIAT_WITHDRAWAL - Withdraw": 1,     // ZAR bank withdrawal
  "BLOCKCHAIN_RECEIVE - Receive": 1,   // USDT deposit
  "INTERNAL_TRANSFER - Transfer": 2,
  "LIMIT_BUY - Limit Buy": 6,
  "FIAT_DEPOSIT - Deposit": 3
}
```

**Key finding:** VALR uses `FIAT_WITHDRAWAL`, NOT `SIMPLE_SELL` for bank withdrawals.

## Solution Implemented

### Migration: add_zar_support_to_funding_events

**File:** `supabase/migrations/[timestamp]_add_zar_support_to_funding_events.sql`

```sql
-- Drop old restrictive constraints
ALTER TABLE lth_pvr.exchange_funding_events 
  DROP CONSTRAINT IF EXISTS exchange_funding_events_asset_check;

ALTER TABLE lth_pvr.exchange_funding_events 
  DROP CONSTRAINT IF EXISTS exchange_funding_events_kind_check;

-- Add updated constraints with ZAR support
ALTER TABLE lth_pvr.exchange_funding_events 
  ADD CONSTRAINT exchange_funding_events_asset_check 
  CHECK (asset IN ('USDT', 'BTC', 'ZAR'));

ALTER TABLE lth_pvr.exchange_funding_events 
  ADD CONSTRAINT exchange_funding_events_kind_check 
  CHECK (kind IN ('deposit', 'withdrawal', 'zar_deposit', 'zar_balance', 'zar_withdrawal'));
```

**New `kind` values:**
- `zar_deposit`: South African Rand deposit before conversion to crypto
- `zar_balance`: ZAR received from selling crypto (ready for bank withdrawal)
- `zar_withdrawal`: ZAR withdrawn to customer bank account

### Code Changes: ef_sync_valr_transactions/index.ts

**Change 1: Add FIAT_WITHDRAWAL to filter**

```typescript
// Before
return [
  "INTERNAL_TRANSFER",
  "LIMIT_BUY", "MARKET_BUY",
  "LIMIT_SELL", "MARKET_SELL",
  "SIMPLE_SELL",           // ❌ Not used by VALR
  "BLOCKCHAIN_RECEIVE",
  "BLOCKCHAIN_SEND"
].includes(txType);

// After
return [
  "INTERNAL_TRANSFER",
  "SIMPLE_BUY",            // ZAR deposit
  "LIMIT_BUY", "MARKET_BUY",
  "LIMIT_SELL", "MARKET_SELL",
  "SIMPLE_SELL",           // Legacy (kept for safety)
  "FIAT_WITHDRAWAL",       // ✅ Current API response
  "FIAT_DEPOSIT",          // ZAR deposit
  "BLOCKCHAIN_RECEIVE",
  "BLOCKCHAIN_SEND"
].includes(txType);
```

**Change 2: Update FIAT_WITHDRAWAL handler**

```typescript
// Before
else if (txType === "SIMPLE_SELL" && debitCurrency === "ZAR") {
  // Handler code
}

// After
else if ((txType === "FIAT_WITHDRAWAL" || txType === "SIMPLE_SELL") && debitCurrency === "ZAR") {
  currency = "ZAR";
  amount = debitValue;
  isDeposit = false;
  fundingKind = "zar_withdrawal";
  
  // Enhanced metadata
  await logAlert(supabase, "ef_sync_valr_transactions", "info",
    `ZAR withdrawal: R${amount.toFixed(2)} sent to ${customerName}'s bank account`,
    {
      customer_id: customerId,
      zar_amount: amount,
      transaction_id: transactionId,
      bank_name: tx.additionalInfo?.bankName,       // ✅ Added
      withdrawal_id: tx.additionalInfo?.withdrawalId // ✅ Added
    }
  );
}
```

## Test Results

**Before Fix:**
```json
{
  "customer_id": 999,
  "transactions_found": 20,
  "funding_transactions": 5,
  "new_transactions": 0,
  "errors": 5
}
```

**After Fix:**
```json
{
  "customer_id": 999,
  "transactions_found": 20,
  "funding_transactions": 6,
  "new_transactions": 6,
  "errors": 0
}
```

### Database Verification

**Query:**
```sql
SELECT occurred_at, kind, asset, amount, ext_ref
FROM lth_pvr.exchange_funding_events 
WHERE customer_id = 999 AND occurred_at >= '2026-02-10'
ORDER BY occurred_at ASC;
```

**Results:**

| Time     | Kind            | Asset | Amount       | Transaction ID                        |
|----------|-----------------|-------|--------------|---------------------------------------|
| 11:04:31 | deposit         | USDT  | 999.00       | 019c4739-6db8-71db-985f-fdadd69571db |
| 11:09:19 | zar_balance     | ZAR   | 479.64       | 019c473d-d268-7b71-b69d-f12aa46d7b71 |
| 11:10:49 | zar_balance     | ZAR   | 209.63       | 019c473f-3057-7fbf-be24-7c572f95bfbf |
| 11:11:25 | zar_balance     | ZAR   | 4,991.00     | 019c473f-bb4f-7c02-beaf-52f5f8768c02 |
| 11:12:02 | zar_balance     | ZAR   | 5,490.10     | 019c4740-4de9-7f2c-9ea3-bc11c6343f2c |
| 11:12:41 | zar_balance     | ZAR   | 4,846.34     | 019c4740-e778-7f3c-9279-119e7c724f3c |
| 11:14:17 | zar_withdrawal  | ZAR   | -15,986.71   | 019c4742-5dde-70ec-a38d-66fc416050ec |

**Transaction Flow:** ✅
1. Deposit: +999 USDT
2. Convert: 999 USDT → +16,016.71 ZAR (5 trades)
3. Withdraw: -15,986.71 ZAR to bank
4. Net: ~30 ZAR remaining in account

**Metadata stored:**
```json
{
  "usdt_amount": 302.2767,
  "crypto_asset": "USDT",
  "conversion_rate": 16.03278894,
  "conversion_fee_value": 8.739139810302,
  "conversion_fee_asset": "ZAR"
}
```

## Deployment Checklist

- [✅] Migration applied to database
- [✅] Edge function updated with FIAT_WITHDRAWAL support
- [✅] Edge function deployed to production
- [✅] Sync tested manually - 6/6 transactions recorded
- [✅] Alert events created for all ZAR transactions
- [✅] Database constraints verified
- [✅] Debug functions cleaned up
- [✅] Documentation updated

## Key Learnings

1. **Always verify VALR API responses:** Don't assume transaction type names match documentation or intuition. Use direct API queries to verify actual response format.

2. **Database constraints must match code expectations:** Schema changes and code changes should be deployed together. Check constraints can silently reject INSERTs without clear error messages.

3. **Watch for silent failures:** Alert events were created but INSERTs failed - this indicated handler logic was correct but constraints were blocking. Always check both success AND error counts.

4. **VALR naming conventions:**
   - `FIAT_WITHDRAWAL` = ZAR bank withdrawal (NOT `SIMPLE_SELL`)
   - `FIAT_DEPOSIT` = ZAR bank deposit
   - `LIMIT_SELL` = Crypto → ZAR on-platform conversion
   - `LIMIT_BUY` = ZAR → Crypto on-platform conversion

5. **Multi-asset support requires:**
   - Flexible `asset` constraints (USDT, BTC, ZAR, etc.)
   - Asset-specific `kind` values (zar_deposit, zar_balance, zar_withdrawal)
   - Handler logic for each asset's transaction types
   - Metadata to track conversion details

## Impact Assessment

**Affected customers:** Any customers using ZAR deposits/withdrawals (primarily South African customers)

**Historical data:** Previous ZAR transactions (before 2026-02-11) were NOT recorded. To backfill:
1. Identify customers with ZAR activity
2. Set `sinceDatetime` to their account creation date
3. Run manual sync for each affected customer
4. Verify ledger_lines and balances_daily are updated

**Production status:** ✅ DEPLOYED AND VERIFIED

**Next steps:**
- Monitor ZAR transaction detection for next 24 hours
- Check if `ef_post_ledger_and_balances` handles ZAR transactions correctly
- Update customer balance reports to show ZAR balances separately
- Consider adding ZAR balance display in customer portal

## Related Files

- Migration: `supabase/migrations/[timestamp]_add_zar_support_to_funding_events.sql`
- Edge Function: `supabase/functions/ef_sync_valr_transactions/index.ts`
- Documentation: `ZAR_TRANSACTIONS_BUG_FIX_2026-02-11.md` (this file)
- Test Data: Customer 999 (Davin Personal Test)

## Version History

- **v0.6.45** (implicit): ZAR transaction support added to ef_sync_valr_transactions, but schema constraints not updated → Silent failures
- **v0.6.46** (2026-02-11): Database constraints updated + FIAT_WITHDRAWAL handler added → All ZAR transactions now recorded

---

**Author:** GitHub Copilot  
**Date:** 2026-02-11  
**Severity:** HIGH (data loss - customer transactions not recorded)  
**Status:** ✅ RESOLVED
