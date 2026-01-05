# Deposit Not Showing in Transaction History - Root Cause & Fix

**Date:** January 5, 2026  
**Issue:** Customer 31's 2 USDT deposit visible in `exchange_funding_events` but not in transaction history  
**Status:** ✅ FIXED  

---

## Problem Summary

Customer 31 registered on January 5, 2026 and made a 2 USDT deposit backdated to January 1, 2026. The deposit was correctly recorded in `lth_pvr.exchange_funding_events` but did not appear in the customer portal's transaction history.

### Investigation Results

**Data Found:**
```sql
-- exchange_funding_events (source of truth for deposits/withdrawals)
SELECT * FROM lth_pvr.exchange_funding_events WHERE customer_id = 31;
```
| funding_id | customer_id | kind | asset | amount | occurred_at |
|------------|-------------|------|-------|--------|-------------|
| 34f7e4ea... | 31 | deposit | USDT | 2.00 | 2026-01-01 12:00:00 |
| 8d7ac34f... | 31 | withdrawal | USDT | 2.00 | 2026-01-05 10:26:40 |

**Data Missing:**
```sql
-- ledger_lines (source for transaction history display)
SELECT * FROM lth_pvr.ledger_lines WHERE customer_id = 31;
```
**Before fix:** Only withdrawal row present (2026-01-05)  
**After fix:** Both deposit (2026-01-01) and withdrawal (2026-01-05) present

---

## Root Cause

The `ef_post_ledger_and_balances` edge function is responsible for copying funding events from `exchange_funding_events` to `ledger_lines`. However, it only processes records within a specified date range.

**Key Code Section** (lines 176-188 of `ef_post_ledger_and_balances/index.ts`):
```typescript
const fromTs = new Date(`${fromDate}T00:00:00.000Z`).toISOString();
const toTsExclusive = new Date(
  new Date(`${toDate}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000,
).toISOString();

const { data: funding, error: fundErr } = await sb
  .from("exchange_funding_events")
  .select("funding_id, customer_id, kind, asset, amount, occurred_at")
  .eq("org_id", org_id)
  .gte("occurred_at", fromTs)    // ← Only processes events >= fromDate
  .lt("occurred_at", toTsExclusive); // ← Only processes events < toDate+1
```

**What Happened:**
1. Customer 31 registered on 2026-01-05
2. `ef_balance_reconciliation` created a backdated deposit (occurred_at = 2026-01-01) in `exchange_funding_events`
3. `ef_post_ledger_and_balances` was called for trade_date=2026-01-05 only (today)
4. Function skipped January 1st deposit because it was outside the date range
5. Only the withdrawal (2026-01-05) was posted to `ledger_lines`

---

## Solution

### Immediate Fix (Applied)

Manually called `ef_post_ledger_and_balances` with expanded date range to include the deposit date:

```bash
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_post_ledger_and_balances" \
  -H "Authorization: Bearer [SUPABASE_ANON_KEY]" \
  -H "Content-Type: application/json" \
  -d '{"from_date":"2026-01-01","to_date":"2026-01-05"}'
```

**Result:**
```json
{
  "status": "ok",
  "from_date": "2026-01-01",
  "to_date": "2026-01-05",
  "fills_inserted": 0,
  "funding_inserted": 1,  // ← Deposit posted to ledger
  "balances_upserted": 2
}
```

**Verification:**
```sql
SELECT * FROM lth_pvr.ledger_lines WHERE customer_id = 31 ORDER BY trade_date;
```
| ledger_id | trade_date | kind | amount_usdt | note |
|-----------|------------|------|-------------|------|
| 7abd90a2... | 2026-01-01 | topup | 2.00 | funding:34f7e4ea... |
| 666385b4... | 2026-01-05 | withdrawal | -2.00 | funding:8d7ac34f... |

---

## Systemic Fix Required

### Problem: Balance Reconciliation Creates Backdated Deposits

When `ef_balance_reconciliation` runs, it backdates funding events to avoid creating incorrect historical balances:

**Code Location:** `ef_balance_reconciliation/index.ts` (lines 250-270)
```typescript
const occurred_at = new Date(
  Date.UTC(
    new Date(lthBalances.max_trade_date).getUTCFullYear(),
    new Date(lthBalances.max_trade_date).getUTCMonth(),
    new Date(lthBalances.max_trade_date).getUTCDate(),
    12, 0, 0, 0
  )
).toISOString();

