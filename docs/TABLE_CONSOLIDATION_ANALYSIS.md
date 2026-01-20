# Table Consolidation Analysis: customer_portfolios + customer_strategies

**Date:** 2026-01-20  
**Phase:** 0 - Investigation  
**Objective:** Consolidate `public.customer_portfolios` and `lth_pvr.customer_strategies` into single `public.customer_strategies` table

---

## Current State: Dual Table Architecture

### Table 1: `public.customer_portfolios`
**Location:** `supabase/sql/ddl/public.customer_portfolios.ddl.sql`  
**Purpose:** Global multi-strategy portfolio routing (UI-facing)  
**Schema:**
```sql
CREATE TABLE public.customer_portfolios (
  portfolio_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id BIGINT NOT NULL REFERENCES customer_details(customer_id),
  
  -- Strategy assignment
  strategy_code TEXT NOT NULL REFERENCES strategies(strategy_code),
  label TEXT NOT NULL,  -- e.g., "John Doe - LTH PVR BTC DCA"
  
  -- Exchange routing
  exchange TEXT NOT NULL DEFAULT 'VALR',
  exchange_account_id UUID REFERENCES lth_pvr.exchange_accounts(exchange_account_id),
  exchange_subaccount TEXT,
  
  -- Trading pair
  base_asset TEXT NOT NULL DEFAULT 'BTC',
  quote_asset TEXT NOT NULL DEFAULT 'USDT',
  
  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_customer_portfolios_org_cust 
  ON public.customer_portfolios(org_id, customer_id, strategy_code, status);
```

### Table 2: `lth_pvr.customer_strategies`
**Location:** `supabase/sql/ddl/lth_pvr.customer_strategies.ddl.sql`  
**Purpose:** LTH_PVR-specific trading pipeline inclusion (strategy-schema-specific)  
**Schema:**
```sql
CREATE TABLE lth_pvr.customer_strategies (
  customer_strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id BIGINT NOT NULL REFERENCES customer_details(customer_id),
  
  -- Strategy version (LTH_PVR-specific)
  strategy_version_id UUID NOT NULL REFERENCES lth_pvr.strategy_versions(strategy_version_id),
  
  -- Exchange routing
  exchange_account_id UUID NOT NULL REFERENCES lth_pvr.exchange_accounts(exchange_account_id),
  
  -- Trading configuration
  live_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  min_order_usdt NUMERIC(38,2) NOT NULL DEFAULT 1.00,
  
  -- Lifecycle
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Cross-reference to public.customer_portfolios
  portfolio_id UUID REFERENCES customer_portfolios(portfolio_id)
);
```

---

## Problem Analysis

### Duplication Issues

1. **Semantic Overlap:** "Portfolio" and "Strategy" used interchangeably
   - `customer_portfolios.portfolio_id` = "customer's portfolio"
   - `customer_strategies.customer_strategy_id` = "customer's strategy"
   - Both mean the same thing: A customer's subscription to a specific strategy

2. **Cross-Schema Foreign Key:** `lth_pvr.customer_strategies.portfolio_id` → `public.customer_portfolios.portfolio_id`
   - Violates design principle: Strategy-specific schemas should NOT reference public schema tables
   - Creates circular dependency

3. **Data Redundancy:**
   - Both tables have: `org_id`, `customer_id`, `exchange_account_id`, `created_at`
   - Both track lifecycle: `status` (portfolios) vs `effective_from/to` + `live_enabled` (strategies)

4. **Function Complexity:** Functions must query BOTH tables to get complete picture
   - Example: `ef_deposit_scan` queries `customer_portfolios` for `portfolio_id`, then inserts into `customer_strategies`
   - Example: `ef_generate_decisions` queries `customer_strategies.live_enabled`, but UI shows `customer_portfolios.status`

### Affected Components

**Edge Functions Querying `customer_portfolios` (10 files):**
1. `ef_monthly_statement_generator/index.ts` - Line 32 (SELECT all active portfolios)
2. `ef_generate_statement/index.ts` - Line 61 (SELECT portfolio details)
3. `ef_valr_create_subaccount/index.ts` - Lines 100, 264 (SELECT + UPDATE portfolio)
4. `ef_deposit_scan/index.ts` - Lines 112, 177, 188 (SELECT portfolio, UPDATE status)
5. `ef_confirm_strategy/index.ts` - Lines 89, 104 (SELECT existing, INSERT new)
6. `ef_balance_reconciliation/index.ts` - Line 130 (SELECT portfolio details)

