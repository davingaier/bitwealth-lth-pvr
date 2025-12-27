# WebSocket Order Monitoring - Test Cases

**Created:** 2025-12-27  
**Test Environment:** Production (wqnmxpooabmedvtackji.supabase.co)  
**Related Documentation:** WebSocket_Order_Monitoring_Implementation.md

---

## Test Summary

| Category | Total Tests | Executed | Passed | Failed | Blocked |
|----------|-------------|----------|--------|--------|---------|
| **1. Database Schema** | 4 | 0 | 0 | 0 | 0 |
| **2. Edge Function Deployment** | 3 | 1 | 1 | 0 | 0 |
| **3. WebSocket Connection** | 5 | 0 | 0 | 0 | 0 |
| **4. Order Monitoring** | 8 | 0 | 0 | 0 | 0 |
| **5. Fallback Polling** | 5 | 0 | 0 | 0 | 0 |
| **6. Error Handling** | 6 | 0 | 0 | 0 | 0 |
| **7. Performance** | 4 | 0 | 0 | 0 | 0 |
| **TOTAL** | **35** | **1** | **1** | **0** | **0** |

---

## 1. Database Schema Tests

### Test 1.1: WebSocket Tracking Columns Exist
**Objective:** Verify new columns added to exchange_orders table

**Test Steps:**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'lth_pvr'
  AND table_name = 'exchange_orders'
  AND column_name IN ('ws_monitored_at', 'last_polled_at', 'poll_count', 'requires_polling')
ORDER BY column_name;
```

**Expected Results:**
- 4 rows returned
- `ws_monitored_at`: timestamptz, nullable
- `last_polled_at`: timestamptz, nullable
- `poll_count`: integer, default 0
- `requires_polling`: boolean, default true

**Test Execution:**
- **Date:** 2025-12-27
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 1.2: Index on requires_polling Exists
**Objective:** Verify performance index created for polling queries

**Test Steps:**
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'lth_pvr'
  AND tablename = 'exchange_orders'
  AND indexname = 'idx_exchange_orders_requires_polling';
```

**Expected Results:**
- 1 row returned
- Index includes WHERE clause: `status = 'submitted'`
- Columns: (requires_polling, last_polled_at)

**Test Execution:**
- **Date:** 
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 1.3: Existing Submitted Orders Updated
**Objective:** Verify migration updated existing orders with requires_polling=true

**Test Steps:**
```sql
SELECT COUNT(*) as submitted_orders_with_flag
FROM lth_pvr.exchange_orders
WHERE status = 'submitted'
  AND requires_polling = true;

SELECT COUNT(*) as submitted_orders_missing_flag
FROM lth_pvr.exchange_orders
WHERE status = 'submitted'
  AND requires_polling IS NULL;
```

**Expected Results:**
- All submitted orders have `requires_polling = true`
- Zero orders with `requires_polling IS NULL`

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 1.4: Cron Schedule Updated to 10 Minutes
**Objective:** Verify polling cron reduced from 1 min to 10 min

**Test Steps:**
```sql
SELECT jobid, jobname, schedule, active, database, nodename
FROM cron.job
WHERE jobname LIKE '%poll_orders%' OR command LIKE '%ef_poll_orders%';
```

**Expected Results:**
- Schedule = `*/10 * * * *` (every 10 minutes)
- active = true
- Job exists and is enabled

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

## 2. Edge Function Deployment Tests

### Test 2.1: ef_valr_ws_monitor Deployed
**Objective:** Verify WebSocket monitor function deployed successfully

**Test Steps:**
```sql
-- Via MCP or SQL
SELECT * FROM net.http_get(
  'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_valr_ws_monitor',
  headers := jsonb_build_object(
    'Authorization', 'Bearer [SERVICE_ROLE_KEY]'
  )
);
```

**Expected Results:**
- Status code: 405 (Method Not Allowed) for GET
- Confirms function is deployed and responding

**Test Execution:**
- **Date:** 2025-12-27 20:36 UTC
- **Result:** ✅ PASS
- **Notes:** Function deployed as version 1, ID: 174437b6-22c7-4bc2-b988-6558f137f2c3, verify_jwt=false, status=ACTIVE

---

### Test 2.2: ef_execute_orders Updated
**Objective:** Verify updated version includes WebSocket monitor trigger

**Test Steps:**
- Check function logs for "Initiated WebSocket monitoring" message after order placement
- Grep source code for `ef_valr_ws_monitor` reference

**Expected Results:**
- Code includes WebSocket monitor call
- Function compiles without errors

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING (blocked by CLI config error)
- **Notes:** Code changes complete, deployment pending CLI update

---

### Test 2.3: ef_poll_orders Updated
**Objective:** Verify polling includes WebSocket tracking logic

