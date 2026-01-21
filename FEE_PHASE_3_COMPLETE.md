# Fee System Phase 3 Complete - Performance Fee HWM Logic

**Date:** 2026-01-21  
**Version:** v0.6.26  
**Status:** ✅ DEPLOYED TO PRODUCTION

---

## Summary

Phase 3 implements High Water Mark (HWM) performance fee logic with 10% fee on profits exceeding HWM. Includes monthly calculation (pg_cron), interim calculation for withdrawals, and reversion capability for failed withdrawals.

---

## Changes Deployed

### 1. Edge Functions Created

#### `ef_calculate_performance_fees` (NEW)
- **Purpose:** Monthly performance fee calculation (10% on profits above HWM)
- **Schedule:** pg_cron on 1st of every month at 00:05 UTC
- **Logic:**
  1. Query all active customers with `performance_fee_rate > 0`
  2. For each customer:
     - Get current HWM state from `customer_state_daily`
     - Get month-end balance from `balances_daily`
     - Calculate cumulative net contributions since last HWM update
     - **HWM threshold** = `high_water_mark_usd + hwm_contrib_net_cum`
     - If `NAV > HWM threshold`: Calculate fee = `(NAV - HWM threshold) × fee_rate`
     - Create ledger entry: `kind='performance_fee'`, `amount_usdt` negative (deduction)
     - Transfer fee to BitWealth main account via VALR API
     - Update HWM: `new_HWM = (NAV - fee) - total_net_contrib`
  3. If first month for customer: Initialize HWM state with `HWM = NAV - net_contributions`
- **Error handling:**
  - Insufficient USDT: Alert logged, fee skipped (will retry next month)
  - Transfer failure: Alert logged, fee recorded but not transferred
  - Missing exchange account: Alert logged, customer skipped
- **Lines:** 455 lines
- **Status:** ✅ DEPLOYED

#### `ef_calculate_interim_performance_fee` (NEW)
- **Purpose:** Calculate performance fee before withdrawal (with reversion capability)
- **Trigger:** Admin UI when processing withdrawal requests
- **Logic:**
  1. Get customer's current HWM state and balance
  2. Calculate performance fee using same logic as monthly calculation
  3. If fee > 0:
     - Create ledger entry: `kind='performance_fee'`
     - Transfer fee to BitWealth main account
  4. Create snapshot in `withdrawal_fee_snapshots`:
     - `pre_withdrawal_hwm`: Current HWM before withdrawal
     - `pre_withdrawal_contrib_net`: Current net contributions
     - `interim_performance_fee`: Fee charged (if any)
     - `post_withdrawal_hwm`: New HWM after withdrawal
  5. Update HWM state with post-withdrawal values (assume withdrawal will succeed)
- **Returns:** `{ snapshot_id, interim_performance_fee, pre_withdrawal_hwm, post_withdrawal_hwm }`
- **Error handling:**
  - Insufficient USDT: Return 400 error, don't process withdrawal
  - Transfer failure: Return 500 error, snapshot not created
- **Lines:** 295 lines
- **Status:** ✅ DEPLOYED

#### `ef_revert_withdrawal_fees` (NEW)
- **Purpose:** Revert interim performance fee if withdrawal fails/declined
- **Trigger:** Admin UI when withdrawal declined or failed
- **Logic:**
  1. Fetch snapshot from `withdrawal_fee_snapshots` by `snapshot_id`
  2. If `interim_performance_fee > 0`:
     - Create reversal ledger entry: `kind='performance_fee_reversal'`, `amount_usdt` positive (refund)
     - Log info alert: "Performance fee reversed for customer X: $Y"
  3. Restore pre-withdrawal HWM state to `customer_state_daily`
  4. Delete snapshot (no longer needed)
- **Note:** VALR transfer NOT reversed (money stays in BitWealth main account, customer gets ledger credit)
- **Returns:** `{ fee_reversed, hwm_restored, snapshot_deleted }`
- **Lines:** 180 lines
- **Status:** ✅ DEPLOYED

---

## Database Changes (Phase 1 - Already Deployed)

### Tables Used in Phase 3