**Edge Functions Querying `customer_strategies` (4 files):**
1. `ef_fee_monthly_close/index.ts` - Line 124 (SELECT strategy_version_id)
2. `ef_generate_decisions/index.ts` - Line 66 (SELECT live_enabled customers)
3. `ef_execute_orders/index.ts` - Line 35 (SELECT exchange_account_id)
4. `ef_deposit_scan/index.ts` - Line 213 (INSERT new customer_strategies row)

**RPC Functions (SQL):**
- `public.list_customer_portfolios.fn.sql` - Queries customer_portfolios + balances
- `public.get_customer_dashboard.fn.sql` - Queries customer_portfolios
- Additional RPC functions in migrations likely reference these tables

**Admin UI:**
- `ui/Advanced BTC DCA Strategy.html` - Portfolio dropdown (lines ~3820-4040)
- Queries `customer_portfolios` for display

**Customer Portal:**
- `website/customer-portal.html` - Dashboard and portfolio list
- Uses `list_customer_portfolios` RPC

---

## Consolidation Strategy

### New Unified Schema: `public.customer_strategies`

**Design Principles:**
1. ✅ Place in `public` schema (NOT `lth_pvr`) - customer routing is cross-strategy
2. ✅ Merge ALL columns from both tables
3. ✅ Add new fee configuration columns (performance_fee_rate, platform_fee_rate)
4. ✅ Use `strategy_code` as primary strategy identifier (foreign key to `public.strategies`)
5. ✅ Use `strategy_version_id` as optional LTH_PVR-specific detail (NULL for non-versioned strategies)

**Consolidated Schema:**
```sql
CREATE TABLE public.customer_strategies (
  -- Primary key
  customer_strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Organization & customer
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  customer_id BIGINT NOT NULL REFERENCES public.customer_details(customer_id),
  
  -- Strategy assignment (multi-strategy support)
  strategy_code TEXT NOT NULL REFERENCES public.strategies(strategy_code),
  strategy_version_id UUID REFERENCES lth_pvr.strategy_versions(strategy_version_id),
    -- NULL for non-versioned strategies (future ADV_DCA, etc.)
    -- NOT NULL for LTH_PVR (requires version tracking)
  
  -- Exchange routing
  exchange TEXT NOT NULL DEFAULT 'VALR',
  exchange_account_id UUID NOT NULL REFERENCES lth_pvr.exchange_accounts(exchange_account_id),
  exchange_subaccount TEXT,
  
  -- Trading configuration
  base_asset TEXT NOT NULL DEFAULT 'BTC',
  quote_asset TEXT NOT NULL DEFAULT 'USDT',
  min_order_usdt NUMERIC(20,2) DEFAULT 1.00,
  
  -- Fee configuration (strategy-specific overrides)
  performance_fee_rate NUMERIC(5,4) DEFAULT NULL,
    -- NULL = use lth_pvr.strategy_fee_defaults.performance_fee_rate (0.10 for LTH_PVR)
  platform_fee_rate NUMERIC(5,4) DEFAULT NULL,
    -- NULL = use lth_pvr.strategy_fee_defaults.platform_fee_rate (0.0075 for LTH_PVR)
  
  -- Status & lifecycle
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'active', 'paused', 'closed')),
  live_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- TRUE = included in trading pipeline (ef_generate_decisions)
    -- Distinct from status: status='active' && live_enabled=TRUE = actively trading
  
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,  -- NULL = still active
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  
  -- UI metadata
  label TEXT NOT NULL,
    -- e.g., "John Doe - LTH PVR BTC DCA"
    -- Auto-generated from customer name + strategy name on creation
  
  -- Constraints
  UNIQUE(customer_id, strategy_code, effective_from),
    -- Prevents duplicate strategies per customer
    -- Allows re-activation with new effective_from date
  
  CHECK (
    (status = 'closed' AND closed_at IS NOT NULL AND effective_to IS NOT NULL) OR
    (status != 'closed' AND closed_at IS NULL AND effective_to IS NULL)
  )
    -- Ensures closed_at and effective_to are set together for closed portfolios
);

-- Indexes for performance
CREATE INDEX idx_customer_strategies_org_cust 
  ON public.customer_strategies(org_id, customer_id, strategy_code, status);

CREATE INDEX idx_customer_strategies_live 
  ON public.customer_strategies(org_id, strategy_code, live_enabled) 
  WHERE live_enabled = TRUE;
  -- Optimizes ef_generate_decisions query

CREATE INDEX idx_customer_strategies_active 
  ON public.customer_strategies(customer_id, status) 
  WHERE status = 'active';
  -- Optimizes customer portal queries
```

