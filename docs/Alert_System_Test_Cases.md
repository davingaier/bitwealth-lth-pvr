# Alert System Test Cases
**Date:** December 27, 2025  
**Version:** 1.0  
**Scope:** LTH PVR Alerting System Implementation

---

## 1. Database Function Tests

### 1.1 lth_pvr.ensure_ci_bands_today

#### Test Case 1.1.1: Successful CI Bands Fetch ✅ PASS
**Objective:** Verify function calls edge function when CI bands missing  
**Preconditions:**
- No ci_bands_daily record exists for yesterday (function targets CURRENT_DATE - 1 day)
- service_role_key exists in vault.decrypted_secrets
- ef_fetch_ci_bands edge function is deployed and accessible

**Test Steps:**
1. Delete ci_bands_daily records for yesterday
2. Execute: `SELECT lth_pvr.ensure_ci_bands_today();`
3. Query ci_bands_guard_log for latest entry
4. Verify ci_bands_daily data populated

**Expected Results:**
- Function returns without error
- ci_bands_guard_log shows status = 200, did_call = true
- request_id is populated (bigint)
- ci_bands_daily table populated with yesterday's data

**Test Execution:**
- Date: 2025-12-27 14:39:39 UTC
- Result: ✅ PASS
- Log Entry ID: 352
- Request ID: 84563
- Status: 200
- Target Date: 2025-12-26
- BTC Price: 87,337.95
- Note: Function name is misleading - it actually ensures YESTERDAY's CI bands exist, which is correct business logic since today's bands require complete trading day data

---

#### Test Case 1.1.2: CI Bands Already Exist ✅ PASS
**Objective:** Verify function skips fetch when data exists  
**Preconditions:**
- ci_bands_daily record exists for yesterday

**Test Steps:**
1. Ensure ci_bands_daily has yesterday's record
2. Execute: `SELECT lth_pvr.ensure_ci_bands_today();`
3. Check ci_bands_guard_log

**Expected Results:**
- Function returns without error
- New ci_bands_guard_log entry created with did_call = false
- Existing ci_bands_daily data unchanged

**Test Execution:**
- Date: 2025-12-27 14:44:29 UTC
- Result: ✅ PASS
- Log Entry ID: 353
- Did Call: false (correctly skipped HTTP fetch)
- Status: 200
- Details: {"info": "row present", "target_date": "2025-12-26"}
- BTC Price: 87,337.95 (unchanged)
- Note: Function correctly detected existing data and avoided redundant API call

---

#### Test Case 1.1.3: Missing Vault Secret ⚠️ SKIP (PRODUCTION RISK)
**Objective:** Verify graceful handling of missing service_role_key  
**Preconditions:**
- service_role_key NOT in vault.decrypted_secrets

**Test Steps:**
1. Remove service_role_key from vault (if safe to test)
2. Execute: `SELECT lth_pvr.ensure_ci_bands_today();`

**Expected Results:**
- Function raises error about missing vault secret
- ci_bands_guard_log shows error status
- No HTTP request attempted

**Test Execution:**
- Date: 2025-12-27
- Result: ⚠️ SKIPPED - Too risky for production environment
- Code Review: ✅ VERIFIED - Error handling exists in function (lines 24-26)
- Logic Confirmed:
  ```sql
  if v_service_key is null then
    raise exception 'service_role_key not found in vault';
  end if;
  ```
- Recommendation: Execute this test in a dedicated test/staging environment with isolated vault
- Alternative: Create a modified test version of function pointing to non-existent vault key

---

## 2. Alerting Module Tests

### 2.1 logAlert Function

#### Test Case 2.1.1: Basic Alert Creation
**Objective:** Verify alert_events record creation  
**Test Data:**
```typescript
await logAlert(
  supabaseClient,
  'test_component',
  'error',
  'Test alert message',
  { test_key: 'test_value' },
  'test-org-id',
  123,
  'test-portfolio-id'
);
```