**Test Steps:**
- Check function source for targeted polling parameter
- Verify poll_count and last_polled_at updates

**Expected Results:**
- Accepts `?order_ids=uuid1,uuid2` query parameter
- Updates tracking columns on each poll
- Filters out recently polled orders (<2 min)

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING (blocked by CLI config error)
- **Notes:** Code changes complete, deployment pending CLI update

---

## 3. WebSocket Connection Tests

### Test 3.1: WebSocket Handshake Authentication
**Objective:** Verify HMAC signature authentication works

**Test Steps:**
```powershell
# Manual WebSocket test (requires wscat or similar)
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$path = "/ws/trade"
$payload = "$timestamp" + "GET" + "$path"

# Calculate HMAC signature
$hmac = [System.Security.Cryptography.HMACSHA512]::new([Text.Encoding]::UTF8.GetBytes($env:VALR_API_SECRET))
$hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))
$signature = ($hash | ForEach-Object { $_.ToString("x2") }) -join ""

# Connect via wscat or browser
wscat -c "wss://api.valr.com/ws/trade?X-VALR-API-KEY=$env:VALR_API_KEY&X-VALR-SIGNATURE=$signature&X-VALR-TIMESTAMP=$timestamp"
```

**Expected Results:**
- Connection established
- No authentication errors
- Ready to subscribe

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 3.2: Subscribe to Order Updates
**Objective:** Verify subscription message accepted

**Test Steps:**
```json
// Send after connection
{
  "type": "SUBSCRIBE",
  "subscriptions": [
    { "event": "ACCOUNT_ORDER_UPDATE" }
  ]
}
```

**Expected Results:**
- Subscription acknowledged
- No error messages
- Ready to receive order events

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 3.3: Receive Order Update Event
**Objective:** Verify order update messages received

**Test Steps:**
1. Place a test order via VALR API or ef_execute_orders
2. Monitor WebSocket connection
3. Wait for order update event

**Expected Results:**
- Message type: ORDER_PROCESSED, ORDER_STATUS_UPDATE, or ORDER_FILLED
- Contains orderId and customerOrderId
- Status field present

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 3.4: WebSocket Timeout After 5 Minutes
**Objective:** Verify WebSocket closes after timeout

**Test Steps:**
1. Call ef_valr_ws_monitor with test order IDs
2. Wait 5 minutes without order completion
3. Check function logs

**Expected Results:**
- Log message: "Timeout reached, closing WebSocket"
- Function returns with processed count
- Connection closed gracefully

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 3.5: WebSocket Closes When All Orders Complete
**Objective:** Verify early closure when monitoring complete

**Test Steps:**
1. Call ef_valr_ws_monitor with 1 test order
2. Complete order (fill or cancel)
3. Check function logs

**Expected Results:**
- Log message: "All orders complete, closing WebSocket"
- Function returns immediately
- Timeout cancelled

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

## 4. Order Monitoring Tests

### Test 4.1: Order Status Update to Database
**Objective:** Verify WebSocket updates exchange_orders table

**Test Steps:**
1. Insert test order with status='submitted'
2. Trigger WebSocket monitor
3. Simulate order fill via VALR
4. Query exchange_orders table

**Expected Results:**
```sql
SELECT status, ws_monitored_at, updated_at, raw
FROM lth_pvr.exchange_orders
WHERE intent_id = 'test-order-id';
-- Status should be 'filled', raw should contain VALR data
```

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 4.2: Order Fills Created
**Objective:** Verify fills extracted from WebSocket message

**Test Steps:**
1. Place order that will fill
2. Monitor WebSocket
3. Check order_fills table

**Expected Results:**
```sql
SELECT filled_qty, filled_price, fee_amount, fee_asset, filled_at
FROM lth_pvr.order_fills
WHERE exchange_order_id = 'test-order-id';
-- Should have 1+ rows with fill data
```

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 4.3: Multiple Orders Tracked Simultaneously
**Objective:** Verify WebSocket monitors multiple orders

**Test Steps:**
1. Execute 3 orders via ef_execute_orders
2. Check WebSocket monitor called with 3 order_ids
3. Verify all 3 updated

**Expected Results:**
- Log: "Monitoring 3 orders via WebSocket"
- All 3 orders have ws_monitored_at set
- All 3 orders updated when filled

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 4.4: Orders Grouped by Subaccount
**Objective:** Verify orders grouped correctly for different subaccounts

**Test Steps:**
1. Create orders for 2 different exchange_account_ids
2. Execute orders
3. Verify 2 separate WebSocket monitor calls

**Expected Results:**
- 2 WebSocket connections (one per subaccount)
- Each monitors only its orders
- No cross-contamination

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 4.5: Partial Fill Updates
**Objective:** Verify partially filled orders stay open