---

## Column Mapping Matrix

| Column | customer_portfolios | customer_strategies | Consolidated | Source | Notes |
|--------|---------------------|---------------------|--------------|--------|-------|
| **Primary Key** | portfolio_id (UUID) | customer_strategy_id (UUID) | customer_strategy_id (UUID) | strategies | Rename from strategies table |
| **Org & Customer** |
| org_id | ✅ UUID | ✅ UUID | ✅ UUID | Both | Identical |
| customer_id | ✅ BIGINT | ✅ BIGINT | ✅ BIGINT | Both | Identical |
| **Strategy** |
| strategy_code | ✅ TEXT (FK) | ❌ | ✅ TEXT (FK) | portfolios | Primary strategy identifier |
| strategy_version_id | ❌ | ✅ UUID (FK) | ✅ UUID (FK, nullable) | strategies | LTH_PVR-specific |
| **Exchange** |
| exchange | ✅ TEXT ('VALR') | ❌ | ✅ TEXT ('VALR') | portfolios | Hardcoded for now |
| exchange_account_id | ✅ UUID (nullable FK) | ✅ UUID (NOT NULL FK) | ✅ UUID (NOT NULL FK) | strategies | Make required |
| exchange_subaccount | ✅ TEXT | ❌ | ✅ TEXT | portfolios | Display label |
| **Trading Config** |
| base_asset | ✅ TEXT ('BTC') | ❌ | ✅ TEXT ('BTC') | portfolios | Trading pair |
| quote_asset | ✅ TEXT ('USDT') | ❌ | ✅ TEXT ('USDT') | portfolios | Trading pair |
| min_order_usdt | ❌ | ✅ NUMERIC(38,2) | ✅ NUMERIC(20,2) | strategies | Minimum order size |
| **Fee Config (NEW)** |
| performance_fee_rate | ❌ | ❌ | ✅ NUMERIC(5,4) | NEW | 10% default, nullable override |
| platform_fee_rate | ❌ | ❌ | ✅ NUMERIC(5,4) | NEW | 0.75% default, nullable override |
| **Status & Lifecycle** |
| status | ✅ TEXT | ❌ | ✅ TEXT | portfolios | 'pending', 'active', 'paused', 'closed' |
| live_enabled | ❌ | ✅ BOOLEAN | ✅ BOOLEAN | strategies | Trading pipeline inclusion |
| effective_from | ❌ | ✅ DATE | ✅ DATE | strategies | Start of trading period |
| effective_to | ❌ | ✅ DATE | ✅ DATE | strategies | End of trading period (nullable) |
| created_at | ✅ TIMESTAMPTZ | ✅ TIMESTAMPTZ | ✅ TIMESTAMPTZ | Both | Record creation timestamp |
| closed_at | ✅ TIMESTAMPTZ | ❌ | ✅ TIMESTAMPTZ | portfolios | Portfolio closure timestamp |
| **UI Metadata** |
| label | ✅ TEXT | ❌ | ✅ TEXT | portfolios | Display name in UI |
| **Deprecated** |
| portfolio_id (FK in strategies) | N/A | ✅ UUID (FK to portfolios) | ❌ REMOVED | N/A | Circular dependency - delete |

---

## Data Migration Strategy

### Phase 1: Pre-Migration Validation

