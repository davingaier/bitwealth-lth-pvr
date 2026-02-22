# Enable Retrace Mismatch Fix - 2026-02-22

## Issue Summary

**Root Cause Identified:** $133,456 NAV discrepancy between simulator and back-tester was caused by a configuration mismatch in the `enable_retrace` parameter.

| Implementation | enable_retrace | Source |
|----------------|----------------|--------|
| **Simulator (Admin UI)** | `true` | Progressive variation template (`lth_pvr.strategy_variation_templates`) |
| **Public Website Back-tester** | `false` | Hardcoded in `run_public_backtest()` RPC function |

## Impact of enable_retrace Setting

The retrace logic prevents aggressive buying during price retracements from overbought zones. With `enable_retrace=false`, the back-tester bought more frequently during dips, accumulating significantly more BTC over 2,243 days.

**Result Differences with enable_retrace=false:**
- **+67% more BTC** (0.07579 vs 0.02535)
- **-24% less USDT** ($392K vs $519K)
- **-26% lower NAV** ($387K vs $521K)

## Fix Applied

**Migration:** `20260222_fix_public_backtest_enable_retrace.sql`

**Change:** Updated `public.run_public_backtest()` function to set `enable_retrace=true` (line 175)

```sql
-- BEFORE:
false  -- Retrace disabled

-- AFTER:
true   -- Enable retrace logic (matching Progressive variation default)
```

**Status:** ✅ Migration applied successfully

## Validation Steps

To verify the fix resolved the discrepancy:

1. **Run simulator test (Admin UI):**
   - Module: Simulator
   - Dates: 2020-01-01 to 2026-02-20
   - Upfront: $10,000
   - Monthly: $500
   - Variation: Progressive
   - **Expected:** NAV ~$521K, BTC ~0.025, USDT ~$519K

2. **Run public website back-tester:**
   - URL: https://bitwealth.co.za/lth-pvr-backtest.html
   - Same parameters as above
   - **Expected:** NAV ~$521K, BTC ~0.025, USDT ~$519K (matching simulator)

3. **Compare results:**
   - NAV difference should be < $10 (rounding only)
   - BTC difference should be < 0.00001
   - USDT difference should be < $10
   - All fees should match within $1

## Technical Details

**Files Modified:**
- `supabase/migrations/20260222_fix_public_backtest_enable_retrace.sql` - New migration ✅

**Database Changes:**
- Updated `public.run_public_backtest()` function
- Now creates `bt_params` records with `enable_retrace=true`

**Why This Happened:**

The public website's RPC function was created with a comment saying "matching Admin UI default", but the comment was incorrect. The Progressive variation (used by Admin UI) has always had `enable_retrace=true`, not false.

The simulator reads configuration from `strategy_variation_templates` table (correct), while the public website hardcoded the value in the RPC function (incorrect).

## Follow-Up Actions

- [x] Apply migration to fix `run_public_backtest()` function
- [ ] Re-run both tests with identical parameters to validate match
- [ ] Complete TC-3.1.5: Validate simulator fees match back-tester
- [ ] Document test results in `Strategy_Maintenance_Test_Cases.md`

## Related Files

- **Migration:** [supabase/migrations/20260222_fix_public_backtest_enable_retrace.sql](c:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr\supabase\migrations\20260222_fix_public_backtest_enable_retrace.sql)
- **Public Website:** [website/lth-pvr-backtest.html](c:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr\website\lth-pvr-backtest.html) (unchanged - uses database function)
- **Simulator Edge Function:** [supabase/functions/ef_run_lth_pvr_simulator/index.ts](c:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr\supabase\functions\ef_run_lth_pvr_simulator\index.ts#L184) (line 184: defaults to `true`)
- **Back-tester Edge Function:** [supabase/functions/ef_bt_execute/index.ts](c:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr\supabase\functions\ef_bt_execute\index.ts#L165) (line 165: defaults to `true`)

## Lesson Learned

When multiple implementations exist (Admin UI back-tester, public website back-tester, simulator), ensure they all source configuration from the same place (database tables) rather than hardcoding values in different locations. Comments like "matching default" should be verified against actual code/data.

---

**Fix Completed:** 2026-02-22  
**Migration Status:** Applied ✅  
**Validation Status:** Pending user re-test
