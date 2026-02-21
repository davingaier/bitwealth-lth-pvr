# LTH PVR Strategy Maintenance Build Plan

**Project:** Strategy Variation System with Embedded Simulator  

**Status:** Planning Phase  

**Last Updated:** 2026-02-21  

**Version:** 1.0

---

## Executive Summary

**Objective:** Centralize trading logic, create strategy variation system (Progressive/Balanced/Conservative), and embed parameter optimization simulator in Admin UI.

**Key Outcomes:**

1. Single source of truth for LTH PVR trading logic (TypeScript)
2. Three strategy variations with configurable bear pause EXIT thresholds AND B1-B11 order sizes
3. Admin-facing simulator for B1-B11 and momentum parameter optimization
4. One-click deployment of optimized parameters with rollback capability
5. CSV export of simulation results for external analysis
6. Comprehensive strategy documentation covering all 3 variations
7. Standard DCA comparison capability (like back-tester)

**Important Fee Handling:**
- Exchange trade fees (8 bps): Charged in BTC when buying, charged in USDT when selling
- Platform/performance fees: Always charged in USDT

**Simulator Defaults:** $10,000 upfront, $500 monthly, 2020-01-01 to today

**Timeline:** ~20-22 iterations across 6 phases

---

## Current State Analysis

### Logic Implementation Status