**Step 1.1: Identify Orphaned Records**
```sql
-- Portfolios without matching strategies (newly created, not yet activated)
SELECT portfolio_id, customer_id, strategy_code, status, created_at
FROM public.customer_portfolios
WHERE portfolio_id NOT IN (
  SELECT portfolio_id FROM lth_pvr.customer_strategies WHERE portfolio_id IS NOT NULL
)
ORDER BY created_at DESC;

-- Strategies without matching portfolios (CRITICAL ERROR - should not exist)
SELECT customer_strategy_id, customer_id, portfolio_id
FROM lth_pvr.customer_strategies
WHERE portfolio_id IS NOT NULL 
  AND portfolio_id NOT IN (SELECT portfolio_id FROM public.customer_portfolios);
```

**Step 1.2: Check for Data Conflicts**
```sql
-- Customers with same strategy_code in portfolios but different strategy_version_id in strategies
SELECT 
  cp.customer_id,
  cp.strategy_code,
  cp.portfolio_id,
  cs.strategy_version_id,
  sv.name AS version_name
FROM public.customer_portfolios cp
JOIN lth_pvr.customer_strategies cs ON cs.portfolio_id = cp.portfolio_id
JOIN lth_pvr.strategy_versions sv ON sv.strategy_version_id = cs.strategy_version_id
WHERE cp.strategy_code = 'LTH_PVR'
GROUP BY cp.customer_id, cp.strategy_code
HAVING COUNT(DISTINCT cs.strategy_version_id) > 1;
-- Expected: 0 rows (each customer should have one active version per strategy)
```

### Phase 2: Create New Table (Zero Downtime - Step 1)

**Migration File:** `supabase/migrations/20260121_create_consolidated_customer_strategies.sql`

```sql
-- Step 1: Create new consolidated table
CREATE TABLE public.customer_strategies (
  customer_strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  customer_id BIGINT NOT NULL REFERENCES public.customer_details(customer_id),
  
  strategy_code TEXT NOT NULL REFERENCES public.strategies(strategy_code),
  strategy_version_id UUID REFERENCES lth_pvr.strategy_versions(strategy_version_id),
  
  exchange TEXT NOT NULL DEFAULT 'VALR',
  exchange_account_id UUID NOT NULL REFERENCES lth_pvr.exchange_accounts(exchange_account_id),
  exchange_subaccount TEXT,
  
  base_asset TEXT NOT NULL DEFAULT 'BTC',
  quote_asset TEXT NOT NULL DEFAULT 'USDT',
  min_order_usdt NUMERIC(20,2) DEFAULT 1.00,
  
  performance_fee_rate NUMERIC(5,4) DEFAULT NULL,
  platform_fee_rate NUMERIC(5,4) DEFAULT NULL,
  
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'closed')),
  live_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  
  label TEXT NOT NULL,
  
  UNIQUE(customer_id, strategy_code, effective_from),
  CHECK (
    (status = 'closed' AND closed_at IS NOT NULL AND effective_to IS NOT NULL) OR
    (status != 'closed')
  )
);

CREATE INDEX idx_customer_strategies_org_cust 
  ON public.customer_strategies(org_id, customer_id, strategy_code, status);

CREATE INDEX idx_customer_strategies_live 
  ON public.customer_strategies(org_id, strategy_code, live_enabled) 
  WHERE live_enabled = TRUE;

CREATE INDEX idx_customer_strategies_active 
  ON public.customer_strategies(customer_id, status) 
  WHERE status = 'active';

-- Step 2: Backfill from customer_portfolios LEFT JOIN customer_strategies
INSERT INTO public.customer_strategies (
  customer_strategy_id,
  org_id,
  customer_id,
  strategy_code,
  strategy_version_id,
  exchange,
  exchange_account_id,
  exchange_subaccount,
  base_asset,
  quote_asset,
  min_order_usdt,
  status,
  live_enabled,
  effective_from,
  effective_to,
  created_at,
  closed_at,
  label
)
SELECT
  -- Use existing customer_strategy_id if exists, otherwise generate new UUID
  COALESCE(cs.customer_strategy_id, gen_random_uuid()),
  
  cp.org_id,
  cp.customer_id,
  cp.strategy_code,
  
  -- strategy_version_id from lth_pvr.customer_strategies (NULL if no match)
  cs.strategy_version_id,
  
  cp.exchange,
  -- Prefer exchange_account_id from customer_strategies (NOT NULL), fallback to customer_portfolios (nullable)
  COALESCE(cs.exchange_account_id, cp.exchange_account_id),
  cp.exchange_subaccount,
  
  cp.base_asset,
  cp.quote_asset,
  COALESCE(cs.min_order_usdt, 1.00),
  
  cp.status,
  COALESCE(cs.live_enabled, FALSE),
  
  -- effective_from: Use customer_strategies if exists, otherwise use created_at from portfolios
  COALESCE(cs.effective_from, cp.created_at::DATE),
  cs.effective_to,
  
  -- Use earliest created_at (prioritize customer_strategies if both exist)
  LEAST(cp.created_at, COALESCE(cs.created_at, cp.created_at)),
  cp.closed_at,
  
  cp.label
  
FROM public.customer_portfolios cp
LEFT JOIN lth_pvr.customer_strategies cs ON cs.portfolio_id = cp.portfolio_id
ORDER BY cp.created_at;

-- Step 3: Verify row counts match
DO $$
DECLARE
  v_portfolios_count INTEGER;
  v_new_strategies_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_portfolios_count FROM public.customer_portfolios;
  SELECT COUNT(*) INTO v_new_strategies_count FROM public.customer_strategies;
  
  IF v_portfolios_count != v_new_strategies_count THEN
    RAISE EXCEPTION 'Migration failed: customer_portfolios has % rows but customer_strategies has % rows', 
      v_portfolios_count, v_new_strategies_count;
  END IF;
  
  RAISE NOTICE 'Migration successful: % rows copied to public.customer_strategies', v_new_strategies_count;
END $$;
```

