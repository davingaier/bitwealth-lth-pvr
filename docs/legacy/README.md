# Legacy Python Simulator

**Status:** ARCHIVED (2026-02-21)  
**Replaced By:** TypeScript simulator in shared logic module (`supabase/functions/_shared/lth_pvr_strategy_logic.ts`)

---

## Overview

This Python script (`live_lth_pvr_rule2_momo_filter_v1.1.py`) was the original offline parameter optimization tool for the LTH PVR strategy. It used the Optuna library for hyperparameter tuning and was maintained separately from the production TypeScript codebase.

## Why Archived?

As of **Phase 1** of the Strategy Maintenance project (completed 2026-02-21), all trading logic has been **centralized into a single TypeScript implementation**:

- **Canonical Source:** `supabase/functions/_shared/lth_pvr_strategy_logic.ts`
- **Used By:**
  - Live trading: `ef_generate_decisions`
  - Back-testing: `ef_bt_execute` and `ef_execute_public_backtests`
  - Simulator: `ef_run_lth_pvr_simulator` (Phase 3)
  - Optimizer: `lth_pvr_optimizer.ts` (Phase 3)

**Benefits of TypeScript Centralization:**
1. ✅ Single source of truth (no drift between implementations)
2. ✅ Shared configuration parameters across all tools
3. ✅ Embedded directly in Admin UI (no offline scripts needed)
4. ✅ Consistent fee handling and state management
5. ✅ Type-safe configuration (StrategyConfig interface)

---

## Key Differences from Production

The archived Python simulator has several **discrepancies** from the current production TypeScript implementation:

### 1. Bear Pause Thresholds (HARD-CODED)
**Python:**
- Enter: +2.0σ (hard-coded)
- Exit: -1.0σ (hard-coded)

**TypeScript (Configurable):**
- Enter: `config.bearPauseEnterSigma` (default: 2.0)
- Exit: `config.bearPauseExitSigma` (default: -1.0 for Progressive)
- **Variations:** Balanced uses -0.75σ, Conservative uses 0σ

### 2. Retrace Base Size (HARD-CODED)
**Python:**
- Always uses Base 3 (B.B3) for retrace buys

**TypeScript (Configurable):**
- Uses `config.retraceBase` (default: 3, range: 1-5)
- **Optimization:** Phase 3 will explore optimal retrace Base per variation

### 3. Momentum Parameters (HARD-CODED)
**Python:**
- Length: 5 days (hard-coded)
- Threshold: 0% (hard-coded)

**TypeScript (Configurable):**
- Length: `config.momentumLength` (default: 5, optimizable)
- Threshold: `config.momentumThreshold` (default: 0.0, optimizable)

### 4. Fee Structure (PARTIAL)
**Python:**
- May not include all fee types (platform, performance, contribution)
- Exchange trade fees may be simplified

**TypeScript (Complete):**
- Platform fee: 0.75% on contributions (USDT)
- Performance fee: 10% high-water mark (USDT)
- Exchange contribution fee: 18 bps (USDT)
- Exchange trade fee: 8 bps (BTC when buying, USDT when selling)

### 5. Strategy Variations (NOT SUPPORTED)
**Python:**
- Single hard-coded parameter set
- No variation concept

**TypeScript (Multi-Variation):**
- Progressive, Balanced, Conservative variations
- Per-variation B1-B11, bear pause thresholds, momentum params
- Database-driven configuration

---

## Historical Context

### Optimization Results (Pre-2026)

This Python simulator produced the **current production parameters** (Progressive variation):

```python
# Optimized parameters (as of 2025)
B1 = 0.22796   # < -1.0σ
B2 = 0.21397   # -1.0σ ... -0.75σ
B3 = 0.19943   # -0.75σ ... -0.5σ
B4 = 0.18088   # -0.5σ ... -0.25σ
B5 = 0.12229   # -0.25σ ... mean
B6 = 0.00157   # mean ... +0.5σ
B7 = 0.00200   # +0.5σ ... +1.0σ
B8 = 0.00441   # +1.0σ ... +1.5σ
B9 = 0.01287   # +1.5σ ... +2.0σ
B10 = 0.03300  # +2.0σ ... +2.5σ
B11 = 0.09572  # > +2.5σ
```

These values are now stored in `lth_pvr.strategy_variation_templates` (Phase 2) and will be re-optimized using the TypeScript grid search optimizer (Phase 3).

### Dependencies

The Python simulator required:
- `pandas` - Data manipulation
- `optuna` - Hyperparameter optimization
- `requests` - API calls to Supabase
- `python-dotenv` - Environment configuration

**Note:** The TypeScript optimizer (Phase 3) uses **grid search** as the initial MVP approach, with plans to integrate Optuna in Phase 7 (Future Enhancements).

---

## Migration Path

If you need to reference or validate historical optimization runs:

### 1. Compare Back-test Results
```sql
-- Run TypeScript back-test with Progressive parameters
SELECT * FROM lth_pvr_bt.bt_runs
WHERE start_date = '2020-01-01' 
  AND end_date = '2025-12-31';

-- Compare NAV, ROI, CAGR, Max Drawdown
-- Should match Python simulator results (within rounding errors)
```

### 2. Validate Logic Parity
- Unit tests: `supabase/functions/_shared/lth_pvr_strategy_logic.test.ts` (36 tests)
- Integration tests: Phase 4 shadow mode (7-day parallel run)
- Regression tests: Compare TypeScript back-test vs Python historical output

### 3. Re-run Optimization
Once Phase 3 is complete:
```typescript
// Run TypeScript optimizer via Admin UI
// Grid search will explore:
// - B1-B11 order sizes
// - Momentum length (1, 3, 5, 7, 10, 14, 21, 30)
// - Momentum threshold (-2%, -1%, 0%, 1%, 2%)
// - Retrace Base (1, 2, 3, 4, 5)
```

---

## Preservation Rationale

This Python script is **preserved** (not deleted) for:

1. **Historical Reference:** Documents optimization methodology used pre-2026
2. **Validation:** Can cross-check TypeScript results if discrepancies arise
3. **Knowledge Transfer:** Shows Optuna integration patterns for Phase 7
4. **Audit Trail:** Proves due diligence in parameter selection

**DO NOT USE FOR:**
- Production parameter optimization (use TypeScript optimizer)
- Live trading logic reference (use shared module)
- Customer-facing tools (use Admin UI simulator)

---

## Related Documentation

- **Build Plan:** `docs/LTH_PVR_Strategy_Maintenance_Build_Plan.md`
- **Test Cases:** `docs/Strategy_Maintenance_Test_Cases.md`
- **Shared Logic:** `supabase/functions/_shared/lth_pvr_strategy_logic.ts`
- **Strategy Documentation:** `docs/LTH_PVR_STRATEGY_VARIATIONS.md` (Phase 5)
- **SDD:** `docs/SDD_v0.6.md` (system design document)

---

**Last Updated:** 2026-02-21  
**Archived By:** BitWealth Development Team  
**Phase 1 Status:** ✅ COMPLETE (Logic Centralization)
