# Retrace Logic A/B Testing Plan

**Created:** 2026-02-24  
**Purpose:** Systematically test whether `enable_retrace` improves or degrades performance across different market regimes  
**Status:** 🔄 IN PROGRESS

---

## Background

### Discovery (2026-02-24)

User ran back-test on **2022-11-09 to 2025-10-10** (bear bottom → bull run recovery):
- **LTH PVR (with retrace):** $285,750 NAV (+421.8% ROI)
- **Standard DCA:** $339,280 NAV (+521.97% ROI)
- **Result:** Standard DCA beat LTH PVR by $53.5K (18.7%)

### Previous Testing (2026-02-22)

Back-test on **2020-01-01 to 2026-02-20** (full cycle):
- **LTH PVR (with retrace):** $511,974 NAV
- **LTH PVR (without retrace):** $387,338 NAV
- **Result:** Retrace logic added $124,636 value (32% improvement)

### Hypothesis

**Retrace logic is date-range sensitive:**
- ✅ **Performs well** on full market cycle (includes multiple bear/bull transitions)
- ❌ **Underperforms** on specific regimes (monotonic recovery from bear bottom)

**Theory:** Retrace logic prevents buying during "fake dips" (price retracements from overbought zones). In a strong, sustained bull run with few corrections, this causes LTH PVR to miss accumulation opportunities that Standard DCA captures.

---

## Test Matrix

### Market Regimes to Test

| Test ID | Start Date | End Date | Regime Type | Characteristics |
|---------|------------|----------|-------------|-----------------|
| **R-01** | 2020-01-01 | 2026-02-20 | Full cycle | Complete bear→bull→bear→bull (baseline) |
| **R-02** | 2022-11-09 | 2025-10-10 | Recovery | Bear bottom → sustained bull run |
| **R-03** | 2022-01-01 | 2022-11-30 | Bear crash | Bull peak → FTX crash bottom |
| **R-04** | 2024-01-01 | 2024-10-31 | Bull ATH | ETF approval → new ATH cycle |
| **R-05** | 2020-03-01 | 2021-04-14 | First bull | COVID crash recovery → 2021 peak |
| **R-06** | 2021-04-14 | 2021-11-10 | First correction | Peak → summer dip → peak |
| **R-07** | 2021-11-10 | 2022-11-21 | Long bear | ATH → multi-year bear market |
| **R-08** | 2023-01-01 | 2023-12-31 | Sideways | Low volatility accumulation phase |

### Parameters (Constant Across All Tests)

- **Upfront:** $10,000
- **Monthly:** $500
- **Both variations use identical B1-B11, bear pause, momentum settings**
- **Only difference:** `enable_retrace` = true vs false

---

## Test Execution Procedure

### Step 1: Apply Migration

```powershell
# Load MCP Supabase tool
tool_search_tool_regex("supabase")

# Apply migration
mcp_supabase_apply_migration({
  name: "20260224_add_progressive_no_retrace_variation",
  query: "<contents of migration file>"
})
```

### Step 2: Run Back-Tests via Admin UI

For each test ID (R-01 through R-08):

**Test A: Progressive (with retrace)**
1. Navigate to Admin UI → Back-Testing
2. Select variation: "Progressive"
3. Set date range per test matrix
4. Set upfront: $10,000, monthly: $500
5. Click "Run Back-test"
6. Record: Final NAV, Total ROI, CAGR, BTC held, Total buys, Total sells

**Test B: Progressive No Retrace**
1. Same parameters as Test A
2. Select variation: "Progressive No Retrace"
3. Record same metrics

**Test C: Standard DCA (baseline)**
1. Run Standard DCA comparison
2. Record same metrics

### Step 3: Data Collection Template

```markdown
## Test R-XX: [Regime Name] ([Start] to [End])

### Progressive (enable_retrace=TRUE)
- Final NAV: $XXX,XXX
- Total ROI: +XXX.X%
- CAGR: XX.XX%
- BTC Held: X.XXXX
- Total Buys: XXX
- Total Sells: XXX
- Platform Fee: $XXX
- Performance Fee: $XX,XXX

### Progressive No Retrace (enable_retrace=FALSE)
- Final NAV: $XXX,XXX
- Total ROI: +XXX.X%
- CAGR: XX.XX%
- BTC Held: X.XXXX
- Total Buys: XXX
- Total Sells: XXX
- Platform Fee: $XXX
- Performance Fee: $XX,XXX

### Standard DCA (baseline)
- Final NAV: $XXX,XXX
- Total ROI: +XXX.X%
- CAGR: XX.XX%
- BTC Held: X.XXXX

### Analysis
- **Winner:** [Progressive / Progressive No Retrace / Standard DCA]
- **Spread:** $XX,XXX (X.X% difference)
- **Interpretation:** [Why did this variation win in this regime?]
```

