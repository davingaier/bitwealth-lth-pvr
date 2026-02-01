# MARKET Fallback V2 Deployment - February 1, 2026

## Overview

Redesigned order monitoring architecture to separate polling from MARKET fallback logic, eliminating the 150-second timeout issue from the `while(true)` loop approach.

## Architecture Changes

### **Old Architecture (Failed)**
- Single function: `ef_poll_orders` with `while(true)` loop
- Problem: 150s Supabase timeout before 5-minute fallback could trigger
- Result: Orders stuck as LIMIT indefinitely

### **New Architecture (Implemented)**
Three independent functions with 1-minute cron schedules:

1. **ef_poll_orders** (v62) - Simplified single-pass polling
   - No loops, completes in ~5-10 seconds
   - Polls all `status='submitted'` orders once
   - Updates fills and order status
   - pg_cron: Every 1 minute (03:00-16:59 UTC)

2. **ef_market_fallback** (v1) - NEW function
   - Finds LIMIT orders aged > 5 minutes
   - Cancels LIMIT on VALR
   - Creates new MARKET order intent
   - Triggers `ef_execute_orders` to place MARKET order
   - Logs alert for audit trail
   - pg_cron: Every 1 minute (03:00-16:59 UTC)

3. **ef_execute_orders** (unchanged)
   - Places orders (LIMIT or MARKET)
   - Called by pipeline OR by `ef_market_fallback`

## Deployment Steps

### 1. Deploy Updated Functions
```powershell
# Simplified polling (removed while loop)
supabase functions deploy ef_poll_orders --project-ref wqnmxpooabmedvtackji --no-verify-jwt

# New market fallback function
supabase functions deploy ef_market_fallback --project-ref wqnmxpooabmedvtackji --no-verify-jwt
```

### 2. Apply Migration
```sql
-- Creates 1-minute cron jobs for both functions
-- File: supabase/migrations/20260201_add_market_fallback_cron.sql
SELECT cron.schedule('poll-orders-1min', '*/1 3-16 * * *', ...);
SELECT cron.schedule('market-fallback-1min', '*/1 3-16 * * *', ...);
```

### 3. Verify Schedules
```sql
SELECT jobname, schedule, active, command 
FROM cron.job 
WHERE jobname IN ('poll-orders-1min', 'market-fallback-1min');
```

## Key Features

### MARKET Fallback Logic
```typescript
// Triggers when:
1. Order age > 5 minutes (300,000 ms)
2. Order status = 'submitted'
3. ext_order_id IS NOT NULL (actually on VALR)

// Actions:
1. Cancel LIMIT order via VALR DELETE /v1/orders/order
2. Update status to 'cancelled_for_market'
3. Create new order_intent with limit_price=NULL (MARKET)
4. HTTP POST to ef_execute_orders
5. Log info alert with conversion details
```

### Audit Trail
Every MARKET conversion creates:
- Updated `exchange_orders` record (status='cancelled_for_market')
- New `order_intents` record (reason='market_fallback', note with details)
- Alert event (severity='info') with conversion metadata

### Error Handling
- Continues processing if VALR cancel fails (order may be filled)
- Logs errors via `lth_pvr.alert_events`
- Preserves original order data for investigation

## Timeline Example

```
03:15:00 - Pipeline places LIMIT order @ 78,666
03:16:00 - ef_poll_orders: status=submitted, no fills
03:17:00 - ef_poll_orders: status=submitted, no fills
03:18:00 - ef_poll_orders: status=submitted, no fills
03:19:00 - ef_poll_orders: status=submitted, no fills
03:20:00 - ef_market_fallback: Detects 5-min age
          → Cancels LIMIT on VALR
          → Creates MARKET intent
          → Calls ef_execute_orders
03:20:05 - MARKET order fills immediately
03:21:00 - ef_poll_orders: Detects fill, creates order_fills record
03:21:00 - ef_post_ledger_and_balances: Processes fills
```

## Testing

### Manual Function Tests
```powershell
# Test polling (single pass)
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders \
  -H "Authorization: Bearer [anon_key]"

# Test market fallback (checks for stale orders)
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_market_fallback \
  -H "Authorization: Bearer [anon_key]"
```

### Expected Responses
```json
// ef_poll_orders
{"success": true, "processed": 2, "message": "Polled 2 orders"}

// ef_market_fallback (no stale orders)
{"success": true, "checked": 5, "converted": 0, "message": "Converted 0 stale orders to MARKET"}

// ef_market_fallback (with conversion)
{"success": true, "checked": 5, "converted": 1, "message": "Converted 1 stale orders to MARKET"}
```

### Alert Monitoring
```sql
-- Check market fallback alerts
SELECT 
  created_at,
  severity,
  message,
  context
FROM lth_pvr.alert_events
WHERE component = 'ef_market_fallback'
ORDER BY created_at DESC
LIMIT 10;
```

## Cron Schedule Details

### poll-orders-1min
- **Schedule:** `*/1 3-16 * * *` (every 1 minute, 03:00-16:59 UTC)
- **Function:** ef_poll_orders
- **Purpose:** Status updates and fill detection
- **Expected calls:** ~840/day (14 hours × 60 minutes)

### market-fallback-1min
- **Schedule:** `*/1 3-16 * * *` (every 1 minute, 03:00-16:59 UTC)
- **Function:** ef_market_fallback
- **Purpose:** Convert stale LIMIT orders to MARKET
- **Expected conversions:** 0-5/day (only when orders don't fill)

## Benefits Over V1

✅ **No timeouts** - Each function completes in <10 seconds  
✅ **Reliable fallback** - 5-minute window guaranteed  
✅ **Better observability** - Separate logs per function  
✅ **Audit trail** - Full conversion history in alerts  
✅ **Testable** - Can trigger fallback independently  
✅ **Scalable** - Independent cron intervals (can adjust)  
✅ **Maintainable** - Single responsibility per function

## Rollback Plan

If issues arise, revert to old 10-minute polling:

```sql
-- Disable new jobs
SELECT cron.unschedule('poll-orders-1min');
SELECT cron.unschedule('market-fallback-1min');

-- Re-enable old 10-minute polling
SELECT cron.schedule(
  'poll-orders-10min',
  '3,13,23,33,43,53 3-16 * * *',
  $$ SELECT net.http_post(...ef_poll_orders...) $$
);
```

## Files Changed

### New Files
- `supabase/functions/ef_market_fallback/index.ts` - New fallback function
- `supabase/migrations/20260201_add_market_fallback_cron.sql` - Cron schedules
- `MARKET_FALLBACK_V2_DEPLOYMENT.md` - This document

### Modified Files
- `supabase/functions/ef_poll_orders/index.ts` - Removed while loop, simplified to single-pass

### Unchanged Files
- `supabase/functions/ef_execute_orders/index.ts` - No changes needed
- All other pipeline functions - No changes

## Next Steps

1. ✅ Deploy functions
2. ✅ Apply migration (cron jobs)
3. ⏳ Monitor first trading day (Feb 3, 2026)
4. ⏳ Validate fallback triggers correctly
5. ⏳ Update test plan with new architecture
6. ⏳ Document in SDD v0.7

## Status

**Deployed:** February 1, 2026, 18:45 UTC  
**First Trading Day:** February 3, 2026 (Monday)  
**Version:** ef_poll_orders v62, ef_market_fallback v1  
**Cron Jobs:** Active (`poll-orders-1min`, `market-fallback-1min`)