| Component              | Location                                      | B1-B11 Source              | Bear Pause               | Momentum                              | Logic File                   |
| ---------------------- | --------------------------------------------- | -------------------------- | ------------------------ | ------------------------------------- | ---------------------------- |
| **Python Simulator**   | `docs/live_lth_pvr_rule2_momo_filter_v1.1.py` | Global variables           | Hard-coded (+2.0σ/-1.0σ) | Hard-coded (5-day ROC > 0%)           | `decide_trade()` function    |
| **Live Trading**       | `ef_generate_decisions/index.ts`              | `strategy_versions.b1-b11` | Hard-coded (+2.0σ/-1.0σ) | Hard-coded (5-day ROC > 0%)           | `lth_pvr_logic.ts` (copy #1) |
| **Admin Back-tester**  | `ef_bt_execute/index.ts`                      | `bt_params.b1-b11`         | Hard-coded (+2.0σ/-1.0σ) | Configurable (`momo_len`, `momo_thr`) | `lth_pvr_logic.ts` (copy #2) |
| **Public Back-tester** | `ef_bt_execute/index.ts`                      | `bt_params.b1-b11`         | Hard-coded (+2.0σ/-1.0σ) | Configurable (`momo_len`, `momo_thr`) | `lth_pvr_logic.ts` (copy #2) |

### Critical Issues Identified

1. ❌ **Logic Duplication:** `lth_pvr_logic.ts` exists in TWO locations plus Python
2. ❌ **Hard-coded Parameters:** Bear pause triggers (+2.0σ/-1.0σ) cannot be configured
3. ❌ **No Strategy Variations:** Single set of parameters for all customers
4. ❌ **Manual Optimization:** Python script must be run offline, results manually copied
5. ❌ **No Deployment Workflow:** No UI for testing/approving/deploying optimized parameters

---

## Architecture Decisions

### Decision 1: Python Simulator Deprecation

**Choice:** Deprecate Python, use TypeScript as canonical implementation  

**Rationale:**

- Eliminates 3rd copy of trading logic
- Enables real-time browser-based simulation
- Direct integration with production database
- No subprocess complexity
- Python script archived as `docs/legacy/live_lth_pvr_rule2_momo_filter_v1.1.py`

### Decision 2: Optimization Library

**Choice:** Option C (Grid Search MVP) → Option A (Python/Optuna) later  

**Rationale:**

- Grid search faster to implement (2-3 days vs 1-2 weeks)
- Sufficient for optimizing B1-B11 order sizes (11 params) + momentum params (momo_length, momo_threshold)
- Bear pause triggers NOT optimized - fixed per variation design
- Optuna integration deferred to Phase 7 (post-MVP)

### Decision 3: Variation Naming

**Choice:** Progressive / Balanced / Conservative  

**Rationale**

- Progressive = More aggressive (enter pause once BTC price > +2.0σ band / exit pause once BTC price < -1.0σ band) - Current production behavior
- Balanced = Less aggressive (enter pause once BTC price > +2.0σ band / exit pause once BTC price < -0.75σ band)
- Conservative = More cautious (enter pause once BTC price > +2.0σ band / exit pause once BTC price < mean band)

### Decision 4: B1-B11 Per-Variation Scope

**Choice:** B1-B11 stored per strategy variation (not global)  

**Impact:** Each variation has its own set of 11 order sizes  

**Current Production:**  

Progressive variation uses existing production values:
- Bear pause: Enter +2.0σ / Exit -1.0σ
- B1-B11: 0.22796, 0.21397, 0.19943, 0.18088, 0.12229, 0.00157, 0.00200, 0.00441, 0.01287, 0.03300, 0.09572

**Planned Variations:**

- Balanced: Exit pause earlier (-0.75σ), moderate order sizes
- Conservative: Exit pause earliest (at mean), smaller buys/larger sells

### Decision 5: Schema Organization

**Choice:** `lth_pvr.strategy_variation_templates` (not `public`)  

**Rationale:**

- LTH PVR-specific logic lives in `lth_pvr` schema
- Future strategies (e.g., ADV_DCA) will have their own variation tables
- `public` schema reserved for cross-strategy entities

---

## Database Schema Design

### New Table: `lth_pvr.strategy_variation_templates`

```sql
CREATE TABLE lth_pvr.strategy_variation_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  
  -- Identification
  variation_name TEXT NOT NULL,  -- 'progressive', 'balanced', 'conservative'
  display_name TEXT NOT NULL,    -- 'Progressive (High Risk/Reward)'
  description TEXT,
  sort_order INT DEFAULT 0,      -- For UI display ordering
  
  -- Bear Pause Configuration (specific to LTH PVR)
  bear_pause_enter_sigma NUMERIC NOT NULL DEFAULT 2.0,  -- +2.0σ activates pause
  bear_pause_exit_sigma NUMERIC NOT NULL DEFAULT -1.0,  -- -1.0σ deactivates pause
  
  -- Order Sizes (B1-B11) - Each variation has its own
  b1 NUMERIC(10,5) NOT NULL DEFAULT 0.22796,  -- Buy tier 1: < -1.0σ
  b2 NUMERIC(10,5) NOT NULL DEFAULT 0.21397,  -- Buy tier 2: -1.0σ ... -0.75σ
  b3 NUMERIC(10,5) NOT NULL DEFAULT 0.19943,  -- Buy tier 3: -0.75σ ... -0.5σ
  b4 NUMERIC(10,5) NOT NULL DEFAULT 0.18088,  -- Buy tier 4: -0.5σ ... -0.25σ
  b5 NUMERIC(10,5) NOT NULL DEFAULT 0.12229,  -- Buy tier 5: -0.25σ ... mean
  b6 NUMERIC(10,5) NOT NULL DEFAULT 0.00157,  -- Sell tier 1: mean ... +0.5σ
  b7 NUMERIC(10,5) NOT NULL DEFAULT 0.00200,  -- Sell tier 2: +0.5σ ... +1.0σ
  b8 NUMERIC(10,5) NOT NULL DEFAULT 0.00441,  -- Sell tier 3: +1.0σ ... +1.5σ
  b9 NUMERIC(10,5) NOT NULL DEFAULT 0.01287,  -- Sell tier 4: +1.5σ ... +2.0σ
  b10 NUMERIC(10,5) NOT NULL DEFAULT 0.03300, -- Sell tier 5: +2.0σ ... +2.5σ
  b11 NUMERIC(10,5) NOT NULL DEFAULT 0.09572, -- Sell tier 6: > +2.5σ
  
  -- Momentum Configuration (optional future use)
  momentum_length INT DEFAULT 5,
  momentum_threshold NUMERIC DEFAULT 0.0,
  enable_retrace BOOLEAN DEFAULT TRUE,
  
  -- Status & Audit
  is_active BOOLEAN DEFAULT true,
  is_production BOOLEAN DEFAULT false,  -- Only one variation per org can be production
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(org_id, variation_name)
);

-- Index for active production variations
CREATE INDEX idx_strategy_variation_templates_production 
ON lth_pvr.strategy_variation_templates(org_id, is_production) 
WHERE is_active = true AND is_production = true;

-- Updated_at trigger
CREATE TRIGGER update_strategy_variation_templates_updated_at
BEFORE UPDATE ON lth_pvr.strategy_variation_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

### Updated Table: `public.customer_strategies`

```sql
-- Add foreign key to strategy variation
ALTER TABLE public.customer_strategies 
ADD COLUMN strategy_variation_id UUID REFERENCES lth_pvr.strategy_variation_templates(id);

-- Add index for lookups
CREATE INDEX idx_customer_strategies_variation 
ON public.customer_strategies(strategy_variation_id);
```

### Seed Data Migration

```sql
-- Insert default variations (Progressive = current production)
INSERT INTO lth_pvr.strategy_variation_templates (
  org_id, variation_name, display_name, description, sort_order,
  bear_pause_enter_sigma, bear_pause_exit_sigma,
  b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11,
  momentum_length, momentum_threshold,
  is_production
) VALUES
  -- Progressive: CURRENT PRODUCTION (enters +2.0σ, exits -1.0σ)
  (
    'YOUR_ORG_ID', 'progressive', 'Progressive (Current Production)',
    'Exits bear pause at -1.0σ to maximize accumulation window. Current production parameters.',
    1,  -- Sort order
    2.0, -1.0,  -- Bear pause triggers (CURRENT PRODUCTION)
    0.22796, 0.21397, 0.19943, 0.18088, 0.12229,  -- Buy tiers (CURRENT)
    0.00157, 0.00200, 0.00441, 0.01287, 0.03300, 0.09572,  -- Sell tiers (CURRENT)
    5, 0.0,  -- Momentum params (CURRENT)
    true  -- Production default
  ),
  
  -- Balanced: Exits pause earlier (-0.75σ)
  (
    'YOUR_ORG_ID', 'balanced', 'Balanced (Moderate Risk)',
    'Exits bear pause at -0.75σ for earlier re-entry. Moderate risk/reward profile.',
    2,  -- Sort order
    2.0, -0.75,  -- Bear pause: enter +2.0σ, exit -0.75σ
    0.20000, 0.19000, 0.18000, 0.16000, 0.11000,  -- Buy tiers (moderate)
    0.00200, 0.00300, 0.00500, 0.01500, 0.04000, 0.10000,  -- Sell tiers (moderate)
    5, 0.0,  -- Momentum params (same as Progressive)
    false  -- Not yet production
  ),
  
  -- Conservative: Exits pause at mean (earliest)
  (
    'YOUR_ORG_ID', 'conservative', 'Conservative (Lower Risk)',
    'Exits bear pause at mean for earliest re-entry and capital preservation. Lower risk profile.',
    3,  -- Sort order
    2.0, 0.0,  -- Bear pause: enter +2.0σ, exit at mean
    0.18000, 0.17000, 0.16000, 0.14000, 0.10000,  -- Buy tiers (smaller)
    0.00300, 0.00400, 0.00700, 0.02000, 0.05000, 0.12000,  -- Sell tiers (larger)
    5, 0.0,  -- Momentum params (same as Progressive)
    false  -- Not yet production
  );

-- Migrate ALL existing customers to 'progressive' variation (current production)
UPDATE public.customer_strategies cs
SET strategy_variation_id = (
  SELECT id FROM lth_pvr.strategy_variation_templates 
  WHERE org_id = cs.org_id AND variation_name = 'progressive'
  LIMIT 1
)
WHERE strategy_id = (SELECT id FROM public.strategies WHERE code = 'LTH_PVR');
```

---

## Phase 1: Logic Centralization (Foundation)

**Goal:** Create single source of truth for LTH PVR trading logic  

**Duration:** 3 iterations  

**Dependencies:** None

### Iteration 1.1: Create Shared Logic Module ✅

**Tasks:**

- [ ] Create `supabase/functions/_shared/lth_pvr_strategy_logic.ts`
- [ ] Define `StrategyConfig` interface:

  ```typescript
  export interface StrategyConfig {
    // Order sizes
    B: {
      B1: number; B2: number; B3: number; B4: number; B5: number;
      B6: number; B7: number; B8: number; B9: number; B10: number; B11: number;
    };

    // Bear pause configuration
    bearPauseEnterSigma: number;  // e.g., 2.0 (+2.0σ)
    bearPauseExitSigma: number;   // e.g., -1.0 (-1.0σ)

    // Momentum configuration
    momentumLength: number;       // e.g., 5 (days)
    momentumThreshold: number;    // e.g., 0.0 (0%)

    // Retrace configuration
    enableRetrace: boolean;       // e.g., true
  }
  ```
- [ ] Move functions from existing `lth_pvr_logic.ts`:

  - `fin()` - finite number check
  - `bucketLabel()` - sigma band label
  - `decideTrade(px, r, roc5, state, config)` - **NEW signature with config**
  - `computeBearPauseAt(sb, orgId, upToDateStr, config)` - **NEW signature with config**
- [ ] Update `decideTrade()` to use `config.bearPauseEnterSigma` and `config.bearPauseExitSigma` instead of hard-coded +2.0/-1.0
- [ ] Update `decideTrade()` to use `config.B.B1` through `config.B.B11` instead of parameter `B`
- [ ] **CRITICAL:** Ensure fee calculation logic handles currency correctly:
  - **BUY orders:** `btc_received = btc_gross * (1 - 0.0008)` (fee charged in BTC)
  - **SELL orders:** `usdt_received = usdt_gross * (1 - 0.0008)` (fee charged in USDT)
  - This distinction must be preserved in shared logic module
- [ ] Add unit tests in `supabase/functions/_shared/lth_pvr_strategy_logic.test.ts`:

  ```typescript
  // Test 1: Bear pause enters at config.bearPauseEnterSigma
  // Test 2: Bear pause exits at config.bearPauseExitSigma
  // Test 3: Buy tiers use config.B.B1-B5
  // Test 4: Sell tiers use config.B.B6-B11
  // Test 5: Retrace exceptions respect config.enableRetrace
  ```

**Deliverable:** Single shared module with configurable logic

**Files Created:**

- `supabase/functions/_shared/lth_pvr_strategy_logic.ts`
- `supabase/functions/_shared/lth_pvr_strategy_logic.test.ts`

---

### Iteration 1.2: Refactor Live Trading (ef_generate_decisions) ✅

**Tasks:**

- [ ] Import shared module in `ef_generate_decisions/index.ts`:

  ```typescript
  import { decideTrade, bucketLabel, computeBearPauseAt, StrategyConfig } from "../_shared/lth_pvr_strategy_logic.ts";
  ```
- [ ] Query `lth_pvr.strategy_variation_templates` joined with `customer_strategies`:

  ```typescript
  const { data: custs } = await sb
    .from("customer_strategies")
    .select(`
      customer_id,
      strategy_variation:strategy_variation_templates!inner(
        bear_pause_enter_sigma,
        bear_pause_exit_sigma,
        b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11,
        momentum_length,
        momentum_threshold,
        enable_retrace
      )
    `)
    .eq("org_id", org_id)
    .eq("registration_status", "active")
    .eq("live_enabled", true);
  ```
- [ ] Build `StrategyConfig` from joined data:

  ```typescript
  const config: StrategyConfig = {
    B: {
      B1: Number(c.strategy_variation.b1),
      B2: Number(c.strategy_variation.b2),
      // ... B3-B11
    },
    bearPauseEnterSigma: Number(c.strategy_variation.bear_pause_enter_sigma),
    bearPauseExitSigma: Number(c.strategy_variation.bear_pause_exit_sigma),
    momentumLength: Number(c.strategy_variation.momentum_length ?? 5),
    momentumThreshold: Number(c.strategy_variation.momentum_threshold ?? 0),
    enableRetrace: c.strategy_variation.enable_retrace ?? true
  };
  ```
- [ ] Pass `config` to `decideTrade()` instead of `B` object
- [ ] Remove local `lth_pvr_logic.ts` file from `ef_generate_decisions/`
- [ ] Deploy with `--no-verify-jwt`
- [ ] Test in shadow mode:

  - Run for 3 days in production
  - Compare decisions: old logic vs new logic (should match for 'balanced' variation)
  - Log discrepancies to `lth_pvr.alert_events`

**Deliverable:** Live trading uses shared logic, variation-aware

**Files Modified:**

- `supabase/functions/ef_generate_decisions/index.ts`

**Files Deleted:**

- `supabase/functions/ef_generate_decisions/lth_pvr_logic.ts`

---

### Iteration 1.3: Refactor Back-testing (ef_bt_execute) ✅

**Tasks:**

- [ ] Import shared module in `ef_bt_execute/index.ts`
- [ ] Load variation config from `bt_params` (already has b1-b11 columns):

  ```typescript
  const config: StrategyConfig = {
    B: {
      B1: toNum(params.b1, defaultB.B1),
      B2: toNum(params.b2, defaultB.B2),
      // ... B3-B11
    },
    bearPauseEnterSigma: toNum(params.bear_pause_enter_sigma, 2.0),
    bearPauseExitSigma: toNum(params.bear_pause_exit_sigma, -1.0),
    momentumLength: toNum(params.momo_len, 5),
    momentumThreshold: toNum(params.momo_thr, 0),
    enableRetrace: params.enable_retrace ?? true
  };
  ```
- [ ] Add new columns to `lth_pvr_bt.bt_params` table:

  ```sql
  ALTER TABLE lth_pvr_bt.bt_params 
  ADD COLUMN bear_pause_enter_sigma NUMERIC DEFAULT 2.0,
  ADD COLUMN bear_pause_exit_sigma NUMERIC DEFAULT -1.0;
  ```
- [ ] Pass `config` to `decideTrade()` calls
- [ ] Remove local `lth_pvr_logic.ts` file from `ef_bt_execute/`
- [ ] Deploy both `ef_bt_execute` and `ef_execute_public_backtests`
- [ ] Test:

  - Run public back-test via website (2020-2025)
  - Run Admin UI back-test (2020-2025)
  - Compare NAV results: should match Python simulator output (archived for reference)

**Deliverable:** Back-testing uses shared logic

**Files Modified:**

- `supabase/functions/ef_bt_execute/index.ts`
- `supabase/migrations/YYYYMMDD_add_bear_pause_config_to_bt_params.sql`

**Files Deleted:**

- `supabase/functions/ef_bt_execute/lth_pvr_logic.ts`

---

### Iteration 1.4: Archive Python Simulator ✅

**Tasks:**

- [ ] Create `docs/legacy/` folder
- [ ] Move `docs/live_lth_pvr_rule2_momo_filter_v1.1.py` → `docs/legacy/`
- [ ] Create `docs/legacy/README.md`:

  ```markdown
  # Legacy Python Simulator

  **Status:** ARCHIVED (2026-02-21)
  **Replaced By:** TypeScript simulator in Admin UI

  This Python script was used for parameter optimization before the TypeScript
  implementation. It is preserved for historical reference and validation.

  ## Key Differences from Production
  - Bear pause hard-coded (+2.0σ/-1.0σ)
  - B1-B11 global variables (not per-variation)
  - No integration with production database

  ## Do NOT Use
  All parameter optimization should now be done via Admin UI Strategy Maintenance module.
  ```
- [ ] Update `.github/copilot-instructions.md` to reflect Python deprecation
- [ ] Update `docs/SDD_v0.6.md` change log (v0.6.51)

**Deliverable:** Python simulator archived, documentation updated

**Files Created:**

- `docs/legacy/README.md`

**Files Moved:**

- `docs/live_lth_pvr_rule2_momo_filter_v1.1.py` → `docs/legacy/`

**Files Modified:**

- `.github/copilot-instructions.md`
- `docs/SDD_v0.6.md`

---

## Phase 2: Strategy Variations Database Schema (Data Model)

**Goal:** Support Progressive/Balanced/Conservative variations in database  

**Duration:** 3 iterations  

**Dependencies:** Phase 1 complete

### Iteration 2.1: Create Database Schema ✅

**Tasks:**

- [ ] Create migration `20260221_create_lth_pvr_strategy_variations.sql`
- [ ] Implement `lth_pvr.strategy_variation_templates` table (see schema above)
- [ ] Add `strategy_variation_id` column to `public.customer_strategies`
- [ ] Create indexes for performance
- [ ] Apply migration via Supabase MCP:

  ```typescript
  await mcp_supabase_apply_migration({
    name: "create_lth_pvr_strategy_variations",
    query: "-- SQL from schema design section"
  });
  ```
- [ ] Verify table created:

  ```sql
  SELECT * FROM lth_pvr.strategy_variation_templates;
  -- Should return 0 rows (seed data in next iteration)
  ```

**Deliverable:** Database schema supports strategy variations

**Files Created:**

- `supabase/migrations/20260221_create_lth_pvr_strategy_variations.sql`

---

### Iteration 2.2: Seed Default Variations ✅

**Tasks:**

- [ ] Create migration `20260221_seed_lth_pvr_variations.sql`
- [ ] Insert 3 default variations (Progressive/Balanced/Conservative) - see seed data SQL above
- [ ] **Important:** Use actual `org_id` from production (query first):

  ```sql
  SELECT id FROM public.organizations LIMIT 1;
  ```
- [ ] Set 'balanced' as `is_production = true`
- [ ] Apply migration
- [ ] Verify seed data:

  ```sql
  SELECT variation_name, display_name, bear_pause_enter_sigma, bear_pause_exit_sigma, b1, b6
  FROM lth_pvr.strategy_variation_templates
  ORDER BY sort_order;

  -- Expected output:
  -- progressive | Progressive (...) | 1.5 | -0.5 | 0.25000 | 0.00100
  -- balanced    | Balanced (...)    | 2.0 | -1.0 | 0.22796 | 0.00157
  -- conservative| Conservative (...) | 2.5 | -1.5 | 0.18000 | 0.00300
  ```

**Deliverable:** 3 variations seeded with initial parameter estimates

**Files Created:**

- `supabase/migrations/20260221_seed_lth_pvr_variations.sql`

---

### Iteration 2.3: Migrate Existing Customers ✅

**Tasks:**

- [ ] Create migration `20260221_migrate_customers_to_progressive.sql`
- [ ] Update ALL customers to 'progressive' variation (per user request):

  ```sql
  UPDATE public.customer_strategies cs
  SET strategy_variation_id = (
    SELECT id FROM lth_pvr.strategy_variation_templates 
    WHERE org_id = cs.org_id 
    AND variation_name = 'progressive'
    LIMIT 1
  )
  WHERE strategy_id = (
    SELECT id FROM public.strategies WHERE code = 'LTH_PVR'
  )
  AND strategy_variation_id IS NULL;  -- Only unmigrated customers
  ```
- [ ] Apply migration
- [ ] Verify:

  ```sql
  SELECT 
    COUNT(*) as total_customers,
    COUNT(strategy_variation_id) as migrated_customers,
    svt.variation_name
  FROM public.customer_strategies cs
  LEFT JOIN lth_pvr.strategy_variation_templates svt 
    ON cs.strategy_variation_id = svt.id
  WHERE cs.strategy_id = (SELECT id FROM public.strategies WHERE code = 'LTH_PVR')
  GROUP BY svt.variation_name;

  -- Expected: All customers in 'progressive'
  ```

**Deliverable:** All existing customers migrated to 'progressive' variation

**Files Created:**

- `supabase/migrations/20260221_migrate_customers_to_progressive.sql`

---

## Phase 3: Simulator & Optimizer (Admin UI Integration)

**Goal:** Embed parameter optimization simulator in Admin UI  

**Duration:** 5-6 iterations  

**Dependencies:** Phase 1 & 2 complete

### Iteration 3.1: Create TypeScript Simulator Module ✅

**Tasks:**

- [ ] Create `supabase/functions/_shared/lth_pvr_simulator.ts`
- [ ] Implement core functions:

  ```typescript
  export interface SimulationInput {
    startDate: string;  // YYYY-MM-DD
    endDate: string;
    upfrontContrib: number;
    monthlyContrib: number;
    config: StrategyConfig;  // From shared logic module
  }

  export interface SimulationResult {
    finalNav: number;
    totalRoi: number;  // Percentage
    cagr: number;      // Percentage
    maxDrawdown: number;  // Percentage
    avgCashDrag: number;  // Percentage
    totalTrades: number;
    finalBtcBalance: number;
    finalUsdtBalance: number;
    ledger: DailyLedgerRow[];  // Optional, for charting
  }

  export async function runSimulation(
    sb: SupabaseClient,
    orgId: string,
    input: SimulationInput
  ): Promise<SimulationResult>;
  ```
- [ ] Port logic from Python `build_ledger()`:

  - Daily contribution processing (monthly on 1st)
  - Trade execution (buy/sell sizing)
  - Fee calculation (VALR + platform)
  - Balance tracking (USDT, BTC, NAV)
  - State management (bear_pause, retrace eligibility)
- [ ] Implement metrics calculation:

  - ROI = (NAV / invested) - 1
  - CAGR = (NAV / invested)^(1/years) - 1
  - Max Drawdown = max((peak - current) / peak)
  - Cash Drag = avg(USDT / NAV)
- [ ] Unit tests comparing TypeScript vs archived Python results

**Deliverable:** TypeScript simulator matching Python functionality

**Files Created:**

- `supabase/functions/_shared/lth_pvr_simulator.ts`
- `supabase/functions/_shared/lth_pvr_simulator.test.ts`

---

### Iteration 3.2: Create Simulator Edge Function ✅

**Tasks:**

- [ ] Create `supabase/functions/ef_run_lth_pvr_simulator/index.ts`
- [ ] Input parameters (with defaults):

  ```typescript
  {
    start_date: "2020-01-01",  // Default: 2020-01-01
    end_date: "2026-02-21",     // Default: today
    upfront_contrib: 10000,     // Default: $10,000
    monthly_contrib: 500,       // Default: $500
    variation_ids: ["uuid-progressive", "uuid-balanced", "uuid-conservative"],  // Required
    save_results: false         // Optional: persist to simulation_runs_daily table
  }
  ```
- [ ] Load CI bands data from `lth_pvr.ci_bands_daily` for date range
- [ ] Run simulation for EACH variation in parallel (Promise.all)
- [ ] Return results with detailed daily data:

  ```typescript
  {
    variations: {
      progressive: { 
        summary: { finalNav: 850000, roi: 650, cagr: 48, maxDrawdown: 58, totalFees: 12500 },
        dailyData: [ { date: "2020-01-01", btc_bal, usdt_bal, nav, action, ... }, ... ]
      },
      balanced: { ... },
      conservative: { ... }
    },
    executionTimeMs: 12345,
    savedToDatabase: false  // true if save_results=true
  }
  ```
- [ ] Optional persistence: If `save_results=true`, insert into new `lth_pvr.simulation_runs` and `lth_pvr.simulation_runs_daily` tables
- [ ] Fee structure (match back-tester):
    - Platform fee: 0.75% on contributions (charged in USDT)
    - Performance fee: 10% (high-water mark, charged in USDT)
    - Exchange trade fee: 8 bps (0.08%)
      - **BUY orders:** Fee charged in BTC (receive less BTC)
      - **SELL orders:** Fee charged in USDT (receive less USDT)
    - Exchange contribution fee: 18 bps (0.18%) in USDT
- [ ] Error handling:

  - Missing CI bands data → return specific error
  - Invalid date range → return validation error
  - Variation not found → return 404
- [ ] Deploy with `--no-verify-jwt` (admin-only, will add auth in Phase 4)
- [ ] Test via curl:

  ```powershell
  curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_run_lth_pvr_simulator `
    -H "Authorization: Bearer [SERVICE_KEY]" `
    -H "Content-Type: application/json" `
    -d '{"variation_ids":["..."]}'  # Uses defaults for dates/contribs
  ```

**Deliverable:** Edge function simulates all 3 variations with website defaults

**Files Created:**

- `supabase/functions/ef_run_lth_pvr_simulator/index.ts`
- `supabase/functions/ef_run_lth_pvr_simulator/client.ts`
- `supabase/migrations/20260222_create_simulation_runs_tables.sql` (optional persistence)

**Deployment:**

```powershell
supabase functions deploy ef_run_lth_pvr_simulator --project-ref wqnmxpooabmedvtackji --no-verify-jwt
```

---

### Iteration 3.3: Create Grid Search Optimizer ✅

**Tasks:**

- [ ] Create `supabase/functions/_shared/lth_pvr_optimizer.ts`
- [ ] Implement grid search algorithm:

  ```typescript
  export interface OptimizationInput {
    startDate: string;
    endDate: string;
    upfrontContrib: number;
    monthlyContrib: number;

    // B1-B11 optimization ranges (required)
    b1Range: number[];  // e.g., [0.18, 0.20, 0.22, 0.24, 0.26]
    b2Range: number[];  // e.g., [0.17, 0.19, 0.21, 0.23]
    // ... b3-b11 ranges (null = keep current value)

    // Momentum parameter optimization (required)
    momoLengthRange: number[];     // e.g., [1, 3, 5, 7, 10, 14, 21, 30] days
    momoThresholdRange: number[];  // e.g., [-0.02, -0.01, 0.0, 0.01, 0.02] (percentage)

    // Optimization metric
    objective: "nav" | "roi" | "cagr" | "sharpe";  // What to maximize
  }

  export interface OptimizationResult {
    bestConfig: StrategyConfig;
    bestScore: number;
    improvementVsCurrent: {
      navDelta: number;
      roiDelta: number;
      cagrDelta: number;
      maxDrawdownDelta: number;
    };
    allResults: Array<{
      config: StrategyConfig;
      score: number;
      metrics: SimulationResult;
    }>;
    totalCombinations: number;
    executionTimeMs: number;
  }

  export async function optimizeParameters(
    sb: SupabaseClient,
    orgId: string,
    currentConfig: StrategyConfig,  // For comparison
    input: OptimizationInput
  ): Promise<OptimizationResult>;
  ```
- [ ] Grid search logic:

  - Generate all combinations of B1-B11 + momo params
  - For each combination:
      - Run simulation via `runSimulation()`
      - Calculate objective score
  - Sort by score descending
  - Return top result + all results (limit to top 50) for review
- [ ] Optimization objectives:

  - `nav`: Maximize final NAV
  - `roi`: Maximize total ROI
  - `cagr`: Maximize CAGR
  - `sharpe`: Maximize (CAGR / MaxDrawdown) - Sharpe-like ratio (default)
- [ ] **Constraint:** B1-B11 must maintain monotonicity:

  - Buy tiers: B1 >= B2 >= B3 >= B4 >= B5
  - Sell tiers: B6 <= B7 <= B8 <= B9 <= B10 <= B11
  - Skip invalid combinations
- [ ] **NOT Optimized:** Bear pause triggers remain fixed per variation (enter +2.0σ, exit varies: -1.0σ / -0.75σ / mean)
- [ ] Performance optimization:

  - Limit grid combinations (max 2000)
  - Use Promise.all for parallel execution (20 workers)
  - Cache CI bands data (don't reload for each sim)
  - Add progress reporting (every 10% complete)

**Deliverable:** Grid search optimizer for B1-B11 + momentum params

**Files Created:**

- `supabase/functions/_shared/lth_pvr_optimizer.ts`

---

### Iteration 3.4: Create Optimizer Edge Function ✅

**Tasks:**

- [ ] Create `supabase/functions/ef_optimize_lth_pvr_strategy/index.ts`
- [ ] Input parameters:

  ```typescript
  {
    variation_id: "uuid-progressive",  // Which variation to optimize
    start_date: "2020-01-01",          // Default: 2020-01-01
    end_date: "2026-02-21",            // Default: today
    upfront_contrib: 10000,            // Default: $10,000
    monthly_contrib: 500,              // Default: $500

    // Grid ranges (optional, uses smart defaults if omitted)
    b1_range: null,  // null = use smart default (current +/- 20% in 10% steps)
    b2_range: null,
    // ... b3-b11 ranges
    momo_length_range: null,    // null = [1, 3, 5, 7, 10, 14, 21, 30]
    momo_threshold_range: null, // null = [-0.02, -0.01, 0.0, 0.01, 0.02]

    objective: "sharpe"  // nav | roi | cagr | sharpe (default: sharpe)
  }
  ```
- [ ] Load current variation config from database
- [ ] Generate smart default ranges if not provided:

  - **B1-B11:** current value +/- 20% in 10% increments (5 values per param)
    - Example: If B1=0.22796, range = [0.18237, 0.20517, 0.22796, 0.25076, 0.27355]
  - **momo_length:** [1, 3, 5, 7, 10, 14, 21, 30] days (8 values)
  - **momo_threshold:** [-0.02, -0.01, 0.0, 0.01, 0.02] (5 values)
  - **Total combinations:** 5^11 (B1-B11) × 8 (momo_length) × 5 (momo_threshold) = ~195 million → **TOO LARGE**
  - **Optimization strategy:** Only optimize subset of params per run:
      - Run 1: Optimize B1-B5 (buy tiers) only, keep sells/momo fixed
      - Run 2: Optimize B6-B11 (sell tiers) only, keep buys/momo fixed
      - Run 3: Optimize momo_length and momo_threshold, keep B1-B11 fixed
      - Admin can run multiple optimization passes
- [ ] Call `optimizeParameters()` from shared module
- [ ] Store optimization run in new table `lth_pvr.optimization_runs`:

  ```sql
  CREATE TABLE lth_pvr.optimization_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    variation_id UUID REFERENCES lth_pvr.strategy_variation_templates(id),

    -- Input parameters
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    upfront_contrib NUMERIC NOT NULL,
    monthly_contrib NUMERIC NOT NULL,
    objective TEXT NOT NULL,
    optimization_scope TEXT,  -- 'buy_tiers' | 'sell_tiers' | 'momentum' | 'all'

    -- Configuration snapshot (what params were tested)
    param_ranges JSONB,  -- { b1_range: [...], momo_length_range: [...] }

    -- Results
    current_config JSONB NOT NULL,  -- Config before optimization
    current_metrics JSONB NOT NULL, -- Metrics before optimization
    best_config JSONB NOT NULL,     -- Optimized config
    best_metrics JSONB NOT NULL,    -- Optimized metrics
    best_score NUMERIC NOT NULL,    -- Objective score
    improvement JSONB,              -- { navDelta, roiDelta, cagrDelta, maxDrawdownDelta }
    total_combinations INT NOT NULL,
    execution_time_ms INT NOT NULL,

    -- Status
    status TEXT DEFAULT 'completed',  -- completed | failed | cancelled
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
  );

  CREATE INDEX idx_optimization_runs_variation ON lth_pvr.optimization_runs(variation_id);
  CREATE INDEX idx_optimization_runs_created ON lth_pvr.optimization_runs(created_at DESC);
  ```
- [ ] Return optimization results with comparison:

  ```typescript
  {
    current: {
      config: { b1: 0.22796, ..., momo_length: 5, momo_threshold: 0.0 },
      metrics: { finalNav: 720000, roi: 620, cagr: 42, maxDrawdown: 52 }
    },
    optimized: {
      config: { b1: 0.25076, ..., momo_length: 7, momo_threshold: 0.01 },
      metrics: { finalNav: 850000, roi: 700, cagr: 48, maxDrawdown: 48 }
    },
    improvement: {
      navDelta: +130000,       // +18%
      roiDelta: +80,           // +12.9%
      cagrDelta: +6,           // +14.3%
      maxDrawdownDelta: -4     // -7.7% (improvement)
    },
    topResults: [            // Top 10 configurations
      { config: {...}, score: 1.25, metrics: {...} },
      { config: {...}, score: 1.18, metrics: {...} },
      // ... up to 10 results
    ],
    optimization_run_id: "uuid",
    executionTimeMs: 45000   // ~45 seconds
  }
  ```
- [ ] Deploy with `--no-verify-jwt`

**Deliverable:** Optimizer edge function for B1-B11 + momentum params (no bear pause)

**Files Created:**

- `supabase/functions/ef_optimize_lth_pvr_strategy/index.ts`
- `supabase/migrations/20260222_create_optimization_runs_table.sql`

**Deployment:**

```powershell
supabase functions deploy ef_optimize_lth_pvr_strategy --project-ref wqnmxpooabmedvtackji --no-verify-jwt
```

---

### Iteration 3.5: Admin UI - Strategy Selector Layer ✅

**Tasks:**

- [ ] Open `ui/Advanced BTC DCA Strategy.html`
- [ ] Locate Strategy Maintenance module (search for "Strategy Maintenance")
- [ ] Add strategy selector at top (mirroring Customer Transactions module pattern):

  ```html
  <div class="strategy-selector-bar">
    <label>Strategy Type:</label>
    <select id="strategyTypeSelector">
      <option value="">-- Select Strategy --</option>
      <option value="LTH_PVR" selected>LTH PVR BTC DCA</option>
      <!-- Future strategies will be added here -->
    </select>
  </div>
  ```
- [ ] Add conditional visibility logic:

  ```javascript
  function showStrategyMaintenance() {
    const strategyType = document.getElementById("strategyTypeSelector").value;

    // Hide all strategy-specific panels
    document.querySelectorAll(".strategy-panel").forEach(p => p.style.display = "none");

    // Show selected strategy panel
    if (strategyType === "LTH_PVR") {
      document.getElementById("lthPvrStrategyPanel").style.display = "block";
      loadLthPvrVariations();  // Load Progressive/Balanced/Conservative
    }
    // Future: else if (strategyType === "ADV_DCA") { ... }
  }

  document.getElementById("strategyTypeSelector").addEventListener("change", showStrategyMaintenance);
  ```
- [ ] Default to "LTH_PVR" selected on page load
- [ ] Style selector bar to match existing UI patterns (context bar style)

**Deliverable:** Strategy selector layer with LTH PVR as default

**Files Modified:**

- `ui/Advanced BTC DCA Strategy.html` (lines ~XXXX-XXXX in Strategy Maintenance module)

---

### Iteration 3.6: Admin UI - LTH PVR Variation Management ✅

**Tasks:**

- [ ] Create "LTH PVR Strategy Panel" in Strategy Maintenance module:

  ```html
  <div id="lthPvrStrategyPanel" class="strategy-panel" style="display:block;">
    <h3>LTH PVR Strategy Variations</h3>

    <!-- Variation Cards -->
    <div class="variation-cards">
      <!-- Card for Progressive -->
      <div class="variation-card" data-variation="progressive">
        <div class="card-header">
          <h4>Progressive</h4>
          <span class="badge-production" style="display:none;">PRODUCTION</span>
        </div>
        <div class="card-body">
          <p>Higher Risk/Reward - Earlier pause, larger buys</p>
          <div class="metrics-grid">
            <div><label>Bear Pause Entry:</label> <span class="pause-enter">+1.5σ</span></div>
            <div><label>Bear Pause Exit:</label> <span class="pause-exit">-0.5σ</span></div>
            <div><label>B1 (Buy Tier 1):</label> <span class="b1">25.00%</span></div>
            <div><label>B6 (Sell Tier 1):</label> <span class="b6">0.10%</span></div>
          </div>
          <button onclick="viewVariationDetails('progressive')">View Details</button>
          <button onclick="runSimulation('progressive')">Run Simulation</button>
          <button onclick="optimizeVariation('progressive')">Optimize</button>
        </div>
      </div>

      <!-- Repeat for Balanced & Conservative -->
    </div>

    <!-- Simulation Results Panel (hidden by default) -->
    <div id="simulationResultsPanel" style="display:none;">
      <!-- Results populated dynamically -->
    </div>

    <!-- Optimization Results Panel (hidden by default) -->
    <div id="optimizationResultsPanel" style="display:none;">
      <!-- Results populated dynamically -->
    </div>
  </div>
  ```
- [ ] JavaScript functions:

  ```javascript
  async function loadLthPvrVariations() {
    const { data, error } = await supabase
      .from("strategy_variation_templates")
      .select("*")
      .eq("org_id", globalOrgId)
      .eq("is_active", true)
      .order("sort_order");

    // Populate variation cards with data
    data.forEach(v => {
      const card = document.querySelector(`.variation-card[data-variation="${v.variation_name}"]`);
      card.querySelector(".pause-enter").textContent = `+${v.bear_pause_enter_sigma}σ`;
      card.querySelector(".pause-exit").textContent = `${v.bear_pause_exit_sigma}σ`;
      card.querySelector(".b1").textContent = `${(v.b1 * 100).toFixed(2)}%`;
      card.querySelector(".b6").textContent = `${(v.b6 * 100).toFixed(2)}%`;

      if (v.is_production) {
        card.querySelector(".badge-production").style.display = "inline";
      }
    });
  }

  async function runSimulation(variationName) {
    // Show loading spinner
    // Call ef_run_lth_pvr_simulator
    // Display results in simulationResultsPanel
  }

  async function optimizeVariation(variationName) {
    // Show optimization modal with parameter ranges UI
    // Call ef_optimize_lth_pvr_strategy
    // Display results in optimizationResultsPanel
  }
  ```
- [ ] Styling (Tailwind utility classes):

  - Variation cards: Grid layout (3 columns on desktop)
  - Production badge: Green background, white text
  - Metrics grid: 2-column layout with labels

**Deliverable:** Variation management UI with simulation/optimization triggers

**Files Modified:**

- `ui/Advanced BTC DCA Strategy.html`

---

### Iteration 3.7: Admin UI - Simulation Results Display ✅

**Tasks:**

- [ ] Implement `runSimulation()` function:

  ```javascript
  async function runSimulation(variationName) {
    const panel = document.getElementById("simulationResultsPanel");
    panel.style.display = "block";
    panel.innerHTML = '<div class="spinner">Running simulation...</div>';

    // Get date range from UI inputs (default: 2020-2025)
    const startDate = document.getElementById("simStartDate").value;
    const endDate = document.getElementById("simEndDate").value;
    const upfront = parseFloat(document.getElementById("simUpfront").value);
    const monthly = parseFloat(document.getElementById("simMonthly").value);

    // Get variation ID
    const { data: variations } = await supabase
      .from("strategy_variation_templates")
      .select("id")
      .eq("org_id", globalOrgId)
      .eq("variation_name", variationName)
      .single();

    // Call simulator edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/ef_run_lth_pvr_simulator`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        start_date: startDate,
        end_date: endDate,
        upfront_contrib: upfront,
        monthly_contrib: monthly,
        variation_ids: [variations.id]
      })
    });

    const results = await response.json();

    // Display results
    panel.innerHTML = `
      <h4>Simulation Results: ${variationName}</h4>
      <div class="results-grid">
        <div class="metric-card">
          <label>Final NAV</label>
          <span class="value">$${results[variationName].finalNav.toLocaleString()}</span>
        </div>
        <div class="metric-card">
          <label>Total ROI</label>
          <span class="value">${results[variationName].totalRoi.toFixed(2)}%</span>
        </div>
        <div class="metric-card">
          <label>CAGR</label>
          <span class="value">${results[variationName].cagr.toFixed(2)}%</span>
        </div>
        <div class="metric-card">
          <label>Max Drawdown</label>
          <span class="value text-red">${results[variationName].maxDrawdown.toFixed(2)}%</span>
        </div>
        <div class="metric-card">
          <label>Total Trades</label>
          <span class="value">${results[variationName].totalTrades}</span>
        </div>
      </div>
      <canvas id="simChart"></canvas>
    `;

    // Render Chart.js chart with NAV over time
    renderSimulationChart(results[variationName].ledger);
  }
  ```
- [ ] Add date range / contribution inputs above variation cards:

  ```html
  <div class="simulation-inputs">
    <label>Start Date: <input type="date" id="simStartDate" value="2020-01-01"></label>
    <label>End Date: <input type="date" id="simEndDate" value="2025-12-31"></label>
    <label>Upfront: <input type="number" id="simUpfront" value="10000" step="1000"></label>
    <label>Monthly: <input type="number" id="simMonthly" value="5000" step="500"></label>
  </div>
  ```
- [ ] Implement `renderSimulationChart()` using Chart.js (NAV over time)

**Deliverable:** Simulation results displayed with chart

**Files Modified:**

- `ui/Advanced BTC DCA Strategy.html`

---

### Iteration 3.8: Admin UI - Optimization Workflow ✅

**Tasks:**

- [ ] Implement `optimizeVariation()` function:

  ```javascript
  async function optimizeVariation(variationName) {
    // Show optimization modal
    const modal = document.getElementById("optimizationModal");
    modal.style.display = "block";

    // Populate modal with current variation config
    const { data: variation } = await supabase
      .from("strategy_variation_templates")
      .select("*")
      .eq("org_id", globalOrgId)
      .eq("variation_name", variationName)
      .single();

    // Pre-fill form with +/- 20% ranges
    document.getElementById("optVariationName").value = variationName;
    document.getElementById("optVariationId").value = variation.id;
    document.getElementById("optObjective").value = "sharpe";  // Default

    // Bear pause ranges (current +/- 0.5σ)
    const enterMin = variation.bear_pause_enter_sigma - 0.5;
    const enterMax = variation.bear_pause_enter_sigma + 0.5;
    document.getElementById("optBearEnterRange").value = `${enterMin}, ${enterMax}`;

    // B1-B11 ranges (current +/- 20%)
    document.getElementById("optB1Range").value = generateRange(variation.b1, 0.2);
    // ... repeat for b2-b11
  }

  async function runOptimization() {
    const variationId = document.getElementById("optVariationId").value;
    const objective = document.getElementById("optObjective").value;

    // Parse ranges from comma-separated inputs
    const bearEnterRange = document.getElementById("optBearEnterRange").value
      .split(",").map(v => parseFloat(v.trim()));

    // Show loading spinner
    document.getElementById("optimizationResultsPanel").innerHTML = 
      '<div class="spinner">Optimizing parameters (this may take 2-5 minutes)...</div>';

    // Call optimizer edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/ef_optimize_lth_pvr_strategy`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        variation_id: variationId,
        start_date: document.getElementById("simStartDate").value,
        end_date: document.getElementById("simEndDate").value,
        upfront_contrib: parseFloat(document.getElementById("simUpfront").value),
        monthly_contrib: parseFloat(document.getElementById("simMonthly").value),
        optimize_bear_pause: true,
        optimize_order_sizes: true,
        bear_pause_enter_range: bearEnterRange,
        // ... other ranges
        objective: objective
      })
    });

    const results = await response.json();

    // Hide modal, show results panel
    document.getElementById("optimizationModal").style.display = "none";
    displayOptimizationResults(results);
  }
  ```
- [ ] Create optimization modal (hidden by default):

  ```html
  <div id="optimizationModal" class="modal" style="display:none;">
    <div class="modal-content">
      <h3>Optimize Strategy Parameters</h3>
      <input type="hidden" id="optVariationId">
      <input type="hidden" id="optVariationName">

      <label>Optimization Objective:
        <select id="optObjective">
          <option value="sharpe">Sharpe Ratio (CAGR / Drawdown)</option>
          <option value="nav">Final NAV</option>
          <option value="cagr">CAGR</option>
          <option value="roi">Total ROI</option>
        </select>
      </label>

      <label>Bear Pause Entry Range (σ):
        <input type="text" id="optBearEnterRange" placeholder="1.0, 1.5, 2.0, 2.5">
      </label>

      <label>Bear Pause Exit Range (σ):
        <input type="text" id="optBearExitRange" placeholder="-2.0, -1.5, -1.0, -0.5">
      </label>

      <details>
        <summary>Order Size Ranges (B1-B11)</summary>
        <!-- Expandable section with inputs for each B1-B11 range -->
        <label>B1 Range: <input type="text" id="optB1Range"></label>
        <!-- ... B2-B11 -->
      </details>

      <button onclick="runOptimization()">Start Optimization</button>
      <button onclick="closeOptimizationModal()">Cancel</button>
    </div>
  </div>
  ```
- [ ] Implement `displayOptimizationResults()`:

  ```javascript
  function displayOptimizationResults(results) {
    const panel = document.getElementById("optimizationResultsPanel");
    panel.style.display = "block";

    panel.innerHTML = `
      <h4>Optimization Results</h4>

      <!-- Current vs Optimized Comparison -->
      <div class="comparison-table">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Current</th>
              <th>Optimized</th>
              <th>Improvement</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Final NAV</td>
              <td>$${results.current.metrics.finalNav.toLocaleString()}</td>
              <td>$${results.optimized.metrics.finalNav.toLocaleString()}</td>
              <td class="${results.improvement.navDelta > 0 ? 'text-green' : 'text-red'}">
                ${results.improvement.navDelta > 0 ? '+' : ''}${results.improvement.navDelta.toLocaleString()}
                (${((results.improvement.navDelta / results.current.metrics.finalNav) * 100).toFixed(2)}%)
              </td>
            </tr>
            <!-- Repeat for ROI, CAGR, Max DD -->
          </tbody>
        </table>
      </div>

      <!-- Parameter Changes -->
      <div class="parameter-changes">
        <h5>Recommended Parameter Changes</h5>
        <table>
          <thead>
            <tr><th>Parameter</th><th>Current</th><th>Optimized</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Bear Pause Entry</td>
              <td>+${results.current.config.bearPauseEnterSigma}σ</td>
              <td>+${results.optimized.config.bearPauseEnterSigma}σ</td>
            </tr>
            <tr>
              <td>Bear Pause Exit</td>
              <td>${results.current.config.bearPauseExitSigma}σ</td>
              <td>${results.optimized.config.bearPauseExitSigma}σ</td>
            </tr>
            <tr>
              <td>B1 (Buy Tier 1)</td>
              <td>${(results.current.config.B.B1 * 100).toFixed(3)}%</td>
              <td>${(results.optimized.config.B.B1 * 100).toFixed(3)}%</td>
            </tr>
            <!-- Show only changed parameters, or top 5 -->
          </tbody>
        </table>
      </div>

      <!-- Action Buttons -->
      <div class="action-buttons">
        <button onclick="applyOptimizedConfig('${results.optimization_run_id}')" 
                class="btn-primary">
          Apply Optimized Parameters
        </button>
        <button onclick="discardOptimizationResults()">
          Discard
        </button>
      </div>
    `;
  }
  ```

**Deliverable:** Optimization workflow with approval UI

**Files Modified:**

- `ui/Advanced BTC DCA Strategy.html`

---

### Iteration 3.9: Admin UI - Apply Optimized Parameters ✅

**Tasks:**

- [ ] Implement `applyOptimizedConfig()` function:

  ```javascript
  async function applyOptimizedConfig(optimizationRunId) {
    // Confirmation dialog
    const confirmed = confirm(
      "Are you sure you want to apply these optimized parameters?\n\n" +
      "This will update the variation template and affect ALL customers using this variation.\n\n" +
      "Changes take effect at next trading cycle (03:00 UTC tomorrow)."
    );

    if (!confirmed) return;

    // Load optimization results from database
    const { data: optRun } = await supabase
      .from("optimization_runs")
      .select("*")
      .eq("id", optimizationRunId)
      .single();

    const optimizedConfig = optRun.best_config;

    // Update variation template
    const { error } = await supabase
      .from("strategy_variation_templates")
      .update({
        bear_pause_enter_sigma: optimizedConfig.bearPauseEnterSigma,
        bear_pause_exit_sigma: optimizedConfig.bearPauseExitSigma,
        b1: optimizedConfig.B.B1,
        b2: optimizedConfig.B.B2,
        b3: optimizedConfig.B.B3,
        b4: optimizedConfig.B.B4,
        b5: optimizedConfig.B.B5,
        b6: optimizedConfig.B.B6,
        b7: optimizedConfig.B.B7,
        b8: optimizedConfig.B.B8,
        b9: optimizedConfig.B.B9,
        b10: optimizedConfig.B.B10,
        b11: optimizedConfig.B.B11,
        updated_at: new Date().toISOString()
      })
      .eq("id", optRun.variation_id);

    if (error) {
      alert("Failed to apply parameters: " + error.message);
      return;
    }

    // Log alert event
    await supabase.rpc("log_alert_event", {
      p_org_id: globalOrgId,
      p_component: "Admin UI - Strategy Maintenance",
      p_severity: "info",
      p_message: `Applied optimized parameters to ${optRun.variation_name} variation`,
      p_context: {
        optimization_run_id: optimizationRunId,
        improvement: {
          nav_delta: optRun.best_score,
          param_changes: optimizedConfig
        }
      }
    });

    // Show success message
    alert("Parameters applied successfully! Changes will take effect at next trading cycle.");

    // Reload variation cards
    loadLthPvrVariations();

    // Hide optimization results panel
    document.getElementById("optimizationResultsPanel").style.display = "none";
  }
  ```
- [ ] Add audit trail: Update `updated_at` and create changelog entry
- [ ] Consider adding `lth_pvr.variation_parameter_history` table for rollback:

  ```sql
  CREATE TABLE lth_pvr.variation_parameter_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variation_id UUID REFERENCES lth_pvr.strategy_variation_templates(id),

    -- Snapshot of parameters before change
    previous_config JSONB NOT NULL,
    new_config JSONB NOT NULL,

    -- Metadata
    changed_by UUID REFERENCES auth.users(id),
    change_reason TEXT,  -- e.g., "Optimization run abc123"
    optimization_run_id UUID REFERENCES lth_pvr.optimization_runs(id),

    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```

**Deliverable:** One-click parameter deployment with audit trail

**Files Modified:**

- `ui/Advanced BTC DCA Strategy.html`
- `supabase/migrations/20260222_create_variation_parameter_history.sql`

---

### Iteration 3.10: Admin UI - CSV Export Functionality ✅

**Tasks:**

- [ ] Add "Export to CSV" button to simulation results panel
- [ ] Implement `exportSimulationToCSV()` function:

  ```javascript
  function exportSimulationToCSV(simulationResults, variationName) {
    // Create CSV header
    const header = [
      "date", "btc_balance", "usdt_balance", "nav", "btc_price",
      "action", "amount_pct", "rule", "tier",
      "platform_fee", "performance_fee", "exchange_fee",
      "cumulative_contrib", "cumulative_fees", "roi"
    ].join(",");

    // Create CSV rows from dailyData
    const rows = simulationResults.dailyData.map(day => [
      day.date,
      day.btc_bal.toFixed(8),
      day.usdt_bal.toFixed(2),
      day.nav.toFixed(2),
      day.btc_price.toFixed(2),
      day.action,
      day.amount_pct || "",
      day.rule || "",
      day.tier || "",
      day.platform_fee || 0,
      day.performance_fee || 0,
      day.exchange_fee || 0,
      day.cumulative_contrib.toFixed(2),
      day.cumulative_fees.toFixed(2),
      day.roi.toFixed(4)
    ].join(","));

    // Combine header + rows
    const csv = [header, ...rows].join("\n");

    // Create download link
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lth_pvr_simulation_${variationName}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  ```
- [ ] Add button to results panel:

  ```html
  <button onclick="exportSimulationToCSV(currentResultsProgressive, 'progressive')" 
          class="btn-secondary">
    📄 Export Progressive to CSV
  </button>
  ```
- [ ] Test CSV export:
    - Verify all columns present
    - Open in Excel/Google Sheets
    - Check date formatting, decimal precision

**Deliverable:** CSV export functionality for simulation results

**Files Modified:**

- `ui/Advanced BTC DCA Strategy.html`

---

### Iteration 3.11: Admin UI - View Parameter History & Rollback ✅

**Tasks:**

- [ ] Add "View History" button next to "Optimize" button on each variation card
- [ ] Create parameter history modal:

  ```html
  <div id="parameterHistoryModal" class="modal" style="display:none;">
    <div class="modal-content" style="width: 90%; max-width: 1200px;">
      <h3>Parameter History: <span id="historyVariationName"></span></h3>
      
      <table id="parameterHistoryTable">
        <thead>
          <tr>
            <th>Date</th>
            <th>Changed By</th>
            <th>Change Type</th>
            <th>B1</th>
            <th>B6</th>
            <th>Momo Len</th>
            <th>NAV Impact</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <!-- Populated by loadParameterHistory() -->
        </tbody>
      </table>
      
      <button onclick="closeHistoryModal()">Close</button>
    </div>
  </div>
  ```
- [ ] Implement `loadParameterHistory()` function:

  ```javascript
  async function loadParameterHistory(variationId, variationName) {
    document.getElementById("historyVariationName").textContent = variationName;
    
    // Query parameter_history table
    const { data: history } = await supabase
      .from("variation_parameter_history")
      .select(`
        *,
        changed_by_user:auth.users!changed_by(email)
      `)
      .eq("variation_id", variationId)
      .order("changed_at", { ascending: false })
      .limit(50);
    
    // Populate table
    const tbody = document.querySelector("#parameterHistoryTable tbody");
    tbody.innerHTML = history.map(h => `
      <tr>
        <td>${new Date(h.changed_at).toLocaleString()}</td>
        <td>${h.changed_by_user?.email || 'System'}</td>
        <td>${h.change_type}</td>
        <td>${(h.new_config.B.B1 * 100).toFixed(3)}%</td>
        <td>${(h.new_config.B.B6 * 100).toFixed(3)}%</td>
        <td>${h.new_config.momoLength} days</td>
        <td>${h.impact_metrics?.navDelta ? '+' + h.impact_metrics.navDelta.toLocaleString() : 'N/A'}</td>
        <td>
          <button onclick="rollbackToConfig('${h.id}')" class="btn-small">
            ↺ Rollback
          </button>
        </td>
      </tr>
    `).join("");
    
    document.getElementById("parameterHistoryModal").style.display = "block";
  }
  ```
- [ ] Implement `rollbackToConfig()` function:

  ```javascript
  async function rollbackToConfig(historyId) {
    const confirmed = confirm(
      "Are you sure you want to rollback to this configuration?\n\n" +
      "This will revert all parameter changes made after this point.\n\n" +
      "Changes take effect at next trading cycle (03:00 UTC tomorrow)."
    );
    
    if (!confirmed) return;
    
    // Load historical config
    const { data: historyRecord } = await supabase
      .from("variation_parameter_history")
      .select("*")
      .eq("id", historyId)
      .single();
    
    const oldConfig = historyRecord.new_config;
    
    // Update variation template
    const { error } = await supabase
      .from("strategy_variation_templates")
      .update({
        bear_pause_enter_sigma: oldConfig.bearPauseEnterSigma,
        bear_pause_exit_sigma: oldConfig.bearPauseExitSigma,
        b1: oldConfig.B.B1,
        b2: oldConfig.B.B2,
        // ... b3-b11
        momentum_length: oldConfig.momoLength,
        momentum_threshold: oldConfig.momoThreshold,
        updated_at: new Date().toISOString()
      })
      .eq("id", historyRecord.variation_id);
    
    if (error) {
      alert("Rollback failed: " + error.message);
      return;
    }
    
    // Log rollback action
    await supabase.from("variation_parameter_history").insert({
      variation_id: historyRecord.variation_id,
      change_type: "rollback",
      old_config: historyRecord.new_config,  // Current becomes old
      new_config: oldConfig,                 // Historical becomes new
      changed_by: (await supabase.auth.getUser()).data.user.id,
      reason: `Rollback to ${new Date(historyRecord.changed_at).toLocaleString()}`
    });
    
    alert("✅ Parameters rolled back successfully!");
    closeHistoryModal();
    loadLthPvrVariations();  // Refresh variation cards
  }
  ```
- [ ] Add "View History" button to variation cards:

  ```html
  <button onclick="loadParameterHistory('${variation.id}', '${variation.display_name}')" 
          class="btn-secondary">
    📅 View History
  </button>
  ```

**Deliverable:** Parameter history viewer with rollback functionality

**Files Modified:**

- `ui/Advanced BTC DCA Strategy.html`

---

## Phase 4: Testing & Validation (Quality Assurance)

**Goal:** Ensure all implementations produce consistent, reliable results  

**Duration:** 3 iterations  

**Dependencies:** Phases 1-3 complete

### Iteration 4.1: Regression Testing - Logic Consistency ✅

**Test Suite 1: Cross-Implementation Consistency**

**Test Case 1.1: Baseline Simulation (Progressive Variation)**

- **Input:** 2020-2025, $10K upfront, $1K monthly
- **Variations:** Progressive (CURRENT PRODUCTION params)
- **Expected:** NAV matches historical Python output (archived reference)
- **Tolerance:** ±0.5% (rounding differences acceptable)
- **Status:** [ ] PASS / [ ] FAIL

**Test Case 1.2: Bear Pause Trigger Validation**

- **Input:** Price crosses +2.0σ on day 100, drops to -1.0σ on day 200 (Progressive behavior)
- **Expected:** Bear pause activates day 100, deactivates day 200
- **Verify:** `customer_state_daily.bear_pause = true` from days 100-199
- **Status:** [ ] PASS / [ ] FAIL

**Test Case 1.3: Order Size Application**

- **Input:** Price at -1.5σ (Base 2 tier)
- **Expected:** Buy order = 21.397% of USDT balance (B2 for Progressive)
- **Verify:** `decisions_daily.amount_pct = 0.21397`
- **Status:** [ ] PASS / [ ] FAIL

**Test Case 1.4: Variation-Specific Behavior**

- **Input:** Same date range, all 3 variations
- **Expected:** Progressive exits pause at -1.0σ, Balanced at -0.75σ, Conservative at mean
- **Verify:** `bear_pause` flag clears at different thresholds per variation
- **Status:** [ ] PASS / [ ] FAIL

---

### Iteration 4.2: Integration Testing - Simulator & Optimizer ✅

**Test Suite 2: Edge Function Integration**

**Test Case 2.1: Simulator API**

- **Method:** POST to `ef_run_lth_pvr_simulator`
- **Input:** 3 variation IDs, 2020-2025
- **Expected:** 3 results returned, execution time < 30 seconds
- **Status:** [ ] PASS / [ ] FAIL

**Test Case 2.2: Optimizer API**

- **Method:** POST to `ef_optimize_lth_pvr_strategy`
- **Input:** Progressive variation, 5×5 grid (25 combinations)
- **Expected:** Best config returned, improvement metrics calculated
- **Validation:** Re-run simulation with optimized config, verify metrics match
- **Status:** [ ] PASS / [ ] FAIL

**Test Case 2.3: Admin UI End-to-End**

- **Workflow:**

  1. Load Strategy Maintenance module
  2. Click "Optimize" on Progressive variation
  3. Set date range 2021-2024
  4. Run optimization (grid search)
  5. Review results (improvement shown)
  6. Click "Apply Optimized Parameters"
  7. Verify database updated
  8. Next day: Verify `ef_generate_decisions` uses new params
- **Status:** [ ] PASS / [ ] FAIL

---

### Iteration 4.3: Production Shadow Mode & Cutover ✅

**Test Suite 3: Production Validation**

**Test Case 3.1: Shadow Mode - 7 Day Parallel Run**

- **Setup:** Run new logic alongside old logic (log both, execute old)
- **Duration:** 7 trading days
- **Comparison:** For each customer/day:
    - Compare `action` (BUY/SELL/HOLD)
    - Compare `amount_pct`
    - Compare `rule` name
- **Expected:** 100% match for customers on 'progressive' variation (CURRENT PRODUCTION params)
- **Log discrepancies:** Any mismatch logged to `lth_pvr.alert_events` with severity=critical
- **Status:** [ ] PASS / [ ] FAIL

**Test Case 3.2: Cutover Dry Run**

- **Simulate cutover:**

  1. Set 'progressive' as `is_production = true` (already default)
  2. Migrate 1 test customer to 'balanced' (testing new variation)
  3. Run `ef_generate_decisions` manually
  4. Verify test customer gets balanced params, others get progressive
- **Status:** [ ] PASS / [ ] FAIL

**Test Case 3.3: Rollback Plan**

- **Scenario:** New logic causes production issue
- **Rollback Steps:**

  1. Revert `ef_generate_decisions` to v[old] (keep Git tag)
  2. Redeploy old version
  3. Verify trades resume with old logic
- **Document:** Rollback procedure in `DEPLOYMENT_COMPLETE.md`
- **Status:** [ ] DOCUMENTED

**Cutover Decision:**

- [ ] All regression tests PASS
- [ ] All integration tests PASS
- [ ] 7-day shadow mode shows 0 discrepancies
- [ ] Rollback plan documented and tested

- **Cutover Date:** [To be determined after testing]

---

## Deployment Checklist

### Phase 1 Deployment

- [ ] Deploy `ef_generate_decisions` (with shared logic module)
- [ ] Deploy `ef_bt_execute` (with shared logic module)
- [ ] Deploy `ef_execute_public_backtests` (no changes, uses ef_bt_execute)
- [ ] Archive Python simulator to `docs/legacy/`
- [ ] Update SDD v0.6.51 change log
- [ ] Create test case document: `LTH_PVR_Logic_Centralization_Test_Cases.md`

### Phase 2 Deployment

- [ ] Apply migration: `20260221_create_lth_pvr_strategy_variations.sql`
- [ ] Apply migration: `20260221_seed_lth_pvr_variations.sql` (with correct org_id)
- [ ] Apply migration: `20260221_migrate_customers_to_progressive.sql`
- [ ] Verify seed data via SQL Editor: `SELECT * FROM lth_pvr.strategy_variation_templates;`
- [ ] Verify customer migration: `SELECT COUNT(*) FROM customer_strategies WHERE strategy_variation_id IS NULL;` (should be 0)
- [ ] Update SDD v0.6.52 change log

### Phase 3 Deployment

- [ ] Apply migration: `20260222_create_simulation_runs_tables.sql` (optional persistence)
- [ ] Apply migration: `20260222_create_optimization_runs_table.sql`
- [ ] Apply migration: `20260222_create_variation_parameter_history.sql`
- [ ] Apply migration: `20260222_add_bear_pause_config_to_bt_params.sql`
- [ ] Deploy `ef_run_lth_pvr_simulator` with `--no-verify-jwt`
- [ ] Deploy `ef_optimize_lth_pvr_strategy` with `--no-verify-jwt`
- [ ] Update Admin UI (upload new HTML file to hosting)
- [ ] Test simulator via Admin UI (run all 3 variations)
- [ ] Test optimizer via Admin UI (optimize Progressive)
- [ ] Test CSV export
- [ ] Test View History and Rollback
- [ ] Update SDD v0.6.53 change log
- [ ] Create test case documents:
    - `LTH_PVR_Simulator_Test_Cases.md`
    - `LTH_PVR_Optimizer_Test_Cases.md`
    - `Strategy_Variation_Management_Test_Cases.md`

### Phase 4 Deployment

- [ ] Enable shadow mode (7 days)
- [ ] Review shadow mode logs daily
- [ ] Run all regression tests
- [ ] Run all integration tests
- [ ] Cutover decision meeting
- [ ] Production cutover (if approved)
- [ ] Monitor first trading day (03:00-17:00 UTC)
- [ ] Update SDD v0.6.54 change log

### Phase 5 Deployment

- [ ] Rename `docs/LTH_PVR_AGGRESSIVE_STRATEGY.md` → `docs/LTH_PVR_STRATEGY_VARIATIONS.md`
- [ ] Update document content (all 3 variations, comparison matrix)
- [ ] Update cross-references in:
    - `docs/SDD_v0.6.md`
    - `docs/ADMIN_OPERATIONS_GUIDE.md`
    - `.github/copilot-instructions.md`
    - Website (if referencing strategy docs)
- [ ] Review and publish updated documentation
- [ ] Update SDD v0.6.55 change log

### Phase 6 Deployment

- [ ] Apply migration: `20260223_create_simulation_runs_tables.sql` (if not done in Phase 3)
- [ ] Deploy updated `ef_run_lth_pvr_simulator` (with std_dca support)
- [ ] Update Admin UI (std_dca comparison charts/tables)
- [ ] Test std_dca simulation results vs existing back-tester
- [ ] Test comparison charts render correctly
- [ ] Test CSV export includes std_dca data
- [ ] Update SDD v0.6.56 change log

---

## Phase 5: Strategy Documentation Update

**Goal:** Rename and expand strategy document to cover all 3 variations  

**Duration:** 1 iteration  

**Dependencies:** Phase 1-4 complete

### Iteration 5.1: Update LTH PVR Strategy Documentation ✅

**Tasks:**

- [ ] Rename file: `docs/LTH_PVR_AGGRESSIVE_STRATEGY.md` → `docs/LTH_PVR_STRATEGY_VARIATIONS.md`
- [ ] Update document structure:

  ```markdown
  # LTH PVR Strategy Variations

  ## Overview
  [Introduction to LTH PVR strategy family]

  ## The Three Variations

  ### Progressive (Current Production)
  - **Risk Profile:** Moderate-High
  - **Bear Pause:** Enter +2.0σ, Exit -1.0σ
  - **Order Sizes:** B1=22.796%, B6=0.157%
  - **Best For:** Investors comfortable with volatility, seeking maximum accumulation in bear markets
  - **Historical Performance:** [2020-2025 backtest results]

  ### Balanced
  - **Risk Profile:** Moderate
  - **Bear Pause:** Enter +2.0σ, Exit -0.75σ
  - **Order Sizes:** B1=20.000%, B6=0.200%
  - **Best For:** Investors seeking balanced risk/reward profile
  - **Expected Behavior:** Earlier re-entry than Progressive

  ### Conservative
  - **Risk Profile:** Low-Moderate
  - **Bear Pause:** Enter +2.0σ, Exit at mean
  - **Order Sizes:** B1=18.000%, B6=0.300%
  - **Best For:** Risk-averse investors prioritizing capital preservation
  - **Expected Behavior:** Earliest re-entry, smaller position sizes

  ## Comparison Matrix
  [Table comparing all 3 variations across key metrics]

  ## Core Trading Rules (All Variations)
  [11 trading tiers, momentum filter, retrace exceptions - same as before]

  ## Choosing Your Variation
  [Decision guide based on risk tolerance, time horizon, capital size]

  ## Technical Details
  [Parameter definitions, fee structure, backtesting framework]
  ```
- [ ] Add comparison table:

  ```markdown
  | Feature          | Progressive      | Balanced         | Conservative     |
  |------------------|------------------|------------------|------------------|
  | Bear Pause Entry | +2.0σ            | +2.0σ            | +2.0σ            |
  | Bear Pause Exit  | -1.0σ            | -0.75σ           | Mean (0σ)        |
  | Max Buy Size     | 22.8%            | 20.0%            | 18.0%            |
  | Min Sell Size    | 0.16%            | 0.20%            | 0.30%            |
  | Risk Level       | ⭐⭐⭐⭐            | ⭐⭐⭐              | ⭐⭐               |
  | Accumulation     | Aggressive       | Moderate         | Cautious         |
  | Production       | ✅ Current       | 🔒 Future       | 🔒 Future       |
  ```
- [ ] Update references in other docs:
    - `docs/SDD_v0.6.md` - Update strategy docs link
    - `docs/ADMIN_OPERATIONS_GUIDE.md` - Reference new doc name
    - `.github/copilot-instructions.md` - Update doc path
- [ ] Update SDD v0.6.55 change log

**Deliverable:** Comprehensive strategy documentation covering all 3 variations

**Files Created:**

- `docs/LTH_PVR_STRATEGY_VARIATIONS.md` (renamed from `LTH_PVR_AGGRESSIVE_STRATEGY.md`)

**Files Modified:**

- `docs/SDD_v0.6.md`
- `docs/ADMIN_OPERATIONS_GUIDE.md`
- `.github/copilot-instructions.md`

---

## Phase 6: Standard DCA Comparison

**Goal:** Add std_dca comparison capability to simulator (like back-tester)  

**Duration:** 2 iterations  

**Dependencies:** Phase 1-5 complete

### Iteration 6.1: Extend Simulator for std_dca ✅

**Tasks:**

- [ ] Update `supabase/functions/_shared/lth_pvr_simulator.ts`:
    - Add `runStdDcaSimulation()` function
    - Logic: Buy fixed amount ($monthly_contrib) on 1st of each month at average monthly price
    - Track BTC balance, USDT balance, NAV over time
    - Apply same fees as LTH PVR (platform, performance, exchange)
- [ ] Update `ef_run_lth_pvr_simulator` to return std_dca results:

  ```typescript
  {
    lth_pvr: {
      progressive: { summary, dailyData },
      balanced: { summary, dailyData },
      conservative: { summary, dailyData }
    },
    std_dca: {
      summary: { finalNav, roi, cagr, maxDrawdown, totalFees },
      dailyData: [ ... ]
    },
    comparison: {
      progressive_vs_std: { navDelta: +130000, roiDelta: +32 },
      balanced_vs_std: { navDelta: +95000, roiDelta: +24 },
      conservative_vs_std: { navDelta: +68000, roiDelta: +18 }
    }
  }
  ```
- [ ] Create optional persistence tables (if save_results=true):

  ```sql
  CREATE TABLE lth_pvr.simulation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    run_type TEXT DEFAULT 'manual',  -- 'manual' | 'optimization'
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    upfront_contrib NUMERIC NOT NULL,
    monthly_contrib NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
  );

  CREATE TABLE lth_pvr.simulation_runs_daily (
    id BIGSERIAL PRIMARY KEY,
    simulation_run_id UUID REFERENCES lth_pvr.simulation_runs(id) ON DELETE CASCADE,
    variation_name TEXT,  -- 'progressive' | 'balanced' | 'conservative' | 'std_dca'
    date DATE NOT NULL,
    btc_bal NUMERIC(18,8),
    usdt_bal NUMERIC(18,2),
    nav NUMERIC(18,2),
    btc_price NUMERIC(18,2),
    action TEXT,
    amount_pct NUMERIC(10,5),
    rule TEXT,
    tier TEXT,
    platform_fee NUMERIC(18,2),
    performance_fee NUMERIC(18,2),
    exchange_fee_btc NUMERIC(18,8),
    exchange_fee_usdt NUMERIC(18,2),
    cumulative_contrib NUMERIC(18,2),
    cumulative_fees NUMERIC(18,2),
    UNIQUE(simulation_run_id, variation_name, date)
  );

  CREATE INDEX idx_simulation_runs_daily_run ON lth_pvr.simulation_runs_daily(simulation_run_id);
  ```
- [ ] Test std_dca simulation:
    - Compare results to existing `lth_pvr.std_dca_balances_daily` table
    - Verify monthly buy logic (1st of month)
    - Confirm NAV calculation matches

**Deliverable:** Simulator returns std_dca comparison alongside LTH PVR variations

**Files Modified:**

- `supabase/functions/_shared/lth_pvr_simulator.ts`
- `supabase/functions/ef_run_lth_pvr_simulator/index.ts`

**Files Created:**

- `supabase/migrations/20260223_create_simulation_runs_tables.sql`

---

### Iteration 6.2: Admin UI - std_dca Comparison Charts ✅

**Tasks:**

- [ ] Update simulation results panel to show std_dca:

  ```html
  <div class="comparison-section">
    <h4>LTH PVR vs Standard DCA</h4>
    
    <!-- Chart: NAV over time (4 lines: Progressive, Balanced, Conservative, std_dca) -->
    <canvas id="comparisonChart"></canvas>
    
    <!-- Metrics Table -->
    <table>
      <thead>
        <tr>
          <th>Strategy</th>
          <th>Final NAV</th>
          <th>ROI</th>
          <th>CAGR</th>
          <th>Max DD</th>
          <th>vs std_dca</th>
        </tr>
      </thead>
      <tbody>
        <tr class="highlight-row">
          <td>Progressive</td>
          <td>$850,000</td>
          <td>650%</td>
          <td>48%</td>
          <td>-58%</td>
          <td class="text-green">+$130,000 (+18%)</td>
        </tr>
        <tr>
          <td>Balanced</td>
          <td>$815,000</td>
          <td>620%</td>
          <td>45%</td>
          <td>-52%</td>
          <td class="text-green">+$95,000 (+13%)</td>
        </tr>
        <tr>
          <td>Conservative</td>
          <td>$788,000</td>
          <td>588%</td>
          <td>42%</td>
          <td>-45%</td>
          <td class="text-green">+$68,000 (+9%)</td>
        </tr>
        <tr class="baseline-row">
          <td>Standard DCA</td>
          <td>$720,000</td>
          <td>570%</td>
          <td>40%</td>
          <td>-67%</td>
          <td>-</td>
        </tr>
      </tbody>
    </table>
  </div>
  ```
- [ ] Implement `renderComparisonChart()` using Chart.js:

  ```javascript
  function renderComparisonChart(results) {
    const ctx = document.getElementById("comparisonChart").getContext("2d");
    
    new Chart(ctx, {
      type: "line",
      data: {
        labels: results.lth_pvr.progressive.dailyData.map(d => d.date),
        datasets: [
          {
            label: "Progressive (LTH PVR)",
            data: results.lth_pvr.progressive.dailyData.map(d => d.nav),
            borderColor: "#10b981",  // Green
            borderWidth: 3
          },
          {
            label: "Balanced (LTH PVR)",
            data: results.lth_pvr.balanced.dailyData.map(d => d.nav),
            borderColor: "#3b82f6",  // Blue
            borderWidth: 2
          },
          {
            label: "Conservative (LTH PVR)",
            data: results.lth_pvr.conservative.dailyData.map(d => d.nav),
            borderColor: "#f59e0b",  // Amber
            borderWidth: 2
          },
          {
            label: "Standard DCA",
            data: results.std_dca.dailyData.map(d => d.nav),
            borderColor: "#6b7280",  // Gray
            borderWidth: 2,
            borderDash: [5, 5]  // Dashed line
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          title: { display: true, text: "Net Asset Value Over Time" },
          legend: { position: "top" }
        },
        scales: {
          y: { beginAtZero: false, title: { display: true, text: "NAV (USD)" } },
          x: { title: { display: true, text: "Date" } }
        }
      }
    });
  }
  ```
- [ ] Update CSV export to include std_dca data
- [ ] Test UI:
    - Run simulation with all 3 variations
    - Verify chart displays 4 lines
    - Verify comparison table shows +/- deltas
    - Export CSV and confirm std_dca included

**Deliverable:** Admin UI displays std_dca comparison alongside LTH PVR variations

**Files Modified:**

- `ui/Advanced BTC DCA Strategy.html`

---

## Future Enhancements (Post-MVP)

### Phase 7: Advanced Optimization (Optuna Integration)

**Goal:** Replace grid search with sophisticated Bayesian optimization  

**Timeline:** Q2 2026  

**Tasks:**

- Create Python subprocess executor in Deno edge function
- Wrap Python Optuna script with TypeScript interface
- Add optimization constraints (monotonicity, min/max bounds)
- Implement multi-objective optimization (Pareto front)
- Add early stopping (convergence detection)

### Phase 8: Customer Portal Integration

**Goal:** Let customers view (not edit) their assigned variation  

**Timeline:** Q3 2026  

**Tasks:**

- Add "My Strategy" section to customer portal
- Display variation name, description, risk profile
- Show historical performance of their variation
- Explain why they're in that variation (risk assessment)

---

## Risks & Mitigations

### Risk 1: Optimization Takes Too Long

**Symptom:** 1000+ combinations × 5-year backtest = 10+ minutes  

**Mitigation:**

- Limit grid to 100-200 combinations max
- Cache CI bands data (don't reload per simulation)
- Use Promise.all for parallel execution (20 workers)
- Add progress indicator in UI ("45 of 100 combinations...")
- Post-MVP: Optuna converges faster (fewer iterations needed)

### Risk 2: Optimized Parameters Overfit Historical Data

**Symptom:** Great backtest, poor live performance  

**Mitigation:**

- Use walk-forward validation (multiple date ranges)
- Require improvement across 3+ time periods (2020-2022, 2021-2023, 2022-2024)
- Add "robustness score" = std dev of improvements across periods
- Manual review required before applying (no auto-deploy)

### Risk 3: Customers Accidentally Switched to Wrong Variation

**Symptom:** Conservative customer gets Progressive (higher risk)  

**Mitigation:**

- Admin-only variation assignment (customers can't self-switch)
- Confirmation dialog: "Customer X will move from Balanced → Progressive. Confirm?"
- Alert generated when variation changed (logged to `alert_events`)
- Rollback via parameter history table

### Risk 4: Production Deployment Breaks Live Trading

**Symptom:** Logic change causes errors, trades don't execute  

**Mitigation:**

- 7-day shadow mode (parallel run, log discrepancies)
- Rollback plan documented (Git tag + redeploy command)
- SMS alerts for critical errors (already implemented)
- Canary deployment: 1 test customer first, then all customers

---

## Success Metrics

### Phase 1 Success Criteria

- ✅ Zero logic discrepancies between old and new implementation
- ✅ All existing tests pass
- ✅ Python simulator archived to `docs/legacy/`
- ✅ Shared logic module imported successfully in both live trading and back-testing

### Phase 2 Success Criteria

- ✅ 3 variations seeded in database (Progressive, Balanced, Conservative)
- ✅ All customers migrated to 'progressive' variation
- ✅ No null `strategy_variation_id` in production
- ✅ RLS policies prevent unauthorized access to variations

### Phase 3 Success Criteria

- ✅ Simulator returns results in < 30 seconds (3 variations)
- ✅ Optimizer completes in < 5 minutes (reasonable grid size)
- ✅ Admin UI loads without errors
- ✅ "Apply Parameters" workflow completes successfully
- ✅ CSV export downloads valid file with all columns
- ✅ Parameter history displays correctly
- ✅ Rollback function restores previous configuration

### Phase 4 Success Criteria

- ✅ Shadow mode: 0 discrepancies over 7 days for Progressive variation
- ✅ Regression tests: All pass
- ✅ Integration tests: All pass
- ✅ Cutover: No critical alerts on day 1
- ✅ First optimized variation deployed by [target date]

### Phase 5 Success Criteria

- ✅ `LTH_PVR_STRATEGY_VARIATIONS.md` published with all 3 variations documented
- ✅ Comparison matrix accurate
- ✅ All cross-references updated in other docs

### Phase 6 Success Criteria

- ✅ std_dca simulation matches existing back-tester results
- ✅ Comparison charts display correctly in Admin UI
- ✅ CSV export includes std_dca data
- ✅ Performance: Simulator with std_dca completes in < 45 seconds

---

## Documentation Updates

**Files to Update:**

1. **`docs/SDD_v0.6.md`** - Change log entries (v0.6.51-0.6.56)
   - v0.6.51: Logic centralization (Phase 1)
   - v0.6.52: Strategy variations database schema (Phase 2)
   - v0.6.53: Simulator & optimizer (Phase 3)
   - v0.6.54: Testing & validation (Phase 4)
   - v0.6.55: Strategy documentation update (Phase 5)
   - v0.6.56: std_dca comparison (Phase 6)

2. **`docs/ADMIN_OPERATIONS_GUIDE.md`**
   - New section: "Strategy Variation Management"
   - Subsections: Running simulations, optimizing parameters, applying changes, viewing history, rollback procedures

3. **`.github/copilot-instructions.md`**
   - Python deprecation notice
   - TypeScript as canonical implementation
   - Strategy variation system overview
   - New edge functions: `ef_run_lth_pvr_simulator`, `ef_optimize_lth_pvr_strategy`

4. **`docs/LTH_PVR_STRATEGY_VARIATIONS.md`** (renamed from `LTH_PVR_AGGRESSIVE_STRATEGY.md`)
   - Complete rewrite covering all 3 variations
   - Comparison matrix
   - Decision guide for choosing variation

5. **`DEPLOYMENT_COMPLETE.md`**
   - Update with new edge functions
   - Deployment commands for simulator/optimizer
   - Database migration checklist

6. **Test case documents** (new):
   - `docs/LTH_PVR_Simulator_Test_Cases.md`
   - `docs/LTH_PVR_Optimizer_Test_Cases.md`
   - `docs/Strategy_Variation_Management_Test_Cases.md`

---

## Appendix: Database ERD (Post-Implementation)

```
public.organizations (1)
  └── lth_pvr.strategy_variation_templates (N) [org_id]
        ├── id (UUID, PK)
        ├── variation_name (progressive | balanced | conservative)
        ├── bear_pause_enter_sigma, bear_pause_exit_sigma
        ├── b1, b2, ..., b11
        └── is_production (boolean)
  
public.customer_strategies (N)
  └── strategy_variation_id → lth_pvr.strategy_variation_templates.id

lth_pvr.optimization_runs (N)
  └── variation_id → lth_pvr.strategy_variation_templates.id
  
lth_pvr.variation_parameter_history (N)
  └── variation_id → lth_pvr.strategy_variation_templates.id
```

---

**Build Plan Version:** 2.0  

**Created:** 2026-02-21  

**Last Updated:** 2026-02-21 (after user refinements)  

**Status:** READY FOR PHASE 1  

**Total Phases:** 6 (plus 2 future phases)  

**Total Iterations:** 22 (4 + 3 + 9 + 3 + 1 + 2)  

**Key Changes from v1.0:**
- Current production = Progressive (not Balanced)
- No bear pause trigger optimization (fixed per variation)
- Optimization scope: B1-B11 + momo_length + momo_threshold only
- Added CSV export functionality (Iteration 3.10)
- Added parameter history & rollback UI (Iteration 3.11)
- Removed multi-strategy support (old Phase 6)
- Added strategy documentation phase (new Phase 5)
- Added std_dca comparison phase (new Phase 6)
- **Simulator defaults: $10K upfront, $500 monthly, 2020-01-01 to today**
- **Fee handling clarified: 8bps in BTC when buying, 8bps in USDT when selling**
- Optional database persistence (save_results button)

**Next Action:** Begin Phase 1, Iteration 1.1 (Create shared logic module)