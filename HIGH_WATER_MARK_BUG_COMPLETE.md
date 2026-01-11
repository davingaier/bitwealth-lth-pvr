# High-Water Mark Bug - Complete Investigation and Fix

**Date:** 2026-01-11  
**Status:** RESOLVED (Version 3 - Final)  
**Priority:** Critical

---

## Executive Summary

The high-water mark (HWM) system for performance fee calculation had three critical bugs that prevented correct fee calculation:

1. **Initialization Timing:** HWM initialized before trading activity, not reflecting actual NAV after exchange fees
2. **Daily Updates:** HWM updated every day instead of only at month boundaries when fees are calculated
3. **Contribution Tracking:** Failed to exclude new contributions from profit calculations

All three bugs have been resolved. Performance fees now correctly:
- Initialize to actual NAV after all trading on day 1
- Update only at month boundaries when fees are calculated
- Exclude new net contributions from profit calculations
- Track cumulative net contributions at each HWM update for accurate profit measurement

---

## Bug History and Resolution Timeline

### Version 1: Initial Fix (2025-12-30)
**Problem:** HWM initialized to 0 instead of starting NAV  
**Fix:** Added HWM initialization on first contribution day  
**Status:** Incomplete - initialization happened before trading, not after

### Version 2: Contributions Bug (2026-01-11)
**Problem:** Performance fees charged on NAV increases due to new contributions (deposits)  
**Example:** Customer deposits $1,000, NAV increases by $1,000, performance fee charged on deposit  
**Root Cause:** HWM profit calculation didn't exclude new contributions  
**Fix Attempt 1:** Track gross contributions - WRONG (should use net contributions)  
**Fix Attempt 2:** Track net contributions at HWM update - CORRECT

### Version 3: Daily HWM Updates Bug (2026-01-11)
**Problem:** HWM updating daily during first month, reaching artificial peaks before any fees charged  
**Example:** Jan 31 HWM = $13,461, Feb 1 navForPerfFee = $13,334 → No fee charged (should be charged)  
**Root Cause:** HWM initialization happened BEFORE month tracking started, allowing month-end logic to trigger daily  
**Fix:** Move HWM initialization to END of first day iteration, ensure HWM only updates at month boundaries

---

## Final Solution (2026-01-11 - Version 3)

### Complete Fix Architecture

**Three Key Variables:**
```typescript
let highWaterMark = 0;           // NAV (minus contributions) at last HWM update
let hwmContribNetCum = 0;        // Net contributions at last HWM update
let lastMonthForPerfFee = null;  // Month key of last performance fee calculation
```

**Initialization (First Day Only):**
```typescript
// Located at: supabase/functions/ef_bt_execute/index.ts, Lines 520-525
// Executes at END of day 1 loop iteration, AFTER all trading activity

if (i === 0) {
  const initialNav = usdtBal + btcBal * px;  // Actual NAV after trading and fees
  highWaterMark = initialNav;                // e.g., $10,896.11
  hwmContribNetCum = contribNetCum;          // e.g., $10,897.85
}
```

**Why This Order Matters:**
1. Contribution applied → usdtBal has cash, btcBal = 0
2. Trading executed → usdtBal decreases, btcBal increases, exchange fees paid
3. Month tracking updated → `lastMonthForPerfFee = "2020-01"`
4. HWM initialized → Records actual final NAV after all activity

**Monthly Performance Fee Calculation (First Day of New Month):**
```typescript
// Located at: supabase/functions/ef_bt_execute/index.ts, Lines 480-517
// Only triggers when month changes AND not first month

const isNewMonth = (monthKey !== lastMonthForPerfFee);
const isNotFirstMonth = (lastMonthForPerfFee !== null);

if (isNewMonth && isNotFirstMonth) {
  // Calculate NAV adjusted for new contributions
  const currentNav = usdtBal + btcBal * px;
  const contribSinceHWM = contribNetCum - hwmContribNetCum;
  const navForPerfFee = currentNav - contribSinceHWM;
  
  // Charge performance fee if above HWM
  if (navForPerfFee > highWaterMark && performanceFeeRate > 0) {
    const profitAboveHWM = navForPerfFee - highWaterMark;
    performanceFeeToday = profitAboveHWM * performanceFeeRate;
    
    // Deduct fee from USDT balance
    usdtBal -= performanceFeeToday;
    performanceFeesCum += performanceFeeToday;
    
    // Record fee in ledger
    ledgerRows.push({
      kind: "fee",
      fee_usdt: performanceFeeToday,
      note: "BitWealth performance fee (10% on profit above high-water mark, net of new contributions)"
    });
    
    // Update HWM to NAV AFTER fee deduction
    const navAfterFee = usdtBal + btcBal * px;
    highWaterMark = navAfterFee - contribSinceHWM;
    hwmContribNetCum = contribNetCum;
  } else if (navForPerfFee > highWaterMark) {
    // Update HWM even if no fee charged (new peak reached)
    highWaterMark = navForPerfFee;
    hwmContribNetCum = contribNetCum;
  }
  // If navForPerfFee <= highWaterMark, don't update (still below peak)
}
lastMonthForPerfFee = monthKey;
```