### Phase 3: Dual-Write Period (Zero Downtime - Step 2)

**Purpose:** Ensure new table stays in sync during migration period

**Option A: Database Triggers (Automatic)**
```sql
-- Trigger to sync INSERT/UPDATE/DELETE from customer_portfolios to customer_strategies
CREATE OR REPLACE FUNCTION sync_customer_portfolios_to_strategies()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.customer_strategies (
      org_id, customer_id, strategy_code, exchange, exchange_account_id,
      exchange_subaccount, base_asset, quote_asset, status, created_at, label
    ) VALUES (
      NEW.org_id, NEW.customer_id, NEW.strategy_code, NEW.exchange, NEW.exchange_account_id,
      NEW.exchange_subaccount, NEW.base_asset, NEW.quote_asset, NEW.status, NEW.created_at, NEW.label
    )
    ON CONFLICT (customer_id, strategy_code, effective_from) DO NOTHING;
    
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.customer_strategies
    SET status = NEW.status,
        exchange_account_id = NEW.exchange_account_id,
        closed_at = NEW.closed_at
    WHERE customer_id = NEW.customer_id 
      AND strategy_code = NEW.strategy_code
      AND effective_to IS NULL;
      
  ELSIF TG_OP = 'DELETE' THEN
    -- Soft delete: Set effective_to instead of hard delete
    UPDATE public.customer_strategies
    SET effective_to = CURRENT_DATE,
        status = 'closed'
    WHERE customer_id = OLD.customer_id 
      AND strategy_code = OLD.strategy_code
      AND effective_to IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_portfolios_to_strategies_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.customer_portfolios
FOR EACH ROW EXECUTE FUNCTION sync_customer_portfolios_to_strategies();
```

**Option B: Application-Level Dual-Write (Manual in Edge Functions)**
- Modify INSERT/UPDATE functions to write to BOTH tables during migration
- More control, easier rollback
- **Recommended for production safety**

### Phase 4: Update Edge Functions (17 days implementation)

See separate section "Edge Function Migration Plan" below.

### Phase 5: Deprecate Old Tables (After 30-Day Safety Period)

```sql
-- Rename old tables (preserves data for rollback)
ALTER TABLE public.customer_portfolios RENAME TO _deprecated_customer_portfolios;
ALTER TABLE lth_pvr.customer_strategies RENAME TO _deprecated_lth_pvr_customer_strategies;

-- Drop triggers
DROP TRIGGER IF EXISTS sync_portfolios_to_strategies_trigger ON _deprecated_customer_portfolios;
DROP FUNCTION IF EXISTS sync_customer_portfolios_to_strategies();

-- After 30 days of production stability, drop deprecated tables
DROP TABLE IF EXISTS _deprecated_customer_portfolios CASCADE;
DROP TABLE IF EXISTS _deprecated_lth_pvr_customer_strategies CASCADE;
```

