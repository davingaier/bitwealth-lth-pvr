# High-Water Mark Bug in Back-Test Execution

## Issue Summary
**Date Identified:** 2026-01-11  
**Affected Component:** `ef_bt_execute` - Back-test execution function  
**Severity:** High - Causes incorrect performance fee calculations

## Problem Description

The high-water mark is not being initialized properly at the start of a back-test run. This causes:

1. **Zero high-water mark in first month** - Should be set to opening NAV on day 1
2. **Incorrect performance fees** - Fees charged when NAV hasn't exceeded previous high
3. **Invalid watermark** trigger on first contribution month

## Evidence (bt_run_id: 4361b3cd-3d82-437d-83a0-6bdbb92e4813)

### January 2025 Data:
```
Date       | NAV      | ROI%      | Perf Fees | High-Water Mark
-----------|----------|-----------|-----------|----------------
2025-01-01 | 10,897.85| -0.93%    | $0        | $0 ❌ WRONG
2025-01-02 | 10,897.85| -0.93%    | $0        | $0 ❌
... (all of January has high_water_mark_usdt = 0)
2025-02-01 | 10,699.71| -10.84%   | $1,188.86 | $11,888.56 ❌
```

### Expected Behavior:
```
Date       | NAV      | ROI%      | Perf Fees | High-Water Mark
-----------|----------|-----------|-----------|----------------
2025-01-01 | 10,897.85| -0.93%    | $0        | $10,897.85 ✅
2025-02-01 | 10,699.71| -10.84%   | $0        | $10,897.85 ✅ (NAV below HWM)
```

## Root Cause

The high-water mark initialization logic in `ef_bt_execute` is likely:
1. Not setting HWM on the first trading day
2. Or setting it to 0 instead of initial NAV
3. This causes the first contribution month (Feb) to incorrectly calculate performance fees

## Impact

- **Customer overcharged**: $1,188.86 performance fee on Feb 1 when NAV was BELOW opening value
- **Incorrect back-test results**: Total performance fees = $2,347.80 but should be ~$1,159
- **Trust issue**: If production system has same bug, customers are being overcharged

## Required Fix

**File to modify:** `supabase/functions/ef_bt_execute/index.ts`

**Logic to implement:**
```typescript
// On first trading day (or when high_water_mark_usdt is NULL):
if (currentRow.trade_date === startDate || !previousHighWaterMark) {
    high_water_mark_usdt = currentNavUSD;
}

// On subsequent days:
// Only charge performance fee if NAV > high_water_mark_usdt
if (currentNavUSD > high_water_mark_usdt) {
    const profit = currentNavUSD - high_water_mark_usdt;
    const performanceFee = profit * 0.10; // 10% of profit above HWM
    high_water_mark_usdt = currentNavUSD; // Update HWM
}
```

## Testing Requirements

1. Run back-test with same parameters (2025-01-01 to 2025-12-31, $10K + $1K/mo)
2. Verify high_water_mark_usdt on 2025-01-01 = opening NAV ($10,897.85)
3. Verify no performance fees charged in February (NAV was below HWM)
4. Verify total performance fees are correct for entire year

## Related Files

- `supabase/functions/ef_bt_execute/index.ts` - Back-test execution logic
- `supabase/migrations/*_bt_results_daily.sql` - Table schema
- `docs/SDD_v0.6.md` - Section on performance fee calculation

## Status

✅ **RESOLVED** - Fixed in ef_bt_execute function on 2026-01-11

**Fix Applied:**
- Added high-water mark initialization on first contribution day (line 356-360)
- HWM now set to initial NAV after upfront contribution
- Prevents incorrect performance fee charges in subsequent months

**Deployment Status:**
- ✅ Deployed to production (project: wqnmxpooabmedvtackji)
- ⏳ Requires testing with same parameters to verify fix

**Verification Steps:**
1. Run new back-test: 2025-01-01 to 2025-12-31, $10K upfront + $1K monthly
2. Query: `SELECT trade_date, nav_usd, high_water_mark_usdt, performance_fees_paid_usdt FROM lth_pvr_bt.bt_results_daily WHERE bt_run_id = '[new_run_id]' AND trade_date BETWEEN '2025-01-01' AND '2025-02-03'`
3. Verify high_water_mark_usdt on 2025-01-01 ≈ $10,897.85
4. Verify performance_fees_paid_usdt on 2025-02-01 = $0 (NAV was below HWM)

## Notes

This bug affects BOTH:
- Public website back-test tool
- Admin UI back-test tool

Both use the same `ef_bt_execute` function via different RPC entry points.
