# Automated Balance Reconciliation System
**Created:** 2026-01-05  
**Status:** ✅ Deployed and tested  
**Component:** ef_balance_reconciliation  

## Overview

VALR does **NOT** provide webhook support for deposits/withdrawals. Their documentation only mentions WebSocket API for real-time trading data (market quotes, order updates), not for bank deposit/withdrawal events.

**Solution:** Automated balance reconciliation via scheduled polling of VALR API.

## Architecture

### Edge Function: `ef_balance_reconciliation`
- **Purpose:** Detect manual transfers, deposits, or withdrawals not tracked by system
- **Method:** Compare VALR API balances with `lth_pvr.balances_daily` records
- **Schedule:** Hourly at :30 minutes past the hour (via pg_cron job #32)
- **Deployment:** `--no-verify-jwt` (triggered by pg_cron, not user requests)

### Flow Diagram
```
┌─────────────────────┐
│   pg_cron (hourly)  │ Every hour at :30
│   Job ID: 32        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│ ef_balance_reconciliation                                     │
├─────────────────────────────────────────────────────────────┤
│ 1. Query: Get all active customers (registration_status)     │
│ 2. Query: Get customer portfolios + exchange_accounts        │
│ 3. FOR EACH customer:                                        │
│    a. Call VALR API: GET /v1/account/balances (with subacct) │
│    b. Query: Get balances_daily for today                    │
│    c. Compare: BTC (± 0.00000001) | USDT (± 0.01)           │
│    d. IF discrepancy detected:                               │
│       - INSERT exchange_funding_events (deposit/withdrawal)  │
│       - UPSERT balances_daily (match VALR reality)           │
│ 4. Return: {scanned, reconciled, discrepancies, errors}      │
└─────────────────────────────────────────────────────────────┘
```

## Data Tables

### Input Tables
- `public.customer_details` - Active customers (registration_status='active')
- `public.customer_portfolios` - Portfolio → exchange_account mapping
- `public.exchange_accounts` - VALR subaccount IDs
- `lth_pvr.balances_daily` - System's recorded balances (date=today)

### Output Tables
- `lth_pvr.exchange_funding_events` - Auto-created funding events for discrepancies
- `lth_pvr.balances_daily` - Updated to match VALR API reality

## Reconciliation Logic

### Tolerance Thresholds
- **BTC:** ± 0.00000001 BTC (1 Satoshi tolerance for rounding)
- **USDT:** ± 0.01 USDT (1 cent tolerance for rounding)

### Discrepancy Detection
```typescript
const btcDiff = Math.abs(valrBTC - recordedBTC);
const usdtDiff = Math.abs(valrUSDT - recordedUSDT);

if (btcDiff > 0.00000001 || usdtDiff > 0.01) {
  // DISCREPANCY DETECTED
  // 1. Create funding event (deposit if positive, withdrawal if negative)
  // 2. Update balances_daily to match VALR
}
```

### Funding Event Creation
```sql
-- Example: Customer manually transferred 2 USDT out
INSERT INTO lth_pvr.exchange_funding_events (
  org_id,
  customer_id,
  exchange_account_id,
  kind,                 -- 'withdrawal' (negative change)
  asset,                -- 'USDT'
  amount,               -- 2.00 (absolute value)
  ext_ref,              -- 'AUTO_RECON_2026-01-05_USDT'
  occurred_at,          -- NOW()
  idempotency_key,      -- 'RECON_{customer_id}_{date}_USDT_{timestamp}'
  notes                 -- 'Automated reconciliation: VALR API shows 0.00 USDT, recorded 2.00 USDT'
);
```

## Deployment

### Deploy Edge Function
```powershell
.\deploy-balance-reconciliation.ps1
# OR manually:
supabase functions deploy ef_balance_reconciliation `
  --project-ref wqnmxpooabmedvtackji `
  --no-verify-jwt
```

### Apply Migration (pg_cron job)
```powershell
# Migration already applied: 20260105_add_balance_reconciliation.sql
# Verify job exists:
SELECT * FROM cron.job WHERE jobname = 'balance-reconciliation-hourly';
```

### Manual Testing
```powershell
curl -X POST "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_balance_reconciliation" `
  -H "Content-Type: application/json" `
  -d "{}"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Balance reconciliation complete",
  "results": {
    "scanned": 3,
    "reconciled": 3,
    "discrepancies": 0,
    "errors": 0,
    "details": []
  }
}
```

**With Discrepancy Detected:**
```json
{
  "success": true,
  "message": "Balance reconciliation complete",
  "results": {
    "scanned": 3,
    "reconciled": 3,
    "discrepancies": 1,
    "errors": 0,
    "details": [
      {
        "customer_id": 31,
        "customer_name": "Jemaica Gaier",
        "btc_valr": 0.00000000,
        "btc_recorded": 0.00000000,
        "btc_diff": 0,
        "usdt_valr": 0.00,
        "usdt_recorded": 2.00,
        "usdt_diff": -2.00,
        "action": "funding_events_created"
      }
    ]
  }
}
```

## Production Operations

### Schedule
- **Frequency:** Hourly (every hour at :30 minutes past)
- **Cron Expression:** `30 * * * *`
- **Job ID:** 32
- **Job Name:** `balance-reconciliation-hourly`

### Monitoring

#### Check Job Status
```sql
SELECT jobid, schedule, active, jobname
FROM cron.job
WHERE jobname = 'balance-reconciliation-hourly';
```

#### Check Execution History
```sql
SELECT 
  jobid, 
  runid, 
  status, 
  start_time, 
  end_time,
  return_message
FROM cron.job_run_details 
WHERE jobid = 32  -- balance-reconciliation-hourly
ORDER BY start_time DESC 
LIMIT 10;
```

#### Check Recent Funding Events (Auto-Created)
```sql
SELECT 
  funding_id,
  customer_id,
  kind,
  asset,
  amount,
  ext_ref,
  occurred_at,
  notes
FROM lth_pvr.exchange_funding_events
WHERE ext_ref LIKE 'AUTO_RECON%'
ORDER BY occurred_at DESC
LIMIT 10;
```

### Manual Trigger (for testing)
```sql
SELECT net.http_post(
  url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_balance_reconciliation',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
  ),
  body := jsonb_build_object()
) AS request_id;
```

### Disable Job (if needed)
```sql
SELECT cron.unschedule('balance-reconciliation-hourly');
```

## Known Limitations

1. **VALR Webhook Unavailable:** No real-time notifications from VALR for deposit/withdrawal events
2. **Hourly Lag:** Maximum 60-minute delay between manual transfer and system detection
3. **No Historical Reconciliation:** Only checks today's balances (date=CURRENT_DATE)
4. **Subaccount-Level Only:** Cannot detect intra-subaccount transfers (VALR limitation)
5. **NAV Rough Estimate:** Initial NAV calculation uses hardcoded BTC price (95000), corrected later by `ef_post_ledger_and_balances`

## Testing History

### Test 1: Zero Discrepancies (2026-01-05)
- **Scanned:** 3 customers (12, 31, 39)
- **Result:** No discrepancies (all balances match)
- **Status:** ✅ PASS

### Test 2: Manual Withdrawal (2026-01-05)
- **Setup:** Customer 31 had 2.00 USDT in database, manually transferred out via VALR
- **Expected:** Create withdrawal event, update balance to 0.00
- **Actual:** Discrepancy detected, funding event created, balance updated
- **Status:** ✅ PASS (manual verification via SQL)

## Future Enhancements

1. **Historical Reconciliation:** Add date range parameter to check past balances
2. **Alert Integration:** Call `lth_pvr.raise_alert()` for large discrepancies (>$100 USD)
3. **Reconciliation Report:** Daily email digest of all discrepancies found
4. **Balance Drift Detection:** Track cumulative discrepancies per customer over time
5. **VALR Webhook Migration:** If VALR adds webhook support, replace polling with event-driven approach

## Related Components

- `ef_deposit_scan` - Hourly scan for initial customer deposits (Milestone 5)
- `ef_post_ledger_and_balances` - Calculates NAV after order fills (daily pipeline)
- `lth_pvr.exchange_funding_events` - Source of truth for deposits/withdrawals
- `lth_pvr.balances_daily` - Daily balance snapshots for reporting

## References

- **VALR API Docs:** https://docs.valr.com/ (no webhook endpoints documented)
- **SDD Section:** Will be updated in v0.6.9 with this feature
- **Migration File:** `supabase/migrations/20260105_add_balance_reconciliation.sql`
- **Edge Function:** `supabase/functions/ef_balance_reconciliation/index.ts`
- **Deployment Script:** `deploy-balance-reconciliation.ps1`

---

**Last Updated:** 2026-01-05  
**Author:** GitHub Copilot (Claude Sonnet 4.5)  
**Deployed By:** Davin Yates