---

## Edge Function Migration Plan

### Functions Writing to customer_portfolios (6 functions)

#### 1. `ef_confirm_strategy/index.ts` (Lines 89, 104)
**Current Behavior:**
- SELECT existing portfolio by customer_id + strategy_code
- INSERT new portfolio if not exists

**Migration:**
```typescript
// OLD CODE (Lines 89-104):
const { data: existingPortfolio } = await supabase
  .from("customer_portfolios")
  .select("portfolio_id")
  .eq("customer_id", customer_id)
  .eq("strategy_code", strategy_code)
  .single();

let portfolio_id;
if (existingPortfolio) {
  portfolio_id = existingPortfolio.portfolio_id;
} else {
  const { data: newPortfolio, error: portfolioError } = await supabase
    .from("customer_portfolios")
    .insert({...})
    .select("portfolio_id")
    .single();
}

// NEW CODE:
const { data: existingStrategy } = await supabase
  .from("customer_strategies")
  .select("customer_strategy_id")
  .eq("customer_id", customer_id)
  .eq("strategy_code", strategy_code)
  .is("effective_to", null)  // Only active strategies
  .single();

let customer_strategy_id;
if (existingStrategy) {
  customer_strategy_id = existingStrategy.customer_strategy_id;
} else {
  // Get strategy_version_id for LTH_PVR
  const { data: version } = await supabase
    .schema("lth_pvr")
    .from("strategy_versions")
    .select("strategy_version_id")
    .eq("org_id", customer.org_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  
  const { data: newStrategy, error: strategyError } = await supabase
    .from("customer_strategies")
    .insert({
      org_id: customer.org_id,
      customer_id: customer_id,
      strategy_code: strategy_code,
      strategy_version_id: version?.strategy_version_id,  // NULL for non-LTH_PVR
      status: "pending",
      live_enabled: false,
      label: `${customer.first_names} ${customer.last_name} - ${strategy.name}`
    })
    .select("customer_strategy_id")
    .single();
    
  customer_strategy_id = newStrategy.customer_strategy_id;
}
```

#### 2. `ef_deposit_scan/index.ts` (Lines 112, 177, 188, 213)
**Current Behavior:**
- SELECT customer_portfolios to get exchange_account_id
- UPDATE customer_portfolios status to 'active'
- INSERT into lth_pvr.customer_strategies (dual-write bug)

**Migration:**
```typescript
// OLD CODE (Lines 112):
const { data: portfolios } = await supabase
  .from("customer_portfolios")
  .select("customer_id, portfolio_id, strategy_code, exchange_account_id")
  .in("customer_id", customerIds);

// NEW CODE:
const { data: strategies } = await supabase
  .from("customer_strategies")
  .select("customer_id, customer_strategy_id, strategy_code, exchange_account_id, strategy_version_id")
  .in("customer_id", customerIds)
  .is("effective_to", null);

// OLD CODE (Lines 177-188):
const { error: updatePortfolioError } = await supabase
  .from("customer_portfolios")
  .update({ status: "active" })
  .eq("customer_id", customer.customer_id);

const { data: portfolioData } = await supabase
  .from("customer_portfolios")
  .select("portfolio_id, exchange_account_id")
  .eq("customer_id", customer.customer_id)
  .single();

// NEW CODE:
const { error: updateStrategyError } = await supabase
  .from("customer_strategies")
  .update({ 
    status: "active",
    live_enabled: true,  // Enable trading
    effective_from: CURRENT_DATE  // Ensure effective_from is set
  })
  .eq("customer_id", customer.customer_id)
  .is("effective_to", null);

// OLD CODE (Lines 213-227) - INSERT into lth_pvr.customer_strategies:
const { error: customerStrategyError } = await supabase
  .schema("lth_pvr")
  .from("customer_strategies")
  .insert({
    org_id: customer.org_id,
    customer_id: customer.customer_id,
    strategy_version_id: strategyVersion.strategy_version_id,
    exchange_account_id: portfolioData.exchange_account_id,
    live_enabled: true,
    effective_from: CURRENT_DATE,
    portfolio_id: portfolioData.portfolio_id
  });

// NEW CODE:
// ✅ NO LONGER NEEDED - Already handled by UPDATE above
// Delete this entire block (Lines 196-227)
```