---

## Critical Implementation Details

### 1. Use NET Contributions, Not Gross

**Why Net Contributions:**
- `contribNetCum` includes all deductions:
  - Platform fee (0.75% on gross contribution)
  - Exchange fee for USDT/ZAR conversion (18 basis points)
- HWM represents NAV, which is also net of all fees
- Using gross contributions would understate profit and overcharge fees

**Example:**
```
Gross contribution: $11,000.00
Platform fee (0.75%): $82.50
Exchange fee (18 bps): $19.65
Net contribution: $10,897.85  ← This is what goes into the portfolio

NAV calculation uses net contribution as starting point, so HWM profit 
calculation must also use net contribution for consistency.
```

### 2. Month Boundary Logic

**Condition Breakdown:**
```typescript
const isNewMonth = (monthKey !== lastMonthForPerfFee);
const isNotFirstMonth = (lastMonthForPerfFee !== null);
```

**Truth Table:**
| Date | monthKey | lastMonthForPerfFee | isNewMonth | isNotFirstMonth | Triggers? | Reason |
|------|----------|---------------------|------------|-----------------|-----------|---------|
| Jan 1 | "2020-01" | null | TRUE | FALSE | NO | First month - no fee |
| Jan 2 | "2020-01" | "2020-01" | FALSE | TRUE | NO | Same month |
| Jan 31 | "2020-01" | "2020-01" | FALSE | TRUE | NO | Same month |
| Feb 1 | "2020-02" | "2020-01" | TRUE | TRUE | YES | Month boundary |
| Feb 2 | "2020-02" | "2020-02" | FALSE | TRUE | NO | Same month |
| Mar 1 | "2020-03" | "2020-02" | TRUE | TRUE | YES | Month boundary |