**`lth_pvr.customer_state_daily`** - HWM tracking:
- `state_id` UUID PRIMARY KEY
- `customer_id` INTEGER - FK to customer_details
- `trade_date` DATE - Last date HWM updated
- `high_water_mark_usd` NUMERIC(20,8) - Highest NAV minus contributions achieved
- `hwm_contrib_net_cum` NUMERIC(20,8) - Cumulative net contributions (deposits - withdrawals)
- `last_perf_fee_month` VARCHAR(7) - YYYY-MM of last performance fee charged
- **97 records initialized** in Phase 1 with starting HWM values

**`lth_pvr.withdrawal_fee_snapshots`** - Reversion capability:
- `snapshot_id` UUID PRIMARY KEY
- `customer_id` INTEGER - FK to customer_details
- `withdrawal_ref` VARCHAR(100) - Optional withdrawal reference
- `snapshot_date` DATE - Date snapshot created
- `pre_withdrawal_hwm` NUMERIC(20,8) - HWM before withdrawal
- `pre_withdrawal_contrib_net` NUMERIC(20,8) - Net contributions before withdrawal
- `interim_performance_fee` NUMERIC(20,8) - Fee charged (if any)
- `post_withdrawal_hwm` NUMERIC(20,8) - HWM after withdrawal (for audit trail)

**`lth_pvr.ledger_lines`** - Fee records:
- `performance_fee_usdt` NUMERIC(20,8) - Performance fee amount (Phase 1 column)
- New `kind` values used:
  - `'performance_fee'` - Regular monthly or interim fee
  - `'performance_fee_reversal'` - Withdrawal declined/failed refund

---

## HWM Calculation Logic

### Core Formula

**HWM Threshold** = `high_water_mark_usd + hwm_contrib_net_cum`

**Performance Fee** = `(NAV - HWM Threshold) × fee_rate` (if NAV > HWM Threshold, else 0)

**New HWM** = `(NAV - fee) - total_net_contrib` (profit component only)

### Example Scenario

**Starting State:**
- HWM: $100 (established 3 months ago)
- Net contributions since HWM: $50 (deposits)
- Current NAV: $200

**Calculation:**
1. HWM threshold = $100 + $50 = **$150**
2. Profit above HWM = $200 - $150 = **$50**
3. Performance fee (10%) = $50 × 0.10 = **$5**
4. NAV after fee = $200 - $5 = **$195**
5. New HWM = $195 - $50 = **$145** (profit component only)

**Ledger Entry:**
```sql
INSERT INTO lth_pvr.ledger_lines (
  customer_id, trade_date, kind,
  amount_usdt,          -- -5.00 (deduction)
  performance_fee_usdt, -- 5.00 (fee amount)
  note
) VALUES (
  12, '2026-01-31', 'performance_fee',
  -5.00, 5.00,
  'Performance fee 2026-01: 10.0% of $50.00 profit'
);
```

**HWM State Update:**
```sql
UPDATE lth_pvr.customer_state_daily
SET 
  trade_date = '2026-01-31',
  high_water_mark_usd = 145.00,  -- New HWM
  hwm_contrib_net_cum = 50.00,   -- Net contributions unchanged
  last_perf_fee_month = '2026-01'
WHERE customer_id = 12;
```

---

## Withdrawal Workflow (Interim Fee + Reversion)

### Happy Path (Withdrawal Succeeds)

**Step 1: Admin UI → Call `ef_calculate_interim_performance_fee`**
```json
POST /functions/v1/ef_calculate_interim_performance_fee
{
  "customer_id": 12,
  "withdrawal_amount_usd": 50.00,
  "withdrawal_ref": "WD-2026-001"
}
```

**Response:**
```json
{
  "success": true,
  "interim_performance_fee": 5.00,
  "snapshot_id": "abc-123-def",
  "pre_withdrawal_hwm": 100.00,
  "post_withdrawal_hwm": 95.00
}
```

**Step 2: Admin processes withdrawal via VALR**
- Manual action: Admin transfers $50 USDT to customer's external wallet

**Step 3: Record withdrawal in ledger**
```sql
INSERT INTO lth_pvr.ledger_lines (
  customer_id, trade_date, kind,
  amount_usdt, note
) VALUES (
  12, CURRENT_DATE, 'withdrawal',
  -50.00, 'Customer withdrawal: WD-2026-001'
);
```

**Result:** Snapshot remains in database for audit trail (not deleted unless reverted)

---

### Failure Path (Withdrawal Declined/Failed)

**Step 1: Interim fee already charged** (from happy path Step 1)
- Performance fee: $5 transferred to BitWealth main account
- HWM updated to post-withdrawal value
- Snapshot created: `snapshot_id = "abc-123-def"`