#### 3. `ef_valr_create_subaccount/index.ts` (Lines 100, 264)
**Migration:** Replace `customer_portfolios` with `customer_strategies`, use `customer_strategy_id` instead of `portfolio_id`

#### 4-6. Statement Generation Functions
- `ef_monthly_statement_generator/index.ts`
- `ef_generate_statement/index.ts`
- `ef_balance_reconciliation/index.ts`

**Migration:** Simple SELECT replacement, no INSERT/UPDATE logic

---

### Functions Writing to lth_pvr.customer_strategies (2 functions)

#### 1. `ef_generate_decisions/index.ts` (Line 66)
**Current Behavior:**
- SELECT customer_strategies WHERE live_enabled = TRUE
- JOIN with customer_details to filter registration_status = 'active'

**Migration:**
```typescript
// OLD CODE:
const { data: cs, error: csErr } = await sb
  .from("customer_strategies")
  .select("customer_id, strategy_version_id")
  .eq("org_id", org_id)
  .eq("live_enabled", true);

// NEW CODE (schema changed from lth_pvr to public):
const { data: cs, error: csErr } = await sb
  .schema("public")  // ✅ CRITICAL: Change schema from lth_pvr to public
  .from("customer_strategies")
  .select("customer_id, strategy_version_id")
  .eq("org_id", org_id)
  .eq("live_enabled", true)
  .is("effective_to", null);  // ✅ Only active strategies
```

#### 2. `ef_execute_orders/index.ts` (Line 35)
**Migration:** Same as above - change schema to `public`, add `effective_to IS NULL` filter

#### 3. `ef_fee_monthly_close/index.ts` (Line 124)
**Migration:** Replace with query to new consolidated table

---

### RPC Functions (2 functions minimum)

#### 1. `public.list_customer_portfolios.fn.sql`
**Current Behavior:**
```sql
SELECT 
  cp.portfolio_id,
  cp.strategy_code,
  cp.strategy_code || ' Strategy' as strategy_name,
  cp.status,
  COALESCE(bd.nav_usd, 0) as nav_usd,
  ...
FROM public.customer_portfolios cp
LEFT JOIN lth_pvr.balances_daily bd ON bd.customer_id = cp.customer_id
WHERE cp.customer_id = p_customer_id;
```

