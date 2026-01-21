# Fee System Phase 2 Complete - Platform Fee Implementation

**Date:** 2026-01-21  
**Version:** v0.6.25  
**Status:** ✅ DEPLOYED TO PRODUCTION

---

## Summary

Phase 2 implements platform fee calculation (0.75% on NET deposits) and automated transfer to BitWealth main account via VALR API. This phase handles both USDT and BTC deposits, with fee deduction and transfer occurring synchronously during ledger posting.

---

## Changes Deployed

### 1. Shared Modules Created

#### `_shared/valr.ts` (NEW)
- **Purpose:** Reusable HMAC signature generation for VALR API
- **Function:** `signVALR(timestamp, method, path, body, apiSecret, subaccountId)`
- **Used by:** valrTransfer.ts, ef_balance_reconciliation, ef_deposit_scan
- **Lines:** 45 lines
- **Status:** ✅ DEPLOYED

#### `_shared/valrTransfer.ts` (NEW)
- **Purpose:** VALR subaccount transfer API wrapper with audit logging
- **Functions:**
  - `transferToMainAccount(sb, request, customerId, ledgerId)` - Transfer fees from customer subaccount to BitWealth main account
  - `retryTransfer(sb, transferId)` - Retry failed transfers (manual admin action)
- **VALR API:** POST /v1/account/subaccount/transfer
- **Rate limit:** 20 requests/second (documented in code)
- **Audit logging:** All transfers logged to `lth_pvr.valr_transfer_log`
- **Error handling:** Network errors, API errors, validation errors
- **Lines:** 241 lines
- **Status:** ✅ DEPLOYED

### 2. Edge Functions Modified

#### `ef_post_ledger_and_balances` (MODIFIED)
- **File:** `supabase/functions/ef_post_ledger_and_balances/index.ts`
- **Changes:**
  1. **Import added:** `import { transferToMainAccount } from "../_shared/valrTransfer.ts"`
  2. **Platform fee calculation:**
     - **USDT deposits:** Platform fee = `NET_USDT × 0.0075` (after VALR 0.18% conversion fee already deducted)
     - **BTC deposits:** Platform fee = `BTC_AMOUNT × 0.0075`
     - **Withdrawals:** No platform fee (fee only on deposits)
  3. **Ledger entry updated:**
     - Added `platform_fee_btc` column to INSERT statement
     - Added `platform_fee_usdt` column to INSERT statement
  4. **VALR transfer integration:**
     - After ledger INSERT, queries `exchange_accounts` to get customer's `subaccount_id`
     - Calls `transferToMainAccount()` for BTC platform fees (if > 0)
     - Calls `transferToMainAccount()` for USDT platform fees (if > 0)
     - Logs alerts via `logAlert()` if transfers fail
  5. **Error handling:**
     - Transfer failures don't block ledger posting (fee recorded, transfer retryable)
     - Alert logged to `lth_pvr.alert_events` with transfer details
- **Lines changed:** ~50 lines added/modified
- **Deployed:** 2026-01-21 14:30 UTC
- **Status:** ✅ DEPLOYED

---

## Database Changes (Phase 1 - Already Deployed)

### Extended Tables

**`lth_pvr.ledger_lines`** - 4 new columns:
- `platform_fee_usdt` NUMERIC(20,8) - Platform fee in USDT (0.75% of NET deposit)
- `platform_fee_btc` NUMERIC(20,8) - Platform fee in BTC (0.75% of BTC deposit)
- `performance_fee_usdt` NUMERIC(20,8) - Performance fee in USDT (10% of HWM profits, Phase 3)
- `conversion_approval_id` UUID - FK to fee_conversion_approvals (Phase 4)

### New Tables

**`lth_pvr.valr_transfer_log`** - Audit log for all VALR subaccount transfers:
- `transfer_id` UUID PRIMARY KEY
- `org_id`, `customer_id` (multi-tenant support)
- `ledger_id` UUID - Optional FK to ledger_lines (links fee to ledger entry)
- `transfer_type` VARCHAR(50) - 'platform_fee', 'performance_fee', 'manual'
- `from_subaccount_id` VARCHAR(100) - Customer subaccount ID
- `to_account` VARCHAR(100) - BitWealth main account ID (usually "main")
- `currency` VARCHAR(10) - BTC, USDT, ZAR
- `amount` NUMERIC(20,8) - Transfer amount
- `status` VARCHAR(20) - 'pending', 'completed', 'failed'
- `valr_api_response` JSONB - Full VALR API response (error details if failed)
- `retry_count` INTEGER DEFAULT 0 - Number of retry attempts
- `created_at`, `updated_at` TIMESTAMPTZ
- **Unique index:** (ledger_id, transfer_type) - Prevents duplicate transfers for same fee
- **RLS enabled:** Service role bypass

---

## Platform Fee Calculation Logic

### USDT Deposits (ZAR → USDT Conversion)

**Scenario:** Customer deposits R1,000 ZAR at rate 18.50 ZAR/USDT