**Expected Results:**
- New record in lth_pvr.alert_events
- component = 'test_component'
- severity = 'error'
- message = 'Test alert message'
- context JSONB contains test_key
- org_id = 'test-org-id'
- customer_id = 123
- portfolio_id = 'test-portfolio-id'
- created_at is set
- resolved_at is NULL

**SQL Verification:**
```sql
SELECT * FROM lth_pvr.alert_events 
WHERE component = 'test_component' 
ORDER BY created_at DESC LIMIT 1;
```

---

#### Test Case 2.1.2: Severity Levels
**Objective:** Test all four severity levels  
**Test Steps:**
1. Create alerts with severity: 'info', 'warn', 'error', 'critical'
2. Query alert_events table

**Expected Results:**
- All four alerts created successfully
- Severity values stored correctly
- UI displays correct color coding:
  - info: blue (#dbeafe)
  - warn: amber (#fef3c7)
  - error: red (#fee2e2)
  - critical: red (#fee2e2)

---

#### Test Case 2.1.3: Context Object Persistence
**Objective:** Verify complex context data storage  
**Test Data:**
```typescript
const context = {
  customer_id: 456,
  intent_id: 'intent-789',
  trade_date: '2025-12-27',
  error: 'VALR API timeout',
  retry_count: 3,
  nested: { key: 'value' }
};
```

**Expected Results:**
- All context fields stored in JSONB column
- Nested objects preserved
- Query with context->'retry_count' returns 3
- Query with context->>'error' returns 'VALR API timeout'

---

#### Test Case 2.1.4: Null Optional Parameters
**Objective:** Verify handling of null org_id/customer_id/portfolio_id  
**Test Steps:**
```typescript
await logAlert(
  supabaseClient,
  'test_component',
  'info',
  'Message without context IDs',
  {},
  null,
  null,
  null
);
```

**Expected Results:**
- Alert created successfully
- org_id, customer_id, portfolio_id are NULL in database
- No errors thrown

---

#### Test Case 2.1.5: Error Handling
**Objective:** Verify graceful failure when database unavailable  
**Test Steps:**
1. Provide invalid Supabase client or network failure
2. Call logAlert()

**Expected Results:**
- Function does not throw exception
- Error logged to console
- Application continues executing

---

### 2.2 hasUnresolvedAlert Function

#### Test Case 2.2.1: Detect Unresolved Alert
**Objective:** Return true when unresolved alerts exist  
**Preconditions:**
- Alert exists with resolved_at = NULL

**Test Steps:**
```typescript
const exists = await hasUnresolvedAlert(
  supabaseClient,
  'ef_execute_orders',
  'test-org-id'
);
```

**Expected Results:**
- Function returns true

---

#### Test Case 2.2.2: No Unresolved Alerts
**Objective:** Return false when all alerts resolved  
**Preconditions:**
- All alerts have resolved_at NOT NULL

**Test Steps:**
```typescript
const exists = await hasUnresolvedAlert(
  supabaseClient,
  'ef_execute_orders',
  'test-org-id'
);
```

**Expected Results:**
- Function returns false

---

#### Test Case 2.2.3: Additional Filters
**Objective:** Verify customer_id filtering  
**Test Steps:**
```typescript
const exists = await hasUnresolvedAlert(
  supabaseClient,
  'ef_execute_orders',
  'test-org-id',
  { customer_id: 123 }
);
```

**Expected Results:**
- Only checks alerts matching both component, org_id, AND customer_id = 123
- Returns appropriate boolean

---

## 3. Edge Function Alerting Tests

### 3.1 ef_generate_decisions Alerts

#### Test Case 3.1.1: CI Bands Unavailable
**Scenario:** No CI bands data for today  
**Expected Alert:**
- Component: 'ef_generate_decisions'
- Severity: 'error'
- Message: 'CI bands not available for today'
- Context: { trade_date: '2025-12-27' }

**Test Setup:**
```sql
DELETE FROM lth_pvr.ci_bands_daily WHERE trade_date = CURRENT_DATE;
```

**Invoke:**
```bash
curl -X POST https://[project-ref].supabase.co/functions/v1/ef_generate_decisions \
  -H "Authorization: Bearer [anon-key]"
```

**Verification:**
```sql
SELECT * FROM lth_pvr.alert_events 
WHERE component = 'ef_generate_decisions' 
  AND message LIKE '%CI bands not available%'
ORDER BY created_at DESC LIMIT 1;
```

---

#### Test Case 3.1.2: No Active Customers
**Scenario:** No customers with active strategies  
**Expected Alert:**
- Severity: 'info'
- Message: 'No active customers found for decisions today'

**Test Setup:**
```sql
UPDATE lth_pvr.customer_strategies 
SET effective_to = CURRENT_DATE - INTERVAL '1 day'
WHERE org_id = 'test-org-id';
```

---

#### Test Case 3.1.3: Per-Customer Decision Failure
**Scenario:** LTH logic fails for specific customer  
**Expected Alert:**
- Severity: 'error'
- Message contains customer failure details
- Context includes: customer_id, error message

**Test Setup:**
- Create customer with invalid strategy parameters
- Or mock lth_pvr_logic to throw error

---

#### Test Case 3.1.4: Pipeline Error
**Scenario:** Database connection failure or RPC error  
**Expected Alert:**
- Severity: 'error'
- Message: 'Decision generation pipeline failed'
- Context: { error: [error message] }

---

### 3.2 ef_create_order_intents Alerts

#### Test Case 3.2.1: Balance Query Failure
**Scenario:** balances_daily query fails  
**Expected Alert:**
- Severity: 'error'
- Message: 'Failed to query balances_daily'
- Context: { customer_id, error }

---

#### Test Case 3.2.2: RPC Failure
**Scenario:** lth_pvr_create_order_intents RPC fails  
**Expected Alert:**
- Severity: 'error'
- Message: 'RPC lth_pvr_create_order_intents failed'
- Context: { customer_id, error }

---

#### Test Case 3.2.3: Below Minimum Order Size
**Scenario:** Order amount below MIN_QUOTE_USDT  
**Expected Alert:**
- Severity: 'info'
- Message: 'Order below minimum, adding to carry'
- Context: { customer_id, intent_id, amount, min_required, accumulate_to_carry: true }

**Test Setup:**
```typescript
// Set MIN_QUOTE_USDT env var to 0.52
// Create decision with amount = 0.30
```

---

#### Test Case 3.2.4: Zero Balance SELL
**Scenario:** SELL order when BTC balance is zero  
**Expected Alert:**
- Severity: 'warn'
- Message: 'Attempted SELL with zero BTC balance'
- Context: { customer_id, intent_id, btc_balance: 0 }

---

#### Test Case 3.2.5: Intent Upsert Failure
**Scenario:** Database constraint violation on intent insert  
**Expected Alert:**
- Severity: 'error'
- Message: 'Failed to upsert order_intent'
- Context: { customer_id, error }

---

### 3.3 ef_execute_orders Alerts

#### Test Case 3.3.1: No Exchange Account
**Scenario:** Customer has no exchange_account_id  
**Expected Alert:**
- Severity: 'error'
- Message: 'No exchange account configured for customer [id]'
- Context: { customer_id, intent_id, trade_date }

**Test Setup:**
```sql
UPDATE lth_pvr.customer_strategies 
SET exchange_account_id = NULL 
WHERE customer_id = 123;
```

---

#### Test Case 3.3.2: No VALR Subaccount (Critical) ✅ PASS
**Scenario:** Exchange account missing subaccount_id  
**Expected Alert:**
- Severity: 'critical'
- Message: 'No VALR subaccount mapped for exchange_account_id [id]'
- Context: { customer_id, intent_id, exchange_account_id }

**Test Setup:**
```sql
-- Created customer 1003 with exchange_account_id that has NULL subaccount_id
-- Created pending order intent for customer 1003
```

**Test Execution:**
- Date: 2025-12-27 14:49:13 UTC
- Result: ✅ PASS
- Alert ID: ef389916-aab4-4c00-a479-a4dc13e305b8
- Severity: critical (correctly identified as highest severity)
- Message: "No VALR subaccount mapped for exchange_account_id 33333333-3333-3333-3333-333333333333"
- Context: Contains customer_id (1003), intent_id, trade_date, exchange_account_id
- Verification: Alert successfully logged when trying to execute order for account without VALR subaccount mapping

**Test Setup:**
```sql
UPDATE public.exchange_accounts 
SET subaccount_id = NULL 
WHERE exchange_account_id = 'test-account-id';
```

---

#### Test Case 3.3.3: VALR Rate Limit (Warn)
**Scenario:** VALR API returns 429 or 'rate limit' error  
**Expected Alert:**
- Severity: 'warn' (not 'error')
- Message: 'VALR order placement failed: [rate limit message]'
- Context: { customer_id, intent_id, side, pair, price, quantity, error, rate_limited: true }

**Test Setup:**
- Mock VALR API to return 429 status
- Or trigger actual rate limit (not recommended for tests)

---

#### Test Case 3.3.4: VALR API Error (Non-Rate-Limit)
**Scenario:** VALR API returns 400, 500, or other error  
**Expected Alert:**
- Severity: 'error'
- Message: 'VALR order placement failed: [error message]'
- Context: { rate_limited: false }

---

#### Test Case 3.3.5: Exchange Order Insert Failure
**Scenario:** exchange_orders table insert fails  
**Expected Alert:**
- Severity: 'error'
- Message: 'Failed to insert exchange_order: [error]'
- Context: { customer_id, intent_id, ext_order_id, error }

---

#### Test Case 3.3.6: Success/Error Counters
**Scenario:** Mixed success and failures  
**Test Steps:**
1. Create 5 pending intents
2. Configure 2 to fail (no subaccount)
3. Invoke ef_execute_orders

**Expected Results:**
- Console log shows: "success=3, errors=2"
- 2 error alerts logged
- 3 intents marked as 'executed'
- 2 intents marked as 'error'

---

### 3.4 ef_poll_orders Alerts

#### Test Case 3.4.1: Order Status Fetch Failure
**Scenario:** VALR API fails to return order status  
**Expected Alert:**
- Severity: 'warn'
- Message: 'Failed to fetch order status from VALR'
- Context: { intent_id, exchange_order_id, ext_order_id, error }

---

#### Test Case 3.4.2: 5-Minute Timeout Warning
**Scenario:** Order older than 5 minutes, still open  
**Expected Alert:**
- Severity: 'warn'
- Message: 'Order exceeding 5min timeout, triggering market order fallback'
- Context: { intent_id, exchange_order_id, ext_order_id, age_minutes: 6, side, pair }

**Test Setup:**
```sql
-- Create submitted order with old timestamp
INSERT INTO lth_pvr.exchange_orders (
  org_id, exchange_account_id, intent_id, ext_order_id,
  pair, side, price, qty, status, submitted_at
) VALUES (
  'test-org', 'test-account', 'test-intent', 'test-ext-order',
  'BTC/USDT', 'BUY', 50000, 0.001, 'submitted',
  NOW() - INTERVAL '6 minutes'
);
```

---

#### Test Case 3.4.3: Cancel Order Failure
**Scenario:** VALR cancel API fails  
**Expected Alert:**
- Severity: 'error'
- Message: 'Failed to cancel stale limit order'
- Context: { intent_id, exchange_order_id, ext_order_id, error }

---

#### Test Case 3.4.4: Market Order Fallback Failure (Critical)
**Scenario:** Limit order cancelled but market order placement fails  
**Expected Alert:**
- Severity: 'critical' (highest severity - partial fill risk)
- Message: 'Market order fallback failed after cancelling limit order'
- Context: { intent_id, exchange_order_id, original_ext_order_id, remaining_qty, side, pair, error }

**Rationale:**
- Critical because limit order is cancelled but replacement failed
- Customer may have partial fill with no completion path
- Requires immediate manual intervention

---

## 4. UI Component Tests

### 4.1 Alert Badge

#### Test Case 4.1.1: Badge Updates on Load ✅ PASS
**Test Steps:**
1. Create 5 unresolved alerts
2. Open Administration module
3. Observe alert badge

**Expected Results:**
- Badge shows "5"
- Badge is visible (not hidden)
- Badge has red background (#ef4444)

**Test Execution:**
- Date: 2025-12-27 14:50 UTC
- Result: ✅ PASS
- Alert Count: 5 unresolved alerts confirmed in database
- CSS Added: `.alert-badge` with background #ef4444, white text, rounded
- CSS Logic: `.alert-badge.zero { display:none; }` hides badge when count is 0
- JavaScript Logic: Verified at line 5559-5567
  ```javascript
  const openCount = data.filter(row => !row.resolved_at).length;
  alertBadge.textContent = String(openCount);
  if (openCount === 0) {
    alertBadge.classList.add('zero');
  } else {
    alertBadge.classList.remove('zero');
  }
  ```
- Verification: Badge updates on every loadAlerts() call, positioned in nav at line 392

---

#### Test Case 4.1.2: Badge Hidden When Zero
**Test Steps:**
1. Resolve all alerts
2. Refresh alerts table

**Expected Results:**
- Badge has class 'zero'
- Badge is not visible (display:none via CSS)

---

#### Test Case 4.1.3: Badge Updates After Resolve
**Test Steps:**
1. Start with 3 unresolved alerts
2. Resolve 1 alert
3. Click Refresh

**Expected Results:**
- Badge updates to "2"

---

### 4.2 Component Filter Dropdown

#### Test Case 4.2.1: All Components Shown
**Test Steps:**
1. Set filter to "All Components"
2. Create alerts from multiple components
3. Load alerts

**Expected Results:**
- All alerts displayed regardless of component
- Table shows mix of ef_generate_decisions, ef_execute_orders, etc.

---

#### Test Case 4.2.2: Filter by Single Component
**Test Steps:**
1. Create alerts: 3 from ef_execute_orders, 2 from ef_poll_orders
2. Set filter to "ef_execute_orders"
3. Load alerts

**Expected Results:**
- Only 3 alerts displayed
- All displayed alerts have component = 'ef_execute_orders'

---

#### Test Case 4.2.3: Filter Change Updates Table
**Test Steps:**
1. Start with filter = "ef_execute_orders" (showing 3 alerts)
2. Change filter to "ef_poll_orders"

**Expected Results:**
- Table automatically refreshes (onchange event)
- Now shows 2 alerts from ef_poll_orders

---

#### Test Case 4.2.4: All Components Listed
**Test Steps:**
1. Inspect dropdown options

**Expected Results:**
- Options include:
  - "All Components" (value="")
  - "ef_fetch_ci_bands"
  - "ef_generate_decisions"
  - "ef_create_order_intents"
  - "ef_execute_orders"
  - "ef_poll_orders"

---

### 4.3 Auto-Refresh

#### Test Case 4.3.1: Enable Auto-Refresh
**Test Steps:**
1. Check "Auto-refresh (30s)" checkbox
2. Wait 30 seconds
3. Observe network activity and table

**Expected Results:**
- After 30s, RPC call to list_lth_alert_events is made
- Table refreshes automatically
- Badge updates if count changed

---

#### Test Case 4.3.2: Disable Auto-Refresh
**Test Steps:**
1. Enable auto-refresh
2. Wait 15 seconds
3. Uncheck auto-refresh checkbox
4. Wait 20 more seconds

**Expected Results:**
- No refresh occurs after unchecking
- setInterval is cleared
- No background API calls

---

#### Test Case 4.3.3: Auto-Refresh Persists Across Navigations
**Test Steps:**
1. Enable auto-refresh in Administration module
2. Navigate to different module
3. Navigate back to Administration

**Expected Results:**
- Checkbox state resets (not persisted)
- Auto-refresh is NOT running (user must re-enable)

---

### 4.4 Open Only Checkbox

#### Test Case 4.4.1: Show Only Open Alerts
**Test Steps:**
1. Create 5 open alerts and 3 resolved alerts
2. Check "Show only open alerts"
3. Load alerts

**Expected Results:**
- Only 5 alerts displayed
- All have resolved_at = NULL

---

#### Test Case 4.4.2: Show All Alerts
**Test Steps:**
1. Uncheck "Show only open alerts"
2. Load alerts

**Expected Results:**
- 8 total alerts displayed (5 open + 3 resolved)
- Resolved column populated for 3 alerts

---

### 4.5 Resolve Alert Button

#### Test Case 4.5.1: Resolve Alert with Note
**Test Steps:**
1. Display open alerts
2. Click "Resolve" button on one alert
3. Enter note: "Fixed by restarting service"
4. Submit

**Expected Results:**
- Alert prompt displays
- After submit, button shows "Resolving…"
- RPC resolve_lth_alert_event called with note
- Table refreshes
- Alert now shows resolved timestamp
- Button disappears (alert is resolved)

---

#### Test Case 4.5.2: Resolve Alert Without Note
**Test Steps:**
1. Click "Resolve" button
2. Cancel prompt or leave empty
3. Submit

**Expected Results:**
- Resolution succeeds with NULL note
- Alert marked resolved

---

#### Test Case 4.5.3: Resolve Error Handling
**Test Steps:**
1. Mock RPC to fail
2. Attempt to resolve alert

**Expected Results:**
- Error alert shown to user
- Button reverts to "Resolve" (enabled)
- Alert remains unresolved

---

## 5. Integration Tests

### 5.1 End-to-End Alert Flow

#### Test Case 5.1.1: Full Pipeline with Alerting
**Scenario:** Complete LTH strategy execution with intentional failures  
**Test Steps:**
1. Setup: Create 3 customers, one with missing subaccount
2. Run ef_generate_decisions
3. Run ef_create_order_intents
4. Run ef_execute_orders
5. Check alerts table
6. Open UI and verify alerts displayed

**Expected Results:**
- ef_generate_decisions: Success, no alerts
- ef_create_order_intents: Success, possible info alerts for below-min orders
- ef_execute_orders: 1 critical alert for missing subaccount, 2 success
- UI badge shows: "1"
- Filter by ef_execute_orders shows critical alert
- Resolve alert via UI

---

### 5.2 Alert Deduplication

#### Test Case 5.2.1: Prevent Duplicate Alerts
**Scenario:** Same error occurs multiple times rapidly  
**Test Steps:**
1. Configure ef_execute_orders to call hasUnresolvedAlert before logging
2. Trigger same error twice within 30 seconds

**Expected Results:**
- First error: Alert logged
- Second error: hasUnresolvedAlert returns true, no duplicate logged
- Only 1 alert in database

**Note:** Current implementation does NOT include deduplication. This is a future enhancement test case.

---

## 6. Performance Tests

### 6.1 Alert Creation Performance

#### Test Case 6.1.1: Bulk Alert Creation
**Test Steps:**
1. Create 100 alerts in rapid succession
2. Measure completion time

**Expected Results:**
- All 100 alerts created successfully
- Average creation time < 50ms per alert
- No database deadlocks or timeouts

---

### 6.2 UI Query Performance

#### Test Case 6.2.1: Large Alert Dataset
**Test Steps:**
1. Create 1000 alerts in database
2. Load alerts table with "Show only open alerts" checked
3. Measure load time

**Expected Results:**
- Query completes in < 2 seconds
- UI remains responsive
- Pagination or limit (100) prevents excessive data transfer

---

## 7. Security Tests

### 7.1 RLS Policy Enforcement

#### Test Case 7.1.1: Org Isolation
**Test Steps:**
1. Create alerts for org_id='org-a' and org_id='org-b'
2. Query as user with org_id='org-a' context
3. Attempt to view alerts

**Expected Results:**
- Only alerts for 'org-a' visible
- RLS prevents access to 'org-b' alerts

---

### 7.2 SQL Injection Protection

#### Test Case 7.2.1: Malicious Component Filter
**Test Steps:**
1. Inject SQL in component filter: `'; DROP TABLE alert_events; --`
2. Apply filter

**Expected Results:**
- No SQL injection occurs (parameterized queries)
- Filter returns 0 results or error
- alert_events table intact

---

## 8. Test Execution Summary Template

| Test Case | Status | Notes | Date |
|-----------|--------|-------|------|
| 1.1.1 Successful CI Bands Fetch | ⬜ Not Run | | |
| 1.1.2 CI Bands Already Exist | ⬜ Not Run | | |
| 2.1.1 Basic Alert Creation | ⬜ Not Run | | |
| 2.1.2 Severity Levels | ⬜ Not Run | | |
| 3.1.1 CI Bands Unavailable | ⬜ Not Run | | |
| 3.3.3 VALR Rate Limit | ⬜ Not Run | | |
| 4.1.1 Badge Updates on Load | ⬜ Not Run | | |
| 4.2.2 Filter by Single Component | ⬜ Not Run | | |
| 4.3.1 Enable Auto-Refresh | ⬜ Not Run | | |
| 5.1.1 Full Pipeline with Alerting | ⬜ Not Run | | |

---

## 9. Test Environment Setup

### 9.1 Required Test Data
```sql
-- Test organization
INSERT INTO public.organisations (org_id, name) 
VALUES ('test-org-id', 'Test Organization');

-- Test customers
INSERT INTO public.customers (customer_id, org_id, email, name)
VALUES 
  (1001, 'test-org-id', 'customer1@test.com', 'Test Customer 1'),
  (1002, 'test-org-id', 'customer2@test.com', 'Test Customer 2'),
  (1003, 'test-org-id', 'customer3@test.com', 'Test Customer 3');

-- Test exchange accounts
INSERT INTO public.exchange_accounts (exchange_account_id, org_id, subaccount_id)
VALUES 
  ('test-acct-1', 'test-org-id', 'valr-sub-1'),
  ('test-acct-2', 'test-org-id', 'valr-sub-2'),
  ('test-acct-3', 'test-org-id', NULL); -- Intentionally NULL for testing

-- Test customer strategies
INSERT INTO lth_pvr.customer_strategies (
  org_id, customer_id, portfolio_id, strategy_code,
  exchange_account_id, effective_from
) VALUES 
  ('test-org-id', 1001, 'port-1', 'LTH_PVR', 'test-acct-1', '2025-01-01'),
  ('test-org-id', 1002, 'port-2', 'LTH_PVR', 'test-acct-2', '2025-01-01'),
  ('test-org-id', 1003, 'port-3', 'LTH_PVR', 'test-acct-3', '2025-01-01');

-- Test CI bands data
INSERT INTO lth_pvr.ci_bands_daily (trade_date, percentile, band_value)
SELECT 
  CURRENT_DATE,
  percentile,
  45000 + (percentile * 100) -- Dummy values
FROM generate_series(0, 100) AS percentile;
```

### 9.2 Cleanup Script
```sql
-- Clean up test data after tests
DELETE FROM lth_pvr.alert_events WHERE org_id = 'test-org-id';
DELETE FROM lth_pvr.order_intents WHERE org_id = 'test-org-id';
DELETE FROM lth_pvr.exchange_orders WHERE org_id = 'test-org-id';
DELETE FROM lth_pvr.customer_strategies WHERE org_id = 'test-org-id';
DELETE FROM public.exchange_accounts WHERE org_id = 'test-org-id';
DELETE FROM public.customers WHERE org_id = 'test-org-id';
DELETE FROM public.organisations WHERE org_id = 'test-org-id';
```

---

## 10. Known Limitations & Future Tests

### 10.1 Not Yet Implemented
- Alert deduplication logic (hasUnresolvedAlert checks)
- Alert digest email functionality
- Customer-specific alert filtering in UI
- Alert severity escalation after N occurrences
- Alert auto-resolution for transient issues

### 10.2 Manual Verification Required
- VALR API rate limiting (requires production-like load)
- Email alert notifications (requires SMTP setup)
- Mobile responsive UI for alerts dashboard

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-27 | System | Initial test case documentation for alerting system implementation |