**Test Steps:**
1. Place large order that will partially fill
2. Monitor WebSocket
3. Check order status

**Expected Results:**
- Status remains 'submitted' after partial fill
- order_fills table has entry for partial amount
- WebSocket continues monitoring

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 4.6: Order Cancellation Detected
**Objective:** Verify cancelled orders stop monitoring

**Test Steps:**
1. Place order
2. Cancel via VALR
3. Check WebSocket updates

**Expected Results:**
- Status updated to 'cancelled'
- requires_polling set to false
- Order removed from monitored set
- Log: "Order complete (Cancelled)"

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 4.7: requires_polling Flag Management
**Objective:** Verify flag toggled correctly

**Test Steps:**
```sql
-- Check submitted order
SELECT requires_polling FROM lth_pvr.exchange_orders WHERE status = 'submitted';
-- Should be true

-- Check filled order
SELECT requires_polling FROM lth_pvr.exchange_orders WHERE status = 'filled';
-- Should be false
```

**Expected Results:**
- Submitted: requires_polling = true
- Filled/Cancelled: requires_polling = false

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 4.8: ws_monitored_at Timestamp Set
**Objective:** Verify timestamp recorded when WebSocket starts

**Test Steps:**
1. Execute order
2. Check ws_monitored_at immediately after

**Expected Results:**
```sql
SELECT ws_monitored_at, submitted_at,
       EXTRACT(EPOCH FROM (ws_monitored_at - submitted_at)) as delay_seconds
FROM lth_pvr.exchange_orders
WHERE intent_id = 'test-id';
-- delay_seconds should be <5 seconds
```

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

## 5. Fallback Polling Tests

### Test 5.1: Polling Skips Recently Polled Orders
**Objective:** Verify 2-minute filter works

**Test Steps:**
1. Update order with last_polled_at = NOW()
2. Run ef_poll_orders
3. Check order not polled again

**Expected Results:**
- Order skipped
- poll_count unchanged
- Log: "Safety net polling for stale orders"

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 5.2: Polling Updates Tracking Columns
**Objective:** Verify poll updates last_polled_at and poll_count

**Test Steps:**
1. Set last_polled_at = NOW() - INTERVAL '3 minutes'
2. Run ef_poll_orders
3. Check columns updated

**Expected Results:**
```sql
SELECT poll_count, last_polled_at
FROM lth_pvr.exchange_orders
WHERE intent_id = 'test-id';
-- poll_count incremented
-- last_polled_at = NOW()
```

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 5.3: Targeted Polling via Query Parameter
**Objective:** Verify targeted polling works

**Test Steps:**
```powershell
Invoke-WebRequest `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders?order_ids=uuid1,uuid2" `
  -Method POST `
  -Headers @{"Authorization" = "Bearer [SERVICE_ROLE_KEY]"}
```

**Expected Results:**
- Only specified orders polled
- Other submitted orders ignored
- Response: `{"processed": 2}`

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 5.4: Cron Runs Every 10 Minutes
**Objective:** Verify reduced polling frequency

**Test Steps:**
```sql
-- Check next 3 scheduled runs
SELECT jobid, schedule, 
       timezone('UTC', next_run) as next_run_utc
FROM cron.job
WHERE jobname LIKE '%poll_orders%';

-- Monitor cron.job_run_details for actual executions
SELECT start_time, end_time, status
FROM cron.job_run_details
WHERE jobid = [poll_orders_job_id]
ORDER BY start_time DESC
LIMIT 10;
```

**Expected Results:**
- Runs at :00, :10, :20, :30, :40, :50 each hour
- No runs between these times
- Status = 'succeeded'

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 5.5: Fallback After WebSocket Failure
**Objective:** Verify polling catches orders if WebSocket fails

**Test Steps:**
1. Disable WebSocket monitor (set invalid API key)
2. Execute order
3. Wait for cron poll
4. Verify order updated

**Expected Results:**
- Order eventually updated by polling
- poll_count > 0
- ws_monitored_at may be NULL or set but failed

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

## 6. Error Handling Tests

### Test 6.1: Invalid order_ids Parameter
**Objective:** Verify validation of input

**Test Steps:**
```powershell
$body = '{"order_ids": "not-an-array"}'
Invoke-WebRequest -Uri "[...]/ef_valr_ws_monitor" -Method POST -Body $body
```

**Expected Results:**
- Status: 400 Bad Request
- Error message: "order_ids array required"

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 6.2: Empty order_ids Array
**Objective:** Verify handling of empty array

**Test Steps:**
```powershell
$body = '{"order_ids": []}'
Invoke-WebRequest -Uri "[...]/ef_valr_ws_monitor" -Method POST -Body $body
```