**Migration:**
```sql
CREATE OR REPLACE FUNCTION public.list_customer_strategies(p_customer_id BIGINT)
RETURNS TABLE (...) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cs.customer_strategy_id,
    cs.strategy_code,
    cs.strategy_code || ' Strategy' as strategy_name,
    cs.status,
    COALESCE(bd.nav_usd, 0) as nav_usd,
    ...
  FROM public.customer_strategies cs
  LEFT JOIN lth_pvr.balances_daily bd ON bd.customer_id = cs.customer_id
  WHERE cs.customer_id = p_customer_id
    AND cs.effective_to IS NULL;  -- Only active strategies
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Backwards Compatibility Alias:**
```sql
-- Keep old function name as alias during transition
CREATE OR REPLACE FUNCTION public.list_customer_portfolios(p_customer_id BIGINT)
RETURNS TABLE (...) AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.list_customer_strategies(p_customer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Implementation Checklist

### Pre-Migration (Days 1-2)
- [ ] Run orphaned records query (verify no strategies without portfolios)
- [ ] Run data conflict query (verify no duplicate strategy versions per customer)
- [ ] Backup production database
- [ ] Create rollback script (DROP new table, restore old tables from backup)
- [ ] Test migration on development database
- [ ] Document current customer_portfolios and customer_strategies row counts

### Migration Deployment (Day 3)
- [ ] Deploy migration SQL (create table + backfill)
- [ ] Verify row count matches (customer_portfolios count = customer_strategies count)
- [ ] Enable dual-write triggers (or application-level dual-write)
- [ ] Monitor logs for trigger errors
- [ ] Test new table with SELECT queries (verify data integrity)

### Edge Function Updates (Days 4-10)
- [ ] Update ef_confirm_strategy (test with Customer 31)
- [ ] Update ef_deposit_scan (test with test deposit)
- [ ] Update ef_valr_create_subaccount
- [ ] Update statement generation functions
- [ ] Update ef_generate_decisions (test trading pipeline)
- [ ] Update ef_execute_orders
- [ ] Update ef_fee_monthly_close
- [ ] Test each function after deployment

### RPC & UI Updates (Days 11-13)
- [ ] Update list_customer_portfolios → list_customer_strategies
- [ ] Update get_customer_dashboard
- [ ] Update Admin UI portfolio dropdown (test with multiple customers)
- [ ] Update customer portal dashboard
- [ ] Test end-to-end customer portal flow

### Validation & Monitoring (Days 14-16)
- [ ] Run full integration test (prospect → active customer)
- [ ] Verify trading pipeline includes all active customers
- [ ] Verify no INSERT/UPDATE to old tables (check logs)
- [ ] Monitor production for 7 days (any errors referencing old tables?)
- [ ] Confirm zero data divergence between old and new tables

### Deprecation (Day 17)
- [ ] Rename old tables to _deprecated_*
- [ ] Drop dual-write triggers
- [ ] Monitor for 30 days
- [ ] Drop deprecated tables after 30-day safety period

---

## Rollback Plan

**If migration fails in Days 1-16:**

```sql
-- Step 1: Drop new table
DROP TABLE IF EXISTS public.customer_strategies CASCADE;

-- Step 2: Drop triggers
DROP TRIGGER IF EXISTS sync_portfolios_to_strategies_trigger ON public.customer_portfolios;
DROP FUNCTION IF EXISTS sync_customer_portfolios_to_strategies();

-- Step 3: Restore old edge function deployments from git
git checkout HEAD~1 supabase/functions/ef_*
supabase functions deploy <function_name> --project-ref wqnmxpooabmedvtackji --no-verify-jwt

-- Step 4: Verify old tables still have all data
SELECT COUNT(*) FROM public.customer_portfolios;
SELECT COUNT(*) FROM lth_pvr.customer_strategies;
```

**After Day 17 (tables renamed):**
```sql
-- Restore old table names
ALTER TABLE _deprecated_customer_portfolios RENAME TO customer_portfolios;
ALTER TABLE _deprecated_lth_pvr_customer_strategies RENAME TO customer_strategies;

-- Re-enable old edge functions (same as above)
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Data loss during backfill | LOW | CRITICAL | Test on dev DB, verify row counts, backup production |
| Foreign key constraint violations | MEDIUM | HIGH | Pre-validate all FKs exist before migration |
| Edge function bugs after update | MEDIUM | HIGH | Update one function at a time, test thoroughly |
| Dual-write trigger failures | MEDIUM | MEDIUM | Monitor logs, use application-level dual-write as backup |
| Customer portal downtime | LOW | MEDIUM | Deploy during low-traffic hours (02:00-04:00 UTC) |
| Trading pipeline breaks | MEDIUM | CRITICAL | Test ef_generate_decisions extensively before production |
| Orphaned customer_strategies rows | LOW | LOW | Pre-migration validation query catches these |

---

## Success Metrics

**Day 3 (Post-Migration):**
- ✅ Row count match: `customer_portfolios` = `customer_strategies`
- ✅ Zero errors in edge function logs
- ✅ Customer portal displays portfolios correctly

**Day 10 (Post-Edge Function Updates):**
- ✅ All 10 edge functions deployed successfully
- ✅ Zero INSERT/UPDATE to old customer_portfolios table
- ✅ Trading pipeline includes all active customers (verify with ef_generate_decisions)

**Day 17 (Post-Deprecation):**
- ✅ Old tables renamed to _deprecated_*
- ✅ Zero errors referencing old table names
- ✅ Ready to proceed with fee implementation (Task 5 Phase 1)

---

**Status:** Analysis complete, ready for migration SQL creation  
**Next Step:** Create migration file `20260121_create_consolidated_customer_strategies.sql`  
**Estimated Total Time:** 17 days (3 days migration + 7 days edge functions + 3 days RPC/UI + 4 days validation)