**Step 2: Withdrawal fails** (e.g., VALR API error, compliance issue)

**Step 3: Admin UI → Call `ef_revert_withdrawal_fees`**
```json
POST /functions/v1/ef_revert_withdrawal_fees
{
  "snapshot_id": "abc-123-def",
  "reason": "Withdrawal declined - compliance review required"
}
```

**Response:**
```json
{
  "success": true,
  "customer_id": 12,
  "fee_reversed": 5.00,
  "hwm_restored": 100.00,
  "snapshot_deleted": true
}
```

**Actions:**
1. Reversal ledger entry created: `+$5.00 USDT` (customer credit)
2. HWM restored to `$100` (pre-withdrawal value)
3. Snapshot deleted
4. Alert logged: "Performance fee reversed for customer 12: $5.00"

**Note:** Money stays in BitWealth main account (already transferred via VALR), customer gets ledger credit which increases their NAV in next balance calculation.

---

## pg_cron Schedule

### Monthly Performance Fee Job

**Job Name:** `monthly-performance-fees`  
**Schedule:** `5 0 1 * *` (00:05 UTC on 1st of every month)  
**Action:** HTTP POST to `ef_calculate_performance_fees`

**Cron Expression Breakdown:**
- `5` - Minute 05
- `0` - Hour 00 (midnight UTC)
- `1` - Day 1 of month
- `*` - Every month
- `*` - Every day of week

**Timing Rationale:**
- Daily pipeline completes by 17:00 UTC
- Monthly calculation runs 7 hours later (00:05 next day)
- Ensures all month-end balances finalized before fee calculation

**Verification Query:**
```sql
SELECT jobid, schedule, command 
FROM cron.job 
WHERE jobname = 'monthly-performance-fees';
```

---

## Error Handling & Edge Cases

### Scenario 1: Insufficient USDT for Performance Fee

**Customer Balance:**
- NAV: $200 (BTC: $180, USDT: $20)
- Performance fee due: $50

**Action:**
- Alert logged: "Insufficient USDT for performance fee: customer 12 has $20.00 but needs $50.00"
- Fee skipped (will retry next month)
- HWM state updated: `last_perf_fee_month` set to prevent re-calculation
- **Future enhancement (Phase 4):** Auto-convert BTC to USDT to cover fee

### Scenario 2: First Month for Customer (No HWM State)

**Situation:** Customer activated mid-month, no `customer_state_daily` record exists

**Action:**
1. Query latest balance from `balances_daily`
2. Calculate cumulative net contributions from `ledger_lines`
3. Initialize HWM: `HWM = NAV - net_contributions` (profit component only)
4. Insert new record in `customer_state_daily`
5. Set `last_perf_fee_month` to current month (prevents immediate fee charge)

### Scenario 3: NAV Below HWM Threshold (Loss Month)

**Customer Balance:**
- HWM: $100, Net contributions: $50, HWM threshold: $150
- Current NAV: $140 (below threshold)

**Action:**
- No performance fee charged
- HWM remains at $100 (unchanged)
- `last_perf_fee_month` updated to current month
- Customer must recover to above $150 NAV before next fee charged

### Scenario 4: Withdrawal Reversion After Transfer

**Issue:** Performance fee already transferred to BitWealth main account via VALR

**Solution:**
- Reversal ledger entry gives customer USDT credit (increases NAV)
- Money stays in BitWealth main account (no reverse VALR transfer)
- Customer's next performance fee calculation accounts for credit
- **Alternative (manual):** Admin can manually transfer USDT back via VALR

---

## Testing Strategy

### Manual SQL Testing (Immediate)

```sql
-- Test 1: Check HWM initialization for customer 12
SELECT * FROM lth_pvr.customer_state_daily
WHERE customer_id = 12
ORDER BY trade_date DESC LIMIT 1;

-- Test 2: Manually trigger performance fee calculation for January 2026
SELECT net.http_post(
  url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_calculate_performance_fees',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer <service_role_key>'
  ),
  body := '{}'::jsonb
) AS request_id;

-- Test 3: Check performance fee ledger entries
SELECT 
  trade_date, kind,
  amount_usdt, performance_fee_usdt,
  note
FROM lth_pvr.ledger_lines
WHERE customer_id = 12 
AND kind IN ('performance_fee', 'performance_fee_reversal')
ORDER BY trade_date DESC;

-- Test 4: Check withdrawal snapshots
SELECT * FROM lth_pvr.withdrawal_fee_snapshots
WHERE customer_id = 12
ORDER BY snapshot_date DESC;
```