---

## Success Criteria

### Quantitative

**Primary Metric:** Final NAV (Net Asset Value)
**Secondary Metrics:** 
- ROI (Total Return on Investment)
- CAGR (Compound Annual Growth Rate)
- Sharpe Ratio (approximation: CAGR / MaxDD)
- BTC Holdings (indication of accumulation strategy)

### Decision Framework

After completing all 8 tests:

**Scenario A: Retrace logic wins ≥6 of 8 tests**
- ✅ Keep `enable_retrace=true` as production default
- Document: "Retrace logic improves performance across most market regimes"

**Scenario B: No retrace wins ≥6 of 8 tests**
- 🔄 Change production to `enable_retrace=false`
- Update Progressive variation in database
- Migrate existing customers (if any assigned to Progressive)

**Scenario C: Split 4-4 or 5-3**
- 🔬 Requires deeper analysis:
  - Which regime types favor each configuration?
  - Can we predict regime type in real-time?
  - Should we create **adaptive retrace logic** that toggles based on market conditions?

**Scenario D: Retrace wins full cycle (R-01) by large margin**
- ✅ Keep retrace enabled regardless of sub-period results
- Reason: Long-term portfolio performance matters most
- Document: "Optimized for full cycle, accepts short-term underperformance"

---

## Integration with Phase 3 Optimizer

### After Systematic Testing (This Plan)

**If retrace logic shows regime-dependent performance:**

**Phase 3.3-3.11 should test:**
1. **Retrace Base Size** (currently hardcoded to 3):
   - Grid search: retrace_base ∈ {1, 2, 3, 4, 5}
   - Does larger/smaller retrace buy improve regime-specific performance?

2. **Retrace Eligibility Thresholds:**
   - Currently: Touch +1.5σ→+2.0σ, retrace to +0.5σ→+1.0σ triggers buy
   - Test: Does +2.0σ→+2.5σ eligibility perform better?

3. **Momentum Filter for Retrace:**
   - Currently: Retrace exceptions bypass momentum filter
   - Test: Should retrace also require positive momentum?

4. **Adaptive Retrace (Advanced):**
   - Enable retrace only when volatility > threshold
   - Disable retrace during sustained trends
   - Requires real-time regime detection

---

## Timeline

- **Week 1 (Feb 24-28):** Complete 8 back-tests (Tests R-01 to R-08)
- **Week 2 (Mar 3-7):** Analyze results, make production decision
- **Week 3 (Mar 10-14):** If needed, apply database updates and migrate customers
- **Phase 3:** Integrate findings into optimizer parameter sweep

---

## Current Results

### ✅ Test R-01: Full Cycle (2020-01-01 to 2026-02-20)
- **Progressive (retrace=true):** $511,974 NAV ✅ WINNER
- **Progressive (retrace=false):** $387,338 NAV
- **Spread:** +$124,636 (32% improvement with retrace)

### ✅ Test R-02: Recovery (2022-11-09 to 2025-10-10)
- **Progressive (retrace=true):** $285,750 NAV
- **Standard DCA:** $339,280 NAV ✅ WINNER (Standard DCA beat LTH PVR)
- **Note:** Progressive No Retrace not yet tested (need to apply migration first)

### ⏳ Test R-03: Bear Crash (PENDING)
### ⏳ Test R-04: Bull ATH (PENDING)
### ⏳ Test R-05: First Bull (PENDING)
### ⏳ Test R-06: First Correction (PENDING)
### ⏳ Test R-07: Long Bear (PENDING)
### ⏳ Test R-08: Sideways (PENDING)

---

## Next Actions

1. **Apply migration** to create Progressive No Retrace variation
2. **Re-run Test R-02** with Progressive No Retrace to confirm it beats retrace=true
3. **Execute Tests R-03 through R-08** systematically
4. **Analyze patterns:** Which regimes favor retrace? Which don't?
5. **Make data-driven decision** based on aggregate results

---

**Last Updated:** 2026-02-24