1. **Gross USDT:** R1,000 ÷ 18.50 = $54.05 USDT
2. **VALR conversion fee (0.18%):** $54.05 × 0.0018 = $0.097 USDT
3. **NET USDT:** $54.05 - $0.097 = **$53.95 USDT** ← Recorded in `exchange_funding_events.amount`
4. **Platform fee (0.75% on NET):** $53.95 × 0.0075 = **$0.405 USDT**
5. **Customer receives:** $53.95 - $0.405 = **$53.55 USDT**

**Ledger entry:**
```sql
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, trade_date, kind,
  amount_usdt,        -- $53.95 (NET after VALR fee, BEFORE platform fee)
  platform_fee_usdt,  -- $0.405 (BitWealth platform fee)
  note
) VALUES (...);
```

**VALR transfer:**
- `transferToMainAccount()` transfers **$0.405 USDT** from customer subaccount to BitWealth main account
- Transfer logged to `valr_transfer_log` with status tracking

### BTC Deposits

**Scenario:** Customer deposits 0.1 BTC

1. **BTC received:** 0.1 BTC (no VALR conversion fee on BTC deposits)
2. **Platform fee (0.75%):** 0.1 BTC × 0.0075 = **0.00075 BTC**
3. **Customer receives:** 0.1 BTC - 0.00075 BTC = **0.09925 BTC**

**Ledger entry:**
```sql
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, trade_date, kind,
  amount_btc,        -- 0.09925 (after platform fee deduction)
  platform_fee_btc,  -- 0.00075 (BitWealth platform fee)
  note
) VALUES (...);
```

**VALR transfer:**
- `transferToMainAccount()` transfers **0.00075 BTC** from customer subaccount to BitWealth main account
- Transfer logged to `valr_transfer_log` with status tracking

**Future Phase 4:** BTC fee will be auto-converted to USDT via MARKET order (not implemented in Phase 2)

---

## VALR API Integration Details

### Endpoint

**POST** `https://api.valr.com/v1/account/subaccount/transfer`

### Request

```json
{
  "fromId": "sub_abc123",  // Customer subaccount ID
  "toId": "main",          // BitWealth main account ID
  "currencyCode": "USDT",  // BTC, USDT, or ZAR
  "amount": "0.40500000"   // 8 decimal places
}
```

### Headers

```
X-VALR-API-KEY: <VALR_API_KEY from env>
X-VALR-SIGNATURE: <HMAC SHA-512 signature>
X-VALR-TIMESTAMP: <Unix timestamp in milliseconds>
Content-Type: application/json
```

### Response (Success)

```json
{
  "id": "abc-123-def",
  "status": "COMPLETE",
  "currencyCode": "USDT",
  "amount": "0.40500000"
}
```

### Response (Error)

```json
{
  "code": "INVALID_REQUEST",
  "message": "Insufficient balance"
}
```

### Rate Limit

- **20 requests/second** per API key
- BitWealth has single primary API key with subaccount transfer permission
- Rate limit shared across all edge functions using VALR API

---

## Error Handling & Alerting

### Transfer Failure Scenarios

1. **Network error** (VALR API unreachable)
   - Alert logged: `"USDT platform fee transfer failed: Network error"`
   - Transfer status: `failed`, retry_count: 1
   - Recovery: Admin manually calls `retryTransfer(transferId)` via Admin UI (future)

2. **Insufficient balance** (customer withdrew funds before fee transfer)
   - Alert logged: `"USDT platform fee transfer failed: Insufficient balance"`
   - Transfer status: `failed`, retry_count: 1
   - Recovery: Wait for next deposit, retry transfer

3. **Invalid subaccount ID** (customer deleted subaccount)
   - Alert logged: `"No exchange account found for customer 999"`
   - No transfer record created
   - Recovery: Re-create subaccount, re-run ef_post_ledger_and_balances

### Alert Configuration

**Component:** `ef_post_ledger_and_balances`  
**Severity:** `error` (not `critical` - ledger posted successfully, only transfer failed)  
**Alert digest:** Email sent daily at 05:00 UTC via `ef_alert_digest`  
**UI visibility:** Administration module → Alert badge (count of unnotified errors)

---

## Testing Strategy

### Unit Tests (Phase 5)

**Not yet implemented.** Planned tests:

- `valrTransfer.test.ts`:
  - Mock VALR API responses (success, failure)
  - Test retry logic (increment retry_count)
  - Test idempotency (prevent duplicate transfers)
  - Test error logging (JSONB structure)

### Integration Tests (Phase 5)

**Development subaccount required.** Test cases:

- **TC1.1:** ZAR deposit → Verify $0.405 USDT transferred to main account
- **TC1.2:** BTC deposit → Verify 0.00075 BTC transferred to main account
- **TC1.1b:** Insufficient balance → Verify transfer fails gracefully, alert logged

### Manual SQL Verification (Immediate)

