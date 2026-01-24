# TC1.2 Steps 6 & 7 - Quick Test Reference

## ✅ What Was Fixed

**Issue:** BTC platform fees transferred to main account but never converted to USDT

**Solution:** New `ef_convert_platform_fee_btc` function auto-converts BTC→USDT via MARKET order

**Triggers:**
1. After immediate transfer (fee >= 0.0001 BTC)
2. After batch transfer (accumulated fees cross threshold)
3. After monthly transfer (1st of month cron job)

---

## 🧪 Quick Test (Customer 47)

### Option A: New BTC Deposit

```powershell
# 1. Deposit BTC to Customer 47's subaccount via VALR

# 2. Run balance reconciliation (detects deposit)
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_balance_reconciliation `
  -H "Authorization: Bearer [anon_key]"

# 3. Run ledger posting (processes deposit, transfers fee, converts BTC)
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_post_ledger_and_balances `
  -H "Authorization: Bearer [service_role_key]"

# 4. Check alerts
SELECT * FROM lth_pvr.alert_events
WHERE component = 'ef_convert_platform_fee_btc' AND severity = 'info'
ORDER BY created_at DESC LIMIT 1;
```

### Option B: Manual Conversion Test

```powershell
# Test conversion function directly (if you have 0.00001052 BTC on main account)
# Replace [service_role_key] with actual key from Supabase Dashboard → Project Settings → API

$serviceRoleKey = "<your-actual-service-role-key>"

curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_convert_platform_fee_btc `
  -H "Authorization: Bearer $serviceRoleKey" `
  -H "Content-Type: application/json" `
  -d '{"btc_amount": 0.00001052, "customer_id": 47}'
```

**Note:** Fixed 2026-01-24 - VALR main account operations must NOT include `X-VALR-SUB-ACCOUNT-ID` header. See [TC12_401_FIX.md](docs/TC12_401_FIX.md) for details.

---

## ✅ Success Criteria

**Console Log:**
```
[ef_post_ledger_and_balances] BTC fee 0.00001052 transferred successfully, triggering conversion to USDT
[ef_convert_platform_fee_btc] Starting BTC → USDT conversion for platform fees
[ef_convert_platform_fee_btc] Market order placed: {...}
[ef_convert_platform_fee_btc] Conversion successful: 0.00001052 BTC → 1.05 USDT (avg price: 99808.95)
```

**Alert Record:**
```sql
{
  "component": "ef_convert_platform_fee_btc",
  "severity": "info",
  "message": "Platform fee converted: 0.00001052 BTC → $1.05 USDT",
  "context": {
    "order_id": "valr-order-uuid",
    "btc_amount": 0.00001052,
    "usdt_received": 1.05,
    "avg_price": 99808.95,
    "customer_id": 47
  }
}
```

**VALR Dashboard:**
- New MARKET SELL order: 0.00001052 BTC
- Status: Filled
- Pair: BTCUSDT
- Customer Order ID: `PLATFORM_FEE_CONV_[timestamp]`

---

## ❌ Failure Scenarios

### Conversion Fails (VALR API Error)

**Console:**
```
[ef_convert_platform_fee_btc] Error: VALR MARKET order failed: 400 - {"error":"Insufficient balance"}
```

**Alert:** Severity = `error`, check main account BTC balance

### Order Not Filled (Price Movement)

**Response:** HTTP 202 (Accepted)
```json
{
  "success": false,
  "message": "Order not filled yet",
  "order_id": "valr-order-uuid",
  "status": "Pending"
}
```

**Action:** Check VALR Dashboard → Orders, wait for fill or cancel manually

---

## 🔍 Verification Queries

```sql
-- Check last conversion
SELECT * FROM lth_pvr.alert_events
WHERE component = 'ef_convert_platform_fee_btc'
ORDER BY created_at DESC LIMIT 5;

-- Check accumulated fees (should be 0 after transfer)
SELECT * FROM lth_pvr.customer_accumulated_fees
WHERE customer_id = 47;

-- Check VALR transfers (should show BTC transfer)
SELECT * FROM lth_pvr.exchange_transfers
WHERE customer_id = 47 AND currency = 'BTC'
ORDER BY created_at DESC LIMIT 1;
```

---

**Status:** ✅ DEPLOYED (2026-01-24)  
**Ready for:** TC1.2 Steps 6 & 7 execution