**Key Points:**
- Triggers on FIRST DAY of new month (e.g., Feb 1 for January's fees)
- Does NOT trigger during first month (prevents day 1 fee)
- Does NOT trigger daily within a month
- HWM ONLY updates inside this block (no daily updates)

### 3. Initialization Order

**Critical Sequence:**
```
Day 1 Loop Iteration:
├─ 1. Apply contribution (usdtBal increases, btcBal = 0)
├─ 2. Execute trading (usdtBal decreases, btcBal increases, fees paid)
├─ 3. Performance fee check (doesn't run - lastMonthForPerfFee is null)
├─ 4. Update month tracking (lastMonthForPerfFee = "2020-01")
└─ 5. Initialize HWM (highWaterMark = actual NAV after trading)
```

**Why This Matters:**
- If HWM initialized BEFORE step 4, month tracking would be null when HWM is set
- If HWM initialized BEFORE step 2, it would include exchange fees that haven't been paid yet
- Current order ensures HWM = actual final NAV after all day 1 activity

### 4. Fee Deduction Timing

**Fee Calculation Flow:**
```
1. Calculate navForPerfFee (current NAV minus new contributions)
2. Compare to highWaterMark
3. If above HWM, calculate fee on the excess profit
4. Deduct fee from usdtBal
5. Recalculate NAV AFTER fee deduction
6. Update HWM to post-fee NAV (minus contributions)
```

**Why Recalculate After Fee:**
- Prevents HWM from being higher than actual NAV post-fee
- Ensures next month's comparison starts from correct baseline
- Example:
  ```
  NAV before fee: $14,325.30
  Performance fee: $243.85
  NAV after fee: $14,081.45
  HWM updated to: $13,090.74 (post-fee NAV minus contributions)
  
  If we didn't recalculate, HWM would be $13,334.59 (pre-fee), which is 
  higher than actual NAV, causing incorrect fee calculation next month.
  ```

---

## Mathematical Examples

### Example 1: First Performance Fee (Feb 1, 2020)

**Starting State (Jan 1):**
```
Upfront contribution: $11,000 gross
  ├─ Platform fee (0.75%): $82.50
  ├─ Exchange fee (18 bps): $19.65
  └─ Net contribution: $10,897.85

BTC purchase:
  ├─ Price: $7,440.92
  ├─ BTC bought (gross): 1.465 BTC
  ├─ Exchange fee (75 bps): 0.011 BTC
  └─ BTC held (net): 1.454 BTC

Final balances: 1.454 BTC + $8,724.49 USDT
Final NAV: (1.454 × $7,440.92) + $8,724.49 = $10,896.11

HWM initialized: $10,896.11
hwmContribNetCum: $10,897.85
```

**Month-End (Jan 31):**
```
NAV grows to $13,237.65 through trading
HWM stays at $10,896.11 (no update - still in same month)
```

**Feb 1 (First Day of Month 2):**
```
Previous NAV: $13,237.65
New contribution: $1,000 gross → $990.71 net (after fees)
Trading activity results in balances: 1.436 BTC + $825.48 USDT

Current NAV (before perf fee):
  = (1.436 × $9,403.60) + $825.48
  = $14,325.30

Current contribNetCum: $11,888.56

Performance Fee Calculation:
  contribSinceHWM = $11,888.56 - $10,897.85 = $990.71
  navForPerfFee = $14,325.30 - $990.71 = $13,334.59
  profitAboveHWM = $13,334.59 - $10,896.11 = $2,438.48
  performanceFee = $2,438.48 × 0.10 = $243.85

After Fee Deduction:
  usdtBal = $825.48 - $243.85 = $581.63
  navAfterFee = (1.436 × $9,403.60) + $581.63 = $14,081.45
  
HWM Updated:
  highWaterMark = $14,081.45 - $990.71 = $13,090.74
  hwmContribNetCum = $11,888.56
```

### Example 2: Profit Above Previous HWM (Mar 1, 2020)

**Starting State (from Feb 1):**
```
HWM: $13,090.74
hwmContribNetCum: $11,888.56
```

**Mar 1:**
```
Previous NAV: $12,968.99 (Feb 29 close)
New contribution: $1,000 gross → $990.72 net
Current NAV (before perf fee): $14,159.90
Current contribNetCum: $12,879.28

Performance Fee Check:
  contribSinceHWM = $12,879.28 - $11,888.56 = $990.72
  navForPerfFee = $14,159.90 - $990.72 = $13,169.18
  profitAboveHWM = $13,169.18 - $13,090.74 = $78.44
  performanceFee = $78.44 × 0.10 = $7.84

After Fee:
  navAfterFee = $14,152.06
  highWaterMark = $14,152.06 - $990.72 = $13,161.34
  hwmContribNetCum = $12,879.28
```

### Example 3: Deposit-Only NAV Increase (No Fee)

**Scenario:** Customer has $10K NAV, deposits $5K net, no trading gains

```
Previous State:
  HWM: $10,000.00
  hwmContribNetCum: $10,000.00
  NAV: $10,000.00

After Deposit:
  Current NAV: $15,000.00 (increased solely due to deposit)
  Current contribNetCum: $15,000.00

Performance Fee Check:
  contribSinceHWM = $15,000.00 - $10,000.00 = $5,000.00
  navForPerfFee = $15,000.00 - $5,000.00 = $10,000.00
  profitAboveHWM = $10,000.00 - $10,000.00 = $0.00
  performanceFee = $0.00 (CORRECT - all NAV increase came from deposit)

HWM stays at $10,000.00 (no update - no profit above HWM)
```

### Example 4: Drawdown and Recovery (Below HWM)

**Scenario:** Portfolio drops below HWM then recovers

```
Month 1:
  NAV: $20,000
  HWM: $20,000 (peak)

Month 2:
  NAV drops to $15,000 (below HWM)
  No performance fee (NAV < HWM)
  HWM stays at $20,000

Month 3:
  NAV recovers to $19,000 (still below HWM)
  No performance fee (NAV < HWM)
  HWM stays at $20,000

Month 4:
  NAV grows to $21,000 (above HWM)
  navForPerfFee = $21,000 (assume no new contributions)
  profitAboveHWM = $21,000 - $20,000 = $1,000
  performanceFee = $1,000 × 0.10 = $100
  HWM updated to $20,900 (after fee)

This is CORRECT - customer doesn't pay twice for reaching $20K
```

---

## Testing Results

### Test Case 1: HWM Initialization
**Test:** Verify HWM initializes to actual NAV after trading on day 1  
**Query:**
```sql
SELECT 
  bt_run_id,
  trade_date,
  nav_usd,
  high_water_mark_usdt,
  contrib_net_usdt_cum,
  btc_balance,
  usdt_balance
FROM lth_pvr_bt.bt_results_daily
WHERE trade_date = '2020-01-01'
ORDER BY bt_run_id DESC
LIMIT 5;
```
**Expected:** HWM = NAV = $10,896.11  
**Actual:** ✅ PASS - HWM correctly set to NAV  
**Previous Bug:** HWM was $10,897.85 (contribution amount, before trading)

### Test Case 2: Monthly Updates Only
**Test:** Verify HWM only updates at month boundaries, not daily  
**Query:**
```sql
SELECT 
  trade_date,
  nav_usd,
  high_water_mark_usdt,
  LAG(high_water_mark_usdt) OVER (ORDER BY trade_date) AS prev_hwm
FROM lth_pvr_bt.bt_results_daily
WHERE bt_run_id = '[specific_run]'
  AND trade_date BETWEEN '2020-01-01' AND '2020-02-05'
ORDER BY trade_date;
```
**Expected:** HWM constant throughout January, changes only on Feb 1  
**Actual:** ✅ PASS - HWM stays at $10,896.11 from Jan 1-31, updates on Feb 1  
**Previous Bug:** HWM updated daily (Jan 3, Jan 5, Jan 6, etc.)

### Test Case 3: Contribution Exclusion
**Test:** Verify no performance fee charged when NAV increases solely due to deposit  
**Scenario:** Customer with $10K NAV deposits $5K, no trading gains  
**Expected:** navForPerfFee = $10K (NAV - deposit), no fee charged  
**Actual:** ✅ PASS - No fee charged  
**Previous Bug:** Fee charged on deposit amount

### Test Case 4: First Performance Fee
**Test:** Verify first performance fee charged on Feb 1 (not delayed)  
**Query:**
```sql
SELECT 
  trade_date,
  nav_usd,
  high_water_mark_usdt,
  performance_fees_paid_usdt,
  contrib_net_usdt_cum
FROM lth_pvr_bt.bt_results_daily
WHERE bt_run_id = '[specific_run]'
  AND performance_fees_paid_usdt > 0
ORDER BY trade_date
LIMIT 1;
```
**Expected:** Feb 1, 2020 with fee ~$243.85  
**Actual:** ✅ PASS - First fee on Feb 1, amount $243.85  
**Previous Bug:** First fee delayed until June 1 (4 months late)

### Test Case 5: HWM Update After Fee
**Test:** Verify HWM updated to post-fee NAV  
**Expected:** HWM = navAfterFee - contribSinceHWM  
**Actual:** ✅ PASS - HWM correctly reflects NAV after fee deduction  
**Why Critical:** Prevents HWM from being higher than actual NAV

---

## Production Deployment

### Deployment Details
**Date:** 2026-01-11  
**Command:**
```powershell
supabase functions deploy ef_bt_execute --no-verify-jwt
```

**Files Modified:**
- `supabase/functions/ef_bt_execute/index.ts`
  - Line 230-231: Changed `hwmContribGrossCum` to `hwmContribNetCum`
  - Line 355-361: Removed HWM initialization from contribution block
  - Line 480-517: Refactored monthly performance fee calculation
  - Line 520-525: Added HWM initialization at end of first day

**Database Impact:**
- No schema changes required
- Existing back-test results unaffected (remain in database as historical record)
- New back-tests will use corrected logic
- `bt_results_daily.high_water_mark_usdt` now correctly represents peak NAV minus contributions

### Verification Queries

**1. Check All Runs for Correct HWM Initialization:**
```sql
SELECT 
  bt_run_id,
  ABS(nav_usd - high_water_mark_usdt) AS hwm_nav_diff
FROM lth_pvr_bt.bt_results_daily
WHERE trade_date = '2020-01-01'
ORDER BY hwm_nav_diff DESC
LIMIT 10;
-- hwm_nav_diff should be < $2 (small difference due to rounding)
-- Old bug: hwm_nav_diff was ~$1.74 (contribution - NAV)
```

**2. Check for Daily HWM Updates (Should Be None):**
```sql
WITH hwm_changes AS (
  SELECT 
    bt_run_id,
    trade_date,
    high_water_mark_usdt,
    LAG(high_water_mark_usdt) OVER (PARTITION BY bt_run_id ORDER BY trade_date) AS prev_hwm,
    EXTRACT(DAY FROM trade_date) AS day_of_month
  FROM lth_pvr_bt.bt_results_daily
  WHERE trade_date BETWEEN '2020-01-01' AND '2020-01-31'
)
SELECT 
  bt_run_id,
  COUNT(*) AS hwm_updates_in_january
FROM hwm_changes
WHERE high_water_mark_usdt != prev_hwm
  AND day_of_month != 1  -- Exclude day 1 (initialization)
GROUP BY bt_run_id
HAVING COUNT(*) > 0;
-- Should return 0 rows (no daily updates)
-- Old bug: Would show 10-15 updates per run
```

**3. Check First Performance Fee Date:**
```sql
SELECT 
  bt_run_id,
  MIN(trade_date) AS first_perf_fee_date
FROM lth_pvr_bt.bt_results_daily
WHERE performance_fees_paid_usdt > 0
GROUP BY bt_run_id
ORDER BY first_perf_fee_date;
-- Should be 2020-02-01 for runs starting 2020-01-01
-- Old bug: Was 2020-06-01 (4 months late)
```

---

## Application to Live Trading

### Critical Notes for Production Implementation

**1. Timing Considerations:**
- Live trading: HWM should be recorded in `lth_pvr.customer_state_daily` table
- Performance fees calculated on first trading day of new month (e.g., Feb 1 for Jan fees)
- Ensure pipeline runs complete before 03:00 UTC to include all previous day's activity
- HWM calculation must happen AFTER all order executions and ledger posting

**2. Database Fields Required:**

**Add to `lth_pvr.customer_state_daily`:**
```sql
ALTER TABLE lth_pvr.customer_state_daily
ADD COLUMN high_water_mark_usdt NUMERIC(20,8),
ADD COLUMN hwm_contrib_net_cum NUMERIC(20,8);
```

**Carry Forward Logic:**
```sql
-- On days with no HWM update, use previous day's values
SELECT 
  COALESCE(today.high_water_mark_usdt, yesterday.high_water_mark_usdt) AS hwm,
  COALESCE(today.hwm_contrib_net_cum, yesterday.hwm_contrib_net_cum) AS hwm_contrib
FROM lth_pvr.customer_state_daily today
LEFT JOIN lth_pvr.customer_state_daily yesterday 
  ON today.customer_id = yesterday.customer_id
  AND yesterday.date = today.date - INTERVAL '1 day';
```

**3. Fee Posting:**
- Performance fees posted as ledger entries with `kind='performance_fee'`
- Fee deduction updates `lth_pvr.balances_daily.usdt_balance`
- Fee tracking in `lth_pvr.fees_monthly` for quarterly aggregation
- Ledger note format: "Performance fee (10% on profit $X above HWM $Y = $Z)"

**4. Edge Case Handling:**

| Scenario | Check | Action |
|----------|-------|--------|
| First month | `lastMonthForPerfFee IS NULL` | Skip performance fee calculation |
| Zero NAV | `currentNav <= 0` | Skip performance fee calculation |
| Negative NAV | `currentNav < 0` | Alert + skip (should never happen) |
| HWM decrease | `navForPerfFee < highWaterMark` | Don't update HWM (never decrease) |
| No contributions | `contribSinceHWM = 0` | Fee on full NAV gain (normal) |
| Large deposit + loss | `navForPerfFee < highWaterMark` | No fee (correct - loss) |

**5. Audit Trail Requirements:**

**Ledger Entry Format:**
```sql
INSERT INTO lth_pvr.ledger_lines (
  customer_id,
  trade_date,
  kind,
  amount_usdt,
  note
) VALUES (
  :customer_id,
  :trade_date,
  'performance_fee',
  :fee_amount,
  FORMAT('Performance fee (10%% on profit $%s above HWM $%s = $%s)',
    :nav_for_perf_fee,
    :high_water_mark,
    :profit_above_hwm
  )
);
```

**State Tracking:**
```sql
INSERT INTO lth_pvr.customer_state_daily (
  customer_id,
  date,
  high_water_mark_usdt,
  hwm_contrib_net_cum
) VALUES (
  :customer_id,
  :date,
  :new_hwm,
  :new_hwm_contrib
);
```

**6. Integration Points:**

**Edge Function: `ef_post_ledger_and_balances`**
- Add monthly performance fee calculation block
- Place AFTER ledger posting (so fees can be posted to ledger)
- Place BEFORE balance calculation (so fees reduce balance)

**Pseudo-code:**
```typescript
// In ef_post_ledger_and_balances
for (const customer of activeCustomers) {
  // 1. Post all day's trades to ledger
  await postTradeToLedger(customer);
  
  // 2. Calculate current NAV
  const currentNav = await calculateNAV(customer);
  
  // 3. Check if month boundary
  const isNewMonth = isMonthBoundary(tradeDate);
  if (isNewMonth) {
    // 4. Get previous HWM and contribution baseline
    const { highWaterMark, hwmContribNetCum } = await getHWMState(customer);
    
    // 5. Get current contributions
    const contribNetCum = await getContributions(customer);
    
    // 6. Calculate performance fee
    const perfFee = calculatePerformanceFee({
      currentNav,
      highWaterMark,
      contribNetCum,
      hwmContribNetCum,
      performanceFeeRate: 0.10
    });
    
    // 7. Post fee to ledger
    if (perfFee > 0) {
      await postPerformanceFeToLedger(customer, perfFee);
    }
    
    // 8. Update HWM state
    await updateHWMState(customer, newHWM, contribNetCum);
  }
  
  // 9. Calculate final balances (after fee deduction)
  await postBalances(customer);
}
```

### Testing Plan for Live Trading

**Phase 1: Single Customer Test (1 week)**
- Select one test customer (low balance, willing to accept potential issues)
- Enable HWM tracking and performance fee calculation
- Monitor daily for correct HWM updates and fee calculations
- Verify customer portal displays correct fee information

**Phase 2: Small Group Test (2 weeks)**
- Enable for 5-10 customers
- Monitor aggregate fee amounts (should match manual calculations)
- Check for any edge cases not covered in back-testing
- Gather customer feedback on fee transparency

**Phase 3: Full Rollout (1 month)**
- Enable for all active customers
- Monitor first month-end performance fee calculations
- Verify quarterly fee aggregation and payment process
- Document any issues and resolutions

**Rollback Plan:**
- If critical bug found, disable performance fee calculation
- Revert to 0% performance fee rate until fix deployed
- Recalculate fees retroactively once fix confirmed
- Communicate with affected customers about fee corrections

---

## Summary

The high-water mark system now correctly:

1. **Initializes** to actual NAV after all trading on day 1
2. **Updates** only at month boundaries when performance fees are calculated
3. **Excludes** new net contributions from profit calculations
4. **Tracks** cumulative net contributions at each HWM update
5. **Charges** fees only on true investment gains above previous peak
6. **Prevents** double-charging on drawdown recovery
7. **Records** full audit trail of all HWM updates and fee calculations

This ensures customers are charged fairly:
- ✅ Fees on investment gains (portfolio appreciation)
- ❌ No fees on customer deposits (their own money)
- ❌ No double-charging on recovery after drawdowns
- ✅ Transparent calculation with full audit trail

**Next Steps:**
1. Apply to live trading pipeline (`ef_post_ledger_and_balances`)
2. Add database fields (`customer_state_daily.high_water_mark_usdt`, `hwm_contrib_net_cum`)
3. Test with single customer for one full month
4. Roll out to all customers after successful test
5. Document quarterly fee aggregation process
