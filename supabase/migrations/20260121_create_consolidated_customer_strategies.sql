-- Migration: Consolidate customer_portfolios and lth_pvr.customer_strategies into public.customer_strategies
-- Author: BitWealth Development Team
-- Date: 2026-01-21
-- Version: v0.6.23
-- Related: TABLE_CONSOLIDATION_ANALYSIS.md, POST_LAUNCH_ENHANCEMENTS.md Task 5

-- ============================================================================
-- PHASE 1: PRE-MIGRATION VALIDATION
-- ============================================================================

-- Check for orphaned customer_strategies records (no matching portfolio)
DO $$
DECLARE
  v_orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_orphan_count
  FROM lth_pvr.customer_strategies cs
  LEFT JOIN public.customer_portfolios cp ON cs.portfolio_id = cp.portfolio_id
  WHERE cp.portfolio_id IS NULL;
  
  IF v_orphan_count > 0 THEN
    RAISE WARNING 'Found % orphaned customer_strategies records (no matching portfolio)', v_orphan_count;
    RAISE WARNING 'These records will be included in migration with NULL portfolio columns';
  END IF;
END $$;

-- Check for data conflicts (multiple active strategies per customer)
DO $$
DECLARE
  v_conflict_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_conflict_count
  FROM (
    SELECT customer_id, strategy_version_id, COUNT(*) as count
    FROM lth_pvr.customer_strategies
    WHERE effective_to IS NULL
    GROUP BY customer_id, strategy_version_id
    HAVING COUNT(*) > 1
  ) conflicts;
  
  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Found % data conflicts: Multiple active strategies per customer. Manual resolution required.', v_conflict_count;
  END IF;
END $$;

-- ============================================================================
-- PHASE 2: CREATE CONSOLIDATED TABLE
-- ============================================================================

-- Drop table if exists (for development/testing only - remove in production)
-- DROP TABLE IF EXISTS public.customer_strategies CASCADE;

