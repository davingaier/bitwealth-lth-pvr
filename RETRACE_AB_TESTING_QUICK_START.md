# Retrace A/B Testing - Quick Start Guide

**Created:** 2026-02-24  
**Status:** ✅ READY - Migration applied, variations created

---

## ✅ Setup Complete

**Database Status:**
- ✅ Progressive variation: `enable_retrace=true` (production)
- ✅ Progressive No Retrace variation: `enable_retrace=false` (test)
- Both variations identical except for retrace setting

**Variations Available in Admin UI:**
- Progressive (Current Production)
- Progressive No Retrace (Test Variation)
- Balanced (Moderate Risk)
- Conservative (Lower Risk)

---

## 🧪 Test Execution Steps

### Test R-02: Recovery Regime (2022-11-09 to 2025-10-10)

**You already have Test A results from public website:**
- **Progressive (retrace=true):** $285,750 NAV
- **Standard DCA:** $339,280 NAV

**Now run Test B via Admin UI:**

1. Navigate to **Admin UI → Back-Testing** module
2. **Variation:** Select "Progressive No Retrace (Test Variation)"
3. **Start Date:** 2022-11-09
4. **End Date:** 2025-10-10
5. **Upfront:** $10,000
6. **Monthly:** $500
7. Click **"Run Back-test"**
8. **Record results:**
   ```
   Final NAV: $_______
   Total ROI: +_____%
   CAGR: ____%
   BTC Held: __.____
   Total Buys: ___
   Total Sells: ___
   ```

**Expected Hypothesis:**
- Progressive No Retrace should beat Progressive ($285,750)
- Progressive No Retrace might even beat Standard DCA ($339,280)
- If true, confirms retrace logic hurts performance in sustained bull runs

---

## 📊 Full Test Matrix (8 Tests)

Copy this template to track results:

```markdown
## Test R-01: Full Cycle (2020-01-01 to 2026-02-20)
✅ **COMPLETE**
- Progressive (retrace=true): $511,974 ✅ WINNER (+32% vs no-retrace)
- Progressive No Retrace: $387,338

---

## Test R-02: Recovery (2022-11-09 to 2025-10-10)
⏳ **IN PROGRESS**
- Progressive (retrace=true): $285,750
- Progressive No Retrace: $_______  ← RUN THIS NOW
- Standard DCA: $339,280 (current winner)

---

## Test R-03: Bear Crash (2022-01-01 to 2022-11-30)
⏳ **PENDING**
- Progressive (retrace=true): $_______
- Progressive No Retrace: $_______
- Standard DCA: $_______

---

## Test R-04: Bull ATH (2024-01-01 to 2024-10-31)
⏳ **PENDING**
- Progressive (retrace=true): $_______
- Progressive No Retrace: $_______
- Standard DCA: $_______

---

## Test R-05: First Bull (2020-03-01 to 2021-04-14)
⏳ **PENDING**
- Progressive (retrace=true): $_______
- Progressive No Retrace: $_______
- Standard DCA: $_______

---

## Test R-06: First Correction (2021-04-14 to 2021-11-10)
⏳ **PENDING**
- Progressive (retrace=true): $_______
- Progressive No Retrace: $_______
- Standard DCA: $_______

---

## Test R-07: Long Bear (2021-11-10 to 2022-11-21)
⏳ **PENDING**
- Progressive (retrace=true): $_______
- Progressive No Retrace: $_______
- Standard DCA: $_______

---

## Test R-08: Sideways (2023-01-01 to 2023-12-31)
⏳ **PENDING**
- Progressive (retrace=true): $_______
- Progressive No Retrace: $_______
- Standard DCA: $_______
```

---

## 🎯 Priority Tests (Do These First)

**Most Important:**
1. **R-02 (Recovery)** - Already showing retrace underperforms
2. **R-04 (Bull ATH)** - Test if pattern repeats in 2024 bull run
3. **R-07 (Long Bear)** - Test if retrace helps in bear markets

**If pattern is clear after 3 tests, you can skip the rest.**

---

## 📈 Decision Framework

**After completing tests:**

| Scenario | Retrace Wins | No-Retrace Wins | Decision |
|----------|--------------|-----------------|----------|
| **A** | 6-8 tests | 0-2 tests | ✅ Keep retrace=true (production) |
| **B** | 0-2 tests | 6-8 tests | 🔄 Switch production to retrace=false |
| **C** | 4 tests | 4 tests | 🤔 Analyze regime patterns |
| **D** | R-01 wins big | Others split | ✅ Keep retrace=true (long-term priority) |

**Scenario D Explanation:**
If retrace wins the full cycle test (R-01) by a large margin (+32% = $124K), keep it enabled even if it underperforms on some sub-periods. **Long-term portfolio performance matters most.**

---

## 🔬 Next Steps After Testing

**If retrace shows regime-dependent performance:**

1. **Phase 3 Optimizer** should test:
   - Retrace Base Size: {1, 2, 3, 4, 5}
   - Retrace thresholds (different sigma levels)
   - Momentum filter for retrace
   - Adaptive retrace (enable/disable based on volatility)

2. **Consider Hybrid Strategy:**
   - Use retrace during high-volatility periods
   - Disable retrace during sustained trends
   - Requires real-time regime detection

---

## 📝 Files Reference

**Test Plan (Full Details):**
- `docs/Retrace_Logic_AB_Testing_Plan.md`

**Migration (Applied):**
- `supabase/migrations/20260224_add_progressive_no_retrace_variation.sql`

**SDD Change Log:**
- `docs/SDD_v0.6.md` (v0.6.52)

---

## 💡 Quick Tips

**Copy-Paste Date Ranges:**
```
R-01: 2020-01-01 to 2026-02-20
R-02: 2022-11-09 to 2025-10-10
R-03: 2022-01-01 to 2022-11-30
R-04: 2024-01-01 to 2024-10-31
R-05: 2020-03-01 to 2021-04-14
R-06: 2021-04-14 to 2021-11-10
R-07: 2021-11-10 to 2022-11-21
R-08: 2023-01-01 to 2023-12-31
```

**Good Practice:**
- Run both variations (with/without retrace) back-to-back
- Take screenshots of results
- Note execution time (some periods are faster than others)

**Common Issues:**
- If Admin UI doesn't show "Progressive No Retrace" variation, refresh browser
- Back-tests can take 30-60 seconds for long date ranges
- Database may time out on very old date ranges (pre-2020)

---

**Next Action:** Run Test R-02 with Progressive No Retrace variation NOW! 🚀