```sql
-- Check platform fee calculations
SELECT 
  trade_date,
  kind,
  amount_usdt,
  platform_fee_usdt,
  amount_usdt - platform_fee_usdt AS customer_receives,
  note
FROM lth_pvr.ledger_lines
WHERE customer_id = 12 AND kind = 'topup' AND trade_date >= '2026-01-01'
ORDER BY trade_date DESC LIMIT 10;

-- Check VALR transfer log
SELECT 
  transfer_id,
  customer_id,
  transfer_type,
  currency,
  amount,
  status,
  valr_api_response->>'message' AS error_message,
  retry_count,
  created_at
FROM lth_pvr.valr_transfer_log
ORDER BY created_at DESC LIMIT 20;

-- Check alerts for transfer failures
SELECT * FROM public.list_lth_alert_events()
WHERE component = 'ef_post_ledger_and_balances'
AND severity = 'error'
ORDER BY created_at DESC LIMIT 10;
```

---

## Known Limitations & Future Enhancements

### Phase 2 Limitations

1. **BTC fee not converted to USDT** (Phase 4 feature)
   - BTC platform fees accumulate in BitWealth main account
   - Manual conversion required until Phase 4 auto-conversion implemented

2. **No retry mechanism** (future Admin UI feature)
   - Failed transfers logged but not automatically retried
   - Admin must manually call `retryTransfer()` function (SQL or future UI)

3. **No VALR rate limit handling** (future enhancement)
   - If >20 transfers/second, VALR returns 429 Too Many Requests
   - Edge function doesn't implement backoff/retry (alert logged, manual retry needed)

### Phase 3 Prerequisites

Phase 3 (Performance Fee HWM Logic) requires:
- ✅ `lth_pvr.customer_state_daily` table (HWM tracking) - Already created in Phase 1
- ✅ `lth_pvr.ledger_lines.performance_fee_usdt` column - Already created in Phase 1
- ✅ VALR transfer infrastructure - Already created in Phase 2
- ⏳ `ef_calculate_performance_fees` edge function - Not yet created
- ⏳ `ef_calculate_interim_performance_fee` edge function - Not yet created
- ⏳ `ef_revert_withdrawal_fees` edge function - Not yet created

---

## Deployment Commands Used

```powershell
# Deploy shared modules (auto-bundled with edge functions)
# No explicit deployment needed - included as dependencies

# Deploy modified edge function
supabase functions deploy ef_post_ledger_and_balances `
  --project-ref wqnmxpooabmedvtackji `
  --no-verify-jwt

# Verify deployment
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_post_ledger_and_balances `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{"from_date": "2026-01-21", "to_date": "2026-01-21"}'
```

---

## Environment Variables Required

**No new variables added.** Phase 2 uses existing environment variables:

- `SUPABASE_URL` / `SB_URL` - Project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for RLS bypass)
- `ORG_ID` - Organization UUID (b0a77009-03b9-44a1-ae1d-34f157d44a8b)
- `VALR_API_KEY` - Primary VALR API key with "Transfer" permission
- `VALR_API_SECRET` - VALR API secret for HMAC signature
- `VALR_MAIN_ACCOUNT_ID` - BitWealth main account ID (default: "main")

---

## Next Steps (Phase 3)

**Priority:** HIGH  
**Estimated Duration:** 4-5 hours  
**Blocking:** No (Phase 3 can proceed immediately)

### Phase 3 Tasks

1. **Create `ef_calculate_performance_fees`**
   - Schedule: pg_cron monthly (1st day 00:05 UTC)
   - Logic: IF (NAV > HWM + net_contrib) THEN fee = (NAV - HWM - net_contrib) × 10%
   - Update customer_state_daily: new HWM, last_perf_fee_month
   - Call transferToMainAccount() to transfer USDT fee
   - Handle insufficient USDT: Alert, skip transfer (Phase 4 auto-conversion will handle)

2. **Create `ef_calculate_interim_performance_fee`**
   - Trigger: Withdrawal requests (manual or via future withdrawal UI)
   - Use same HWM logic as monthly calculation
   - Create snapshot in withdrawal_fee_snapshots (reversion capability)
   - Update HWM immediately (assume withdrawal will succeed)

3. **Create `ef_revert_withdrawal_fees`**
   - Trigger: Withdrawal declined or failed
   - Fetch snapshot from withdrawal_fee_snapshots
   - Restore pre_withdrawal_hwm to customer_state_daily
   - Create reversal ledger entry: kind='performance_fee_reversal', amount positive (refund)
   - Delete snapshot (no longer needed)

4. **Testing:**
   - TC1.3: Month-end HWM profit → 10% performance fee charged
   - TC1.4: Month-end no profit → No performance fee, HWM unchanged
   - TC1.5: Withdrawal with interim fee → HWM snapshot created
   - TC1.6: Withdrawal reversion → HWM restored, fee refunded

---

**Signed off:** GitHub Copilot  
**Date:** 2026-01-21  
**Version:** v0.6.25