**Expected Results:**
- Status: 400 Bad Request
- Error message: "order_ids array required"

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 6.3: WebSocket Connection Failure
**Objective:** Verify error handling for connection issues

**Test Steps:**
1. Set invalid VALR_WS_URL
2. Call ef_valr_ws_monitor
3. Check logs and alert_events

**Expected Results:**
- Function returns 500 error
- Log: "WebSocket error"
- Alert created: severity='error', component='ef_valr_ws_monitor'

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 6.4: Database Update Failure
**Objective:** Verify handling of database errors

**Test Steps:**
1. Simulate DB connection issue
2. Process WebSocket message
3. Check error handling

**Expected Results:**
- Error logged
- Alert created with error details
- WebSocket continues monitoring other orders

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 6.5: Order Not Found in Monitored Set
**Objective:** Verify filtering of unrelated orders

**Test Steps:**
1. Monitor order_ids: ['uuid1', 'uuid2']
2. Receive WebSocket message for 'uuid3'
3. Check processing

**Expected Results:**
- Message ignored
- No database update
- Log: No entry (filtered before processing)

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 6.6: Alert Created on WebSocket Failure
**Objective:** Verify alerting integration

**Test Steps:**
1. Trigger WebSocket error
2. Query alert_events table

**Expected Results:**
```sql
SELECT alert_id, severity, component, message, context
FROM lth_pvr.alert_events
WHERE component = 'ef_valr_ws_monitor'
  AND resolved_at IS NULL
ORDER BY created_at DESC
LIMIT 1;

-- Should have error alert with context details
```

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

## 7. Performance Tests

### Test 7.1: API Call Reduction
**Objective:** Measure actual API call reduction

**Test Steps:**
1. Baseline: Count polls for 10 orders (old system)
2. Test: Count polls for 10 orders (WebSocket system)
3. Compare

**Expected Results:**
- Old: ~50 API calls (5 polls per order before fill)
- New: ~10 API calls (1 WebSocket handshake per subaccount + safety polls)
- **Reduction: ~80%**

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 7.2: Order Update Latency
**Objective:** Measure time from fill to database update

**Test Steps:**
1. Place order and record timestamp
2. Wait for fill
3. Query exchange_orders.updated_at
4. Calculate latency

**Expected Results:**
- WebSocket: <5 seconds
- Polling: 30-60 seconds average
- **Improvement: 90%+**

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 7.3: Concurrent Order Monitoring
**Objective:** Verify system handles multiple simultaneous orders

**Test Steps:**
1. Execute 20 orders simultaneously
2. Monitor WebSocket connections
3. Verify all updated correctly

**Expected Results:**
- All orders monitored
- No connection limits reached
- All fills captured
- < 10 second average update time

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

### Test 7.4: Database Query Performance
**Objective:** Verify index improves polling query performance

**Test Steps:**
```sql
EXPLAIN ANALYZE
SELECT * FROM lth_pvr.exchange_orders
WHERE status = 'submitted'
  AND (last_polled_at IS NULL OR last_polled_at < NOW() - INTERVAL '2 minutes')
  AND requires_polling = true;
```

**Expected Results:**
- Uses idx_exchange_orders_requires_polling
- Execution time < 10ms
- No sequential scan

**Test Execution:**
- **Date:**
- **Result:** ⏳ PENDING
- **Notes:**

---

## Test Execution Guidelines

### Prerequisites
- [ ] Database migrations applied
- [ ] ef_valr_ws_monitor deployed
- [ ] ef_execute_orders updated (pending CLI fix)
- [ ] ef_poll_orders updated (pending CLI fix)
- [ ] VALR API credentials configured
- [ ] Test orders can be placed safely

### Test Order
1. **Start with Schema Tests (1.1-1.4)** - Foundation verification
2. **Deployment Tests (2.1-2.3)** - Confirm all functions deployed
3. **WebSocket Tests (3.1-3.5)** - Core functionality
4. **Order Monitoring (4.1-4.8)** - Integration tests
5. **Fallback Polling (5.1-5.5)** - Safety net verification
6. **Error Handling (6.1-6.6)** - Resilience tests
7. **Performance (7.1-7.4)** - Optimization validation

### Environment
- **Production:** wqnmxpooabmedvtackji.supabase.co
- **Test Orders:** Use small amounts (< $1 USD)
- **Test Subaccount:** Dedicated test subaccount recommended

### Reporting
- Update this document after each test
- Include actual vs expected results
- Document any issues discovered
- Create alerts for failed tests

---

**Last Updated:** 2025-12-27  
**Test Execution Status:** 1/35 tests executed (2.9%)  
**Next Test:** 1.1 - Database Schema Verification