await sb.from("exchange_funding_events").insert({
  org_id,
  customer_id,
  exchange_account_id,
  kind: "deposit",
  asset: "USDT",
  amount: Math.abs(usdtDiff),
  occurred_at,  // ← Backdated to last balance date
  idempotency_key: `balance-recon-${customer_id}-${Date.now()}`,
});
```

**Why Backdate?**
- Customer's last balance was on 2026-01-01 (before registration)
- Creating deposit with today's date (2026-01-05) would show zero balances on 2026-01-01 through 2026-01-04
- Backdating ensures historical balance continuity

### Solution Options

**Option 1: Call ef_post_ledger_and_balances with Expanded Range (Implemented)**
- After `ef_balance_reconciliation` runs, call `ef_post_ledger_and_balances` with date range covering backdated deposits
- **Pros:** Simple, no code changes required
- **Cons:** Manual intervention, not automated

**Option 2: Modify ef_balance_reconciliation to Call Post Function**
- Add code to `ef_balance_reconciliation` to automatically post backdated deposits to ledger
- **Pros:** Fully automated, no manual steps
- **Cons:** Creates dependency between functions, adds complexity

**Option 3: Create Deposits with Current Date, Backfill Balances**
- Keep deposit at current date (2026-01-05)
- Backfill `balances_daily` for historical dates with same balance
- **Pros:** No backdating issues
- **Cons:** More complex balance logic, historical data feels artificial

**Recommended:** Option 2 - Automated posting from balance reconciliation

---

## UI Enhancement Applied

Updated `customer-portal.html` to display "topup" transactions as "Deposit" (user-friendly label):

**Change Location:** Lines 510-528
```javascript
// Map "topup" to "Deposit" for display
if (tx.kind === 'topup') {
    typeDisplay = 'Deposit';
}

if (tx.kind === 'buy' || tx.kind === 'deposit' || tx.kind === 'topup') {
    typeColor = '#10b981'; // green
}
```

**Display Mapping:**
| Database Value | Portal Display | Color |
|----------------|----------------|-------|
| topup | Deposit | Green |
| deposit | Deposit | Green |
| withdrawal | Withdrawal | Red |
| buy | Buy | Green |
| sell | Sell | Red |
| fee | Fee | Orange |

---

## Testing Results

### TC6.8: RPC Function - ✅ PASS
```sql
SELECT * FROM public.list_customer_transactions(31, 100);
```
**Result:** 2 rows returned (deposit + withdrawal), correct sort order, all columns present

### TC6.9: Portal Display - ⏳ TO TEST
**Next Step:** Refresh customer portal (Ctrl+F5) to verify:
- 2 transaction rows visible
- Deposit shows green badge "Deposit" with +2.00 USDT (green)
- Withdrawal shows red badge "Withdrawal" with -2.00 USDT (red)

---

## Related Files

- **Edge Function:** `supabase/functions/ef_post_ledger_and_balances/index.ts`
- **RPC Function:** `supabase/functions/public.list_customer_transactions.fn.sql`
- **UI Component:** `website/customer-portal.html` (lines 310, 490-560)
- **Test Cases:** `docs/Customer_Onboarding_Test_Cases.md` (TC6.8, TC6.9)
- **Balance Reconciliation:** `supabase/functions/ef_balance_reconciliation/index.ts`

---

## Prevention Checklist

When testing future customers with backdated deposits:

1. ✅ Check `exchange_funding_events` for deposit record
2. ✅ Check `ledger_lines` for corresponding ledger entry
3. ✅ If missing, call `ef_post_ledger_and_balances` with expanded date range
4. ✅ Verify transaction appears in customer portal after refresh
5. ✅ Check balances_daily for all dates between deposit and today

---

## Long-Term Fix (Post-MVP)

**Task:** Automate ledger posting for backdated deposits
- **Priority:** P2 (Nice-to-have, workaround exists)
- **Estimate:** 2 hours
- **Impact:** Eliminates manual intervention for customer onboarding
- **Implementation:**
  1. Modify `ef_balance_reconciliation` to capture earliest `occurred_at` from inserted deposits
  2. Automatically call `ef_post_ledger_and_balances` with expanded date range
  3. Log action to `alert_events` for audit trail

---

**Fixed By:** GitHub Copilot  
**Verified By:** SQL query testing (TC6.8 PASS)  
**Pending:** Browser UI testing (TC6.9)  
