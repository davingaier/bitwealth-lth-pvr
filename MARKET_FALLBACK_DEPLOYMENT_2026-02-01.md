# MARKET Fallback Logic - Deployment Complete
**Date:** 2026-02-01  
**Status:** ✅ DEPLOYED (Polling-Only Architecture)

---

## Summary of Changes

### 1. Updated ef_poll_orders ✅
**Changes:**
- Added 10-second polling loop (previously single-pass)
- Removed exit constraints (now runs until all orders complete)
- Loop continues indefinitely checking for open orders every 10 seconds

**Key Logic:**
```typescript
// Polls every 10 seconds until no orders remain
while (true) {
  pollCount++;
  // Fetch orders requiring polling
  // Process each order (check age, price move)
  // If fallback needed: cancel LIMIT → place MARKET
  
  // Check for remaining orders
  if (no more orders) {
    return { message: "All orders complete" };
  }
  
  // Wait 10 seconds
  await new Promise(resolve => setTimeout(resolve, 10000));
}
```

**Fallback Triggers:**
1. **Time-based:** Order age ≥ 5 minutes (30 polls × 10s)
2. **Price-based:** Market moved ≥ 0.25% from LIMIT price

**Deployment:**
```powershell
supabase functions deploy ef_poll_orders --no-verify-jwt --project-ref wqnmxpooabmedvtackji
```
✅ Deployed successfully

---

### 2. Deleted ef_valr_ws_monitor ✅
**Reason:** WebSocket only reacted to VALR events (passive monitoring) without active MARKET fallback logic. Redundant when ef_poll_orders provides comprehensive monitoring every 10 seconds.

**Deleted:**
- Supabase deployed function: `supabase functions delete ef_valr_ws_monitor`
- Local directory: `supabase/functions/ef_valr_ws_monitor/`

**Impact:** No functionality loss - ef_poll_orders provides:
- Order status monitoring (every 10 seconds)
- Fill detection
- MARKET fallback logic (5-minute timeout + price move)
- Continuous operation until all orders complete

---

## Architecture Clarification

### Polling-Only Architecture (Simplified)

**Single Function: ef_poll_orders**
- Polls VALR API every 10 seconds
- Checks order age (time-based fallback)
- Checks market price (price-based fallback)
- Detects fills and updates database
- Creates fill records in order_fills table
- Runs indefinitely until all orders complete

**Advantages:**
- Single source of truth for order monitoring
- Active monitoring with intelligent fallback logic
- No duplicate detection issues (only one writer)
- Simpler architecture (easier to debug)
- Comprehensive alerting on all fallback events

**Disadvantages:**
- 10-second lag for fill detection (vs real-time WebSocket)
- More API calls (~360/hour during active orders vs ~60/hour with WebSocket)

**Trade-off Decision:** Simplified architecture + guaranteed MARKET fallback > real-time fills

---

## Testing Readiness

**Simplified Test Cases:**
1. Execute TC-FALLBACK-01 (5-minute timeout test)
2. Execute TC-FALLBACK-02 (price move test - requires BTC volatility)
3. Execute TC-FALLBACK-03 (immediate fill detection)

**Expected Costs:**
- TC-FALLBACK-01: $1.05 USDT (fills at market after 5 min)
- TC-FALLBACK-02: $1.05 USDT (fills at market after price move)
- TC-FALLBACK-03: $1.05 USDT (fills immediately at market price)
- **Total:** $3.15 USDT

**Budget Remaining:** $47 USDT (started with $60, spent $10 on TC-PIPE-01/02)

---

## Monitoring Queries

### Check Active Polling Sessions
```sql
-- See if polling is currently running
SELECT 
  exchange_order_id,
  ext_order_id,
  status,
  submitted_at,
  EXTRACT(EPOCH FROM (NOW() - submitted_at)) / 60 as age_minutes,
  last_polled_at,
  poll_count
FROM lth_pvr.exchange_orders
WHERE status = 'submitted'
  AND requires_polling = true
ORDER BY submitted_at DESC;
```

### Check Fallback Events
```sql
-- See MARKET fallback conversions
SELECT 
  created_at,
  component,
  message,
  context->>'intent_id' as intent_id,
  context->>'age_minutes' as age_minutes,
  context->>'price_move_pct' as price_move_pct
FROM lth_pvr.alert_events
WHERE component = 'ef_poll_orders'
  AND (message LIKE '%exceeded 5%' OR message LIKE '%price moved%')
ORDER BY created_at DESC;
```

### Check MARKET Orders Created
```sql
-- Orders created via fallback (have 'fallbackFrom' in raw)
SELECT 
  exchange_order_id,
  ext_order_id,
  side,
  price,
  qty,
  status,
  submitted_at,
  raw->'fallbackFrom' as original_order
FROM lth_pvr.exchange_orders
WHERE raw ? 'fallbackFrom'
ORDER BY submitted_at DESC;
```

---

## Rollback Plan

If issues arise, revert to previous behavior:

### Option 1: Re-enable Cron (Automatic Polling)
```sql
-- Create new cron job with 10-minute schedule
SELECT cron.schedule(
  'lthpvr_poll_orders',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := jsonb_build_object()
  );
  $$
);
```

### Option 2: Revert to Single-Pass Polling
- Redeploy previous version of ef_poll_orders (remove while loop)
- Keep manual invocation pattern

---

**Last Updated:** 2026-02-01  
**Deployed By:** AI Agent  
**Architecture:** Polling-Only (WebSocket deleted)  
**Tested:** ⏳ PENDING (TC-FALLBACK-01 to TC-FALLBACK-03)