CREATE TABLE IF NOT EXISTS public.customer_strategies (
  -- Primary Key
  customer_strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Multi-Tenant Context
  org_id UUID NOT NULL,
  customer_id INTEGER NOT NULL,
  
  -- Strategy Configuration (from both tables)
  strategy_code TEXT NOT NULL DEFAULT 'LTH_PVR', -- From customer_portfolios.strategy (normalized)
  strategy_version_id UUID NOT NULL,              -- From customer_strategies
  
  -- Exchange Integration
  exchange_account_id UUID NOT NULL,              -- From customer_strategies
  exchange_subaccount TEXT,                       -- From customer_portfolios.exchange_subaccount
  
  -- UI Display (from customer_portfolios)
  label TEXT NOT NULL,                            -- From customer_portfolios.label
  status TEXT NOT NULL DEFAULT 'pending',         -- From customer_portfolios.status (pending/active/suspended/closed)
  
  -- Trading Controls (from customer_strategies)
  live_enabled BOOLEAN NOT NULL DEFAULT FALSE,    -- From customer_strategies.live_enabled
  min_order_usdt NUMERIC(18, 8),                  -- From customer_strategies.min_order_usdt
  
  -- Lifecycle Timestamps (merged from both)
  effective_from DATE,                            -- From customer_strategies.effective_from
  effective_to DATE,                              -- From customer_strategies.effective_to
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- From both (use customer_portfolios.created_at)
  updated_at TIMESTAMPTZ,                         -- From customer_portfolios.updated_at
  
  -- ====================================================================
  -- NEW FEE COLUMNS (Task 5: Real Customer Fees)
  -- ====================================================================
  
  -- Fee Rates (strategy-level defaults, can be overridden per portfolio)
  performance_fee_rate NUMERIC(5, 4) DEFAULT 0.10,  -- 10% performance fee (HWM-based)
  platform_fee_rate NUMERIC(5, 4) DEFAULT 0.0075,   -- 0.75% platform fee (on NET USDT)
  
  -- ====================================================================
  -- DEPRECATED COLUMNS (kept for backwards compatibility, to be removed in Phase 6)
  -- ====================================================================
  
  portfolio_id UUID,  -- DEPRECATED: Circular reference, will be removed after migration complete
  
  -- ====================================================================
  -- CONSTRAINTS
  -- ====================================================================
  
  -- Foreign Keys
  CONSTRAINT fk_customer_strategies_org 
    FOREIGN KEY (org_id) REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  
  CONSTRAINT fk_customer_strategies_customer 
    FOREIGN KEY (customer_id) REFERENCES public.customer_details(customer_id) ON DELETE CASCADE,
  
  CONSTRAINT fk_customer_strategies_strategy_version 
    FOREIGN KEY (strategy_version_id) REFERENCES lth_pvr.strategy_versions(strategy_version_id) ON DELETE RESTRICT,
  
  CONSTRAINT fk_customer_strategies_exchange_account 
    FOREIGN KEY (exchange_account_id) REFERENCES public.exchange_accounts(exchange_account_id) ON DELETE RESTRICT,
  
  -- Check Constraints
  CONSTRAINT chk_customer_strategies_status 
    CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  
  CONSTRAINT chk_customer_strategies_strategy_code 
    CHECK (strategy_code IN ('LTH_PVR', 'ADV_DCA', 'STD_DCA')),
  
  CONSTRAINT chk_customer_strategies_fee_rates 
    CHECK (
      performance_fee_rate >= 0 AND performance_fee_rate <= 1 AND
      platform_fee_rate >= 0 AND platform_fee_rate <= 1
    ),
  
  CONSTRAINT chk_customer_strategies_dates 
    CHECK (
      (effective_from IS NULL AND effective_to IS NULL) OR
      (effective_from IS NOT NULL AND effective_to IS NULL) OR
      (effective_from IS NOT NULL AND effective_to IS NOT NULL AND effective_from < effective_to)
    )
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Primary query patterns
CREATE INDEX IF NOT EXISTS idx_customer_strategies_org_customer 
  ON public.customer_strategies(org_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_strategies_status 
  ON public.customer_strategies(status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_customer_strategies_live_enabled 
  ON public.customer_strategies(live_enabled) WHERE live_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_customer_strategies_exchange_account 
  ON public.customer_strategies(exchange_account_id);

CREATE INDEX IF NOT EXISTS idx_customer_strategies_effective_dates 
  ON public.customer_strategies(effective_from, effective_to);

-- Temporary index for migration (can be dropped after Phase 6)
CREATE INDEX IF NOT EXISTS idx_customer_strategies_portfolio_id 
  ON public.customer_strategies(portfolio_id);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.customer_strategies ENABLE ROW LEVEL SECURITY;

-- Policy: Organization isolation (all users can only see their org's data)
CREATE POLICY customer_strategies_org_isolation 
  ON public.customer_strategies
  FOR ALL
  USING (org_id = (current_setting('app.current_org_id', TRUE)::UUID));

-- Policy: Service role bypass (for edge functions)
CREATE POLICY customer_strategies_service_role 
  ON public.customer_strategies
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.customer_strategies IS 
  'Consolidated customer strategy assignments (formerly customer_portfolios + lth_pvr.customer_strategies). '
  'Each row represents one customer enrolled in one strategy with specific exchange account. '
  'Migration v0.6.23: Merged 22 columns from customer_portfolios (13) + customer_strategies (11) = 24 total (2 overlapping).';

COMMENT ON COLUMN public.customer_strategies.customer_strategy_id IS 
  'Primary key (UUID). Replaces both portfolio_id and customer_strategy_id from old tables.';

COMMENT ON COLUMN public.customer_strategies.strategy_code IS 
  'Strategy type code: LTH_PVR, ADV_DCA, STD_DCA. Normalized from customer_portfolios.strategy.';

COMMENT ON COLUMN public.customer_strategies.status IS 
  'Lifecycle status: pending (KYC incomplete), active (trading live), suspended (paused), closed (terminated). From customer_portfolios.';

COMMENT ON COLUMN public.customer_strategies.live_enabled IS 
  'Trading pipeline inclusion flag. TRUE = strategy generates decisions daily. From lth_pvr.customer_strategies.';

COMMENT ON COLUMN public.customer_strategies.performance_fee_rate IS 
  'NEW (v0.6.23): Performance fee rate (0-1 decimal). Default 0.10 = 10%. Charged monthly on profit above HWM.';

COMMENT ON COLUMN public.customer_strategies.platform_fee_rate IS 
  'NEW (v0.6.23): Platform fee rate (0-1 decimal). Default 0.0075 = 0.75%. Charged on NET USDT (after VALR fees).';

COMMENT ON COLUMN public.customer_strategies.portfolio_id IS 
  'DEPRECATED (v0.6.23): Temporary reference to old customer_portfolios.portfolio_id. Will be removed in Phase 6 after all functions migrated.';

-- ============================================================================
-- PHASE 3: BACKFILL DATA FROM OLD TABLES
-- ============================================================================

-- Insert consolidated data using LEFT JOIN (handles orphaned customer_strategies)
INSERT INTO public.customer_strategies (
  -- IDs (prefer customer_strategies.customer_strategy_id, fallback to customer_portfolios.portfolio_id)
  customer_strategy_id,
  org_id,
  customer_id,
  
  -- Strategy config
  strategy_code,
  strategy_version_id,
  
  -- Exchange
  exchange_account_id,
  exchange_subaccount,
  
  -- UI display
  label,
  status,
  
  -- Trading controls
  live_enabled,
  min_order_usdt,
  
  -- Lifecycle
  effective_from,
  effective_to,
  created_at,
  updated_at,
  
  -- Fee rates (use defaults for existing customers)
  performance_fee_rate,
  platform_fee_rate,
  
  -- Deprecated
  portfolio_id
)
SELECT
  -- Primary key: Prefer customer_strategies.customer_strategy_id (has UUID), fallback to portfolio_id
  COALESCE(cs.customer_strategy_id, cp.portfolio_id) AS customer_strategy_id,
  
  -- Multi-tenant context (both tables have org_id and customer_id, prefer portfolios as source of truth)
  cp.org_id,
  cp.customer_id,
  
  -- Strategy configuration
  -- Normalize strategy name: 'LTH_PVR BTC DCA' → 'LTH_PVR'
  COALESCE(
    CASE 
      WHEN cp.strategy ILIKE '%LTH_PVR%' THEN 'LTH_PVR'
      WHEN cp.strategy ILIKE '%ADV_DCA%' THEN 'ADV_DCA'
      WHEN cp.strategy ILIKE '%STD_DCA%' THEN 'STD_DCA'
      ELSE 'LTH_PVR'  -- Default fallback
    END,
    'LTH_PVR'
  ) AS strategy_code,
  
  COALESCE(cs.strategy_version_id, cp.strategy_version_id) AS strategy_version_id,
  
  -- Exchange integration
  COALESCE(cs.exchange_account_id, cp.exchange_account_id) AS exchange_account_id,
  cp.exchange_subaccount,
  
  -- UI display
  cp.label,
  cp.status,
  
  -- Trading controls (from customer_strategies, default to FALSE if NULL)
  COALESCE(cs.live_enabled, FALSE) AS live_enabled,
  cs.min_order_usdt,  -- NULL is acceptable (no minimum order size)
  
  -- Lifecycle timestamps
  cs.effective_from,
  cs.effective_to,
  cp.created_at,
  cp.updated_at,
  
  -- Fee rates (use strategy defaults for existing customers)
  0.10 AS performance_fee_rate,  -- 10% default
  0.0075 AS platform_fee_rate,   -- 0.75% default
  
  -- Deprecated (keep portfolio_id for backwards compatibility during migration)
  cp.portfolio_id

FROM public.customer_portfolios cp
LEFT JOIN lth_pvr.customer_strategies cs 
  ON cp.portfolio_id = cs.portfolio_id

-- Exclude any duplicates (in case customer_strategies already has records we're about to insert)
WHERE NOT EXISTS (
  SELECT 1 FROM public.customer_strategies existing
  WHERE existing.customer_strategy_id = COALESCE(cs.customer_strategy_id, cp.portfolio_id)
);

-- Also insert orphaned customer_strategies records (no matching portfolio)
-- This handles edge case where customer_strategies exists but customer_portfolios doesn't
INSERT INTO public.customer_strategies (
  customer_strategy_id,
  org_id,
  customer_id,
  strategy_code,
  strategy_version_id,
  exchange_account_id,
  exchange_subaccount,  -- NULL (no portfolio data)
  label,                -- Generated from customer name
  status,               -- Default to 'active' if strategy exists
  live_enabled,
  min_order_usdt,
  effective_from,
  effective_to,
  created_at,
  updated_at,           -- NULL (no portfolio data)
  performance_fee_rate,
  platform_fee_rate,
  portfolio_id          -- NULL (orphaned)
)
SELECT
  cs.customer_strategy_id,
  cs.org_id,
  cs.customer_id,
  'LTH_PVR' AS strategy_code,  -- Assume LTH_PVR for orphaned records
  cs.strategy_version_id,
  cs.exchange_account_id,
  NULL AS exchange_subaccount,
  'Migrated: ' || cd.first_name || ' ' || cd.last_name || ' - LTH PVR' AS label,
  'active' AS status,  -- Assume active if customer_strategies record exists
  cs.live_enabled,
  cs.min_order_usdt,
  cs.effective_from,
  cs.effective_to,
  cs.created_at,
  NULL AS updated_at,
  0.10 AS performance_fee_rate,
  0.0075 AS platform_fee_rate,
  NULL AS portfolio_id  -- Orphaned (no portfolio)
  
FROM lth_pvr.customer_strategies cs
LEFT JOIN public.customer_portfolios cp ON cs.portfolio_id = cp.portfolio_id
INNER JOIN public.customer_details cd ON cs.customer_id = cd.customer_id
WHERE cp.portfolio_id IS NULL  -- Only orphaned records
  AND NOT EXISTS (
    SELECT 1 FROM public.customer_strategies existing
    WHERE existing.customer_strategy_id = cs.customer_strategy_id
  );

-- ============================================================================
-- PHASE 4: VERIFICATION QUERIES
-- ============================================================================

-- Count records in each table
DO $$
DECLARE
  v_portfolios_count INTEGER;
  v_strategies_old_count INTEGER;
  v_strategies_new_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_portfolios_count FROM public.customer_portfolios;
  SELECT COUNT(*) INTO v_strategies_old_count FROM lth_pvr.customer_strategies;
  SELECT COUNT(*) INTO v_strategies_new_count FROM public.customer_strategies;
  
  RAISE NOTICE 'Row counts:';
  RAISE NOTICE '  customer_portfolios: %', v_portfolios_count;
  RAISE NOTICE '  lth_pvr.customer_strategies (old): %', v_strategies_old_count;
  RAISE NOTICE '  public.customer_strategies (new): %', v_strategies_new_count;
  
  -- Verification logic:
  -- Expected: new_count = portfolios_count (if all strategies have portfolios)
  -- OR: new_count = portfolios_count + orphaned_strategies (if some strategies don't have portfolios)
  
  IF v_strategies_new_count < v_portfolios_count THEN
    RAISE WARNING 'New table has FEWER records than customer_portfolios. Data loss detected!';
  ELSIF v_strategies_new_count = v_portfolios_count THEN
    RAISE NOTICE 'SUCCESS: New table row count matches customer_portfolios (no orphaned strategies)';
  ELSIF v_strategies_new_count > v_portfolios_count THEN
    RAISE NOTICE 'New table has MORE records than customer_portfolios (orphaned strategies included)';
    RAISE NOTICE 'Orphaned strategies: %', v_strategies_new_count - v_portfolios_count;
  END IF;
END $$;

-- Check for missing data (customers in portfolios but not in new table)
DO $$
DECLARE
  v_missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_missing_count
  FROM public.customer_portfolios cp
  LEFT JOIN public.customer_strategies cs ON cp.portfolio_id = cs.portfolio_id
  WHERE cs.customer_strategy_id IS NULL;
  
  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: % customer_portfolios records missing from new table!', v_missing_count;
  ELSE
    RAISE NOTICE 'SUCCESS: All customer_portfolios records migrated';
  END IF;
END $$;

-- ============================================================================
-- PHASE 5: DUAL-WRITE TRIGGERS (for zero-downtime migration)
-- ============================================================================

-- Trigger Function: Sync INSERT from new table to old tables
CREATE OR REPLACE FUNCTION sync_customer_strategies_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert into customer_portfolios
  INSERT INTO public.customer_portfolios (
    portfolio_id,
    org_id,
    customer_id,
    strategy,
    strategy_version_id,
    exchange_account_id,
    exchange_subaccount,
    label,
    status,
    created_at,
    updated_at
  ) VALUES (
    NEW.customer_strategy_id,  -- Use new PK as portfolio_id
    NEW.org_id,
    NEW.customer_id,
    NEW.strategy_code || ' BTC DCA',  -- Denormalize back to original format
    NEW.strategy_version_id,
    NEW.exchange_account_id,
    NEW.exchange_subaccount,
    NEW.label,
    NEW.status,
    NEW.created_at,
    NEW.updated_at
  )
  ON CONFLICT (portfolio_id) DO UPDATE SET
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;
  
  -- Insert into lth_pvr.customer_strategies
  INSERT INTO lth_pvr.customer_strategies (
    customer_strategy_id,
    org_id,
    customer_id,
    strategy_version_id,
    exchange_account_id,
    portfolio_id,
    live_enabled,
    min_order_usdt,
    effective_from,
    effective_to,
    created_at
  ) VALUES (
    NEW.customer_strategy_id,
    NEW.org_id,
    NEW.customer_id,
    NEW.strategy_version_id,
    NEW.exchange_account_id,
    NEW.customer_strategy_id,  -- Self-reference
    NEW.live_enabled,
    NEW.min_order_usdt,
    NEW.effective_from,
    NEW.effective_to,
    NEW.created_at
  )
  ON CONFLICT (customer_strategy_id) DO UPDATE SET
    live_enabled = EXCLUDED.live_enabled,
    effective_to = EXCLUDED.effective_to;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger Function: Sync UPDATE from new table to old tables
CREATE OR REPLACE FUNCTION sync_customer_strategies_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Update customer_portfolios
  UPDATE public.customer_portfolios SET
    status = NEW.status,
    updated_at = NEW.updated_at,
    exchange_subaccount = NEW.exchange_subaccount,
    label = NEW.label
  WHERE portfolio_id = NEW.customer_strategy_id;
  
  -- Update lth_pvr.customer_strategies
  UPDATE lth_pvr.customer_strategies SET
    live_enabled = NEW.live_enabled,
    min_order_usdt = NEW.min_order_usdt,
    effective_from = NEW.effective_from,
    effective_to = NEW.effective_to
  WHERE customer_strategy_id = NEW.customer_strategy_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger Function: Sync DELETE from new table to old tables
CREATE OR REPLACE FUNCTION sync_customer_strategies_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete from lth_pvr.customer_strategies first (has FK to customer_portfolios)
  DELETE FROM lth_pvr.customer_strategies
  WHERE customer_strategy_id = OLD.customer_strategy_id;
  
  -- Delete from customer_portfolios
  DELETE FROM public.customer_portfolios
  WHERE portfolio_id = OLD.customer_strategy_id;
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trg_sync_customer_strategies_insert ON public.customer_strategies;
CREATE TRIGGER trg_sync_customer_strategies_insert
  AFTER INSERT ON public.customer_strategies
  FOR EACH ROW
  EXECUTE FUNCTION sync_customer_strategies_insert();

DROP TRIGGER IF EXISTS trg_sync_customer_strategies_update ON public.customer_strategies;
CREATE TRIGGER trg_sync_customer_strategies_update
  AFTER UPDATE ON public.customer_strategies
  FOR EACH ROW
  EXECUTE FUNCTION sync_customer_strategies_update();

DROP TRIGGER IF EXISTS trg_sync_customer_strategies_delete ON public.customer_strategies;
CREATE TRIGGER trg_sync_customer_strategies_delete
  BEFORE DELETE ON public.customer_strategies
  FOR EACH ROW
  EXECUTE FUNCTION sync_customer_strategies_delete();

-- ============================================================================
-- MIGRATION COMPLETE NOTIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '======================================================================';
  RAISE NOTICE 'MIGRATION COMPLETE: public.customer_strategies created and populated';
  RAISE NOTICE '======================================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Verify row counts above match expectations';
  RAISE NOTICE '  2. Run manual spot checks on data integrity';
  RAISE NOTICE '  3. Update edge functions to use public.customer_strategies (Days 4-10)';
  RAISE NOTICE '  4. Update RPC functions (Days 11-13)';
  RAISE NOTICE '  5. Monitor production for 7 days';
  RAISE NOTICE '  6. Deprecate old tables (Day 17+)';
  RAISE NOTICE '';
  RAISE NOTICE 'Dual-Write Triggers: ENABLED (syncs new table → old tables)';
  RAISE NOTICE 'Rollback Window: 30 days (do not DROP old tables until 2026-02-20)';
  RAISE NOTICE '';
  RAISE NOTICE 'Documentation: TABLE_CONSOLIDATION_ANALYSIS.md';
  RAISE NOTICE 'Testing Plan: TASK_5_FEE_IMPLEMENTATION_TEST_CASES.md';
  RAISE NOTICE '======================================================================';
END $$;