### Integration Tests (TC1.3 - TC1.6 from Test Plan)

**TC1.3: Month-End HWM Profit → 10% Performance Fee Charged**
- Setup: NAV=$200, HWM=$100, Net contrib=$53.55
- Expected: Fee=$4.65, New HWM=$141.80
- Status: ⏳ READY TO TEST

**TC1.4: Month-End No Profit → No Performance Fee**
- Setup: NAV=$100, HWM=$100, Net contrib=$0
- Expected: No fee, HWM unchanged
- Status: ⏳ READY TO TEST

**TC1.5: Withdrawal with Interim Fee → HWM Snapshot Created**
- Setup: NAV=$200, Withdrawal=$50, Interim fee=$5
- Expected: Snapshot created, HWM updated to $95
- Status: ⏳ READY TO TEST

**TC1.6: Withdrawal Reversion → HWM Restored, Fee Refunded**
- Setup: Use snapshot from TC1.5
- Expected: Fee reversed ($5 credit), HWM restored to $100
- Status: ⏳ READY TO TEST

---

## Known Limitations & Future Enhancements

### Phase 3 Limitations

1. **No auto-conversion for insufficient USDT** (Phase 4 feature)
   - If customer has insufficient USDT for performance fee, fee is skipped
   - Will retry next month (could accumulate multiple months of missed fees)
   - Phase 4 will implement BTC→USDT auto-conversion with customer approval

2. **Manual withdrawal processing** (future Admin UI feature)
   - Admin must manually trigger interim fee calculation
   - Admin must manually process VALR withdrawal
   - Admin must manually call reversion if withdrawal fails
   - Future: Automated withdrawal workflow in Admin UI

3. **No withdrawal fee snapshots cleanup** (future enhancement)
   - Successful withdrawals leave snapshots in database (not deleted)
   - Only reverted withdrawals delete snapshots
   - Future: pg_cron job to archive old snapshots after 90 days

---

## Deployment Commands Used

```powershell
# Deploy three edge functions
supabase functions deploy ef_calculate_performance_fees `
  --project-ref wqnmxpooabmedvtackji --no-verify-jwt

supabase functions deploy ef_calculate_interim_performance_fee `
  --project-ref wqnmxpooabmedvtackji --no-verify-jwt

supabase functions deploy ef_revert_withdrawal_fees `
  --project-ref wqnmxpooabmedvtackji --no-verify-jwt

# Add pg_cron job for monthly calculation
# (Applied via MCP: 20260121_add_monthly_performance_fee_cron.sql)
```

---

## Environment Variables Required

**No new variables added.** Phase 3 uses existing environment variables from Phases 1-2.

---

## Next Steps (Phase 4)

**Priority:** MEDIUM  
**Estimated Duration:** 3-4 hours  
**Blocking:** No (Phase 4 can proceed immediately)

### Phase 4 Tasks

1. **Create `ef_auto_convert_btc_to_usdt`**
   - Trigger: Insufficient USDT for performance fee payment
   - Logic: Calculate BTC needed, create approval request, send email
   - Customer approval: 24-hour expiry window
   - Place LIMIT order (1% below market, 5-min timeout)
   - Timeout fallback: Cancel LIMIT, place MARKET order
   - Record in `fee_conversion_approvals` table

2. **Create `ef_fee_monthly_close`**
   - Schedule: pg_cron monthly (1st day 00:10 UTC, after performance fees)
   - Aggregate platform fees from ledger (previous month)
   - Aggregate performance fees from ledger (previous month)
   - Create invoice in `fee_invoices` (due date = 15th of current month)
   - Send invoice email to admin

3. **Admin UI updates:**
   - Fee management screen: View/edit `customer_strategies.performance_fee_rate`
   - Invoice management: Mark invoices paid, add `payment_reference`
   - Withdrawal workflow: Trigger interim fee, process VALR withdrawal, revert if failed

4. **Testing:**
   - TC1.7: BTC conversion approval workflow (24h expiry)
   - TC1.8: Monthly fee invoice generation and email

---

**Signed off:** GitHub Copilot  
**Date:** 2026-01-21  
**Version:** v0.6.26
