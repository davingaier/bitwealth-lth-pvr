-- Migration: Phase 1 - Fee System Database Schema
-- Date: 2026-01-21
-- Purpose: Create tables and columns required for real customer fees with HWM logic
-- Part of: v0.6.23 Fee Implementation

-- =============================================================================
-- 1. Extend ledger_lines with fee columns
-- =============================================================================

-- Add platform fee columns (BitWealth fees)
ALTER TABLE lth_pvr.ledger_lines 
  ADD COLUMN IF NOT EXISTS platform_fee_usdt NUMERIC(20, 8) DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS platform_fee_btc NUMERIC(20, 8) DEFAULT 0 NOT NULL;

-- Add performance fee column (HWM-based monthly fees)
ALTER TABLE lth_pvr.ledger_lines
  ADD COLUMN IF NOT EXISTS performance_fee_usdt NUMERIC(20, 8) DEFAULT 0 NOT NULL;

-- Add reference to conversion approval (for BTC→USDT fee conversions)
-- Note: FK constraint added after fee_conversion_approvals table is created
ALTER TABLE lth_pvr.ledger_lines
  ADD COLUMN IF NOT EXISTS conversion_approval_id UUID;

COMMENT ON COLUMN lth_pvr.ledger_lines.platform_fee_usdt IS 'BitWealth platform fee charged on deposits (0.75% of NET USDT after VALR fee)';
COMMENT ON COLUMN lth_pvr.ledger_lines.platform_fee_btc IS 'BitWealth platform fee charged on BTC deposits (0.75% of BTC amount)';
COMMENT ON COLUMN lth_pvr.ledger_lines.performance_fee_usdt IS 'HWM-based performance fee charged monthly (10% of profit above high water mark)';
COMMENT ON COLUMN lth_pvr.ledger_lines.conversion_approval_id IS 'Links to fee_conversion_approvals when BTC was sold to cover USDT fees';


-- =============================================================================
-- 2. Create customer_state_daily - High Water Mark tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.customer_state_daily (
  state_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id BIGINT NOT NULL,
  trade_date DATE NOT NULL,
  
  -- High Water Mark (HWM) tracking
  high_water_mark_usd NUMERIC(20, 2) NOT NULL DEFAULT 0,
  hwm_contrib_net_cum NUMERIC(20, 2) NOT NULL DEFAULT 0,  -- Net contributions since last HWM update
  last_perf_fee_month DATE,  -- Last month performance fee was charged (YYYY-MM-01 format)
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(customer_id, trade_date)
);

CREATE INDEX idx_customer_state_daily_customer ON lth_pvr.customer_state_daily(customer_id, trade_date DESC);
CREATE INDEX idx_customer_state_daily_org ON lth_pvr.customer_state_daily(org_id, trade_date);

COMMENT ON TABLE lth_pvr.customer_state_daily IS 'Tracks High Water Mark (HWM) and cumulative net contributions for performance fee calculations';
COMMENT ON COLUMN lth_pvr.customer_state_daily.high_water_mark_usd IS 'Highest NAV (minus net contributions) ever achieved by customer. Performance fee only charged when NAV exceeds HWM + new contributions.';
COMMENT ON COLUMN lth_pvr.customer_state_daily.hwm_contrib_net_cum IS 'Cumulative net contributions (deposits - withdrawals) since last HWM update';
COMMENT ON COLUMN lth_pvr.customer_state_daily.last_perf_fee_month IS 'Last month performance fee was charged (stored as YYYY-MM-01). NULL if never charged.';


-- =============================================================================
-- 3. Create fee_invoices - Monthly fee invoicing
-- =============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.fee_invoices (
  invoice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id BIGINT NOT NULL,
  
  -- Invoice period
  invoice_month DATE NOT NULL,  -- First day of month (YYYY-MM-01)
  
  -- Fee breakdown
  platform_fees_due NUMERIC(20, 2) NOT NULL DEFAULT 0,      -- 0.75% on deposits (NET after VALR)
  performance_fees_due NUMERIC(20, 2) NOT NULL DEFAULT 0,   -- 10% on HWM profits
  exchange_fees_info NUMERIC(20, 2) NOT NULL DEFAULT 0,     -- VALR fees (informational only, not charged by us)
  total_fees_due NUMERIC(20, 2) GENERATED ALWAYS AS (platform_fees_due + performance_fees_due) STORED,
  
  -- Payment tracking
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'overdue', 'waived')),
  due_date DATE NOT NULL,  -- 15th of following month
  paid_date DATE,
  total_fees_paid NUMERIC(20, 2) DEFAULT 0,
  payment_reference TEXT,  -- Bank transfer reference, manual recording
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(customer_id, invoice_month)
);

CREATE INDEX idx_fee_invoices_customer ON lth_pvr.fee_invoices(customer_id, invoice_month DESC);
CREATE INDEX idx_fee_invoices_status ON lth_pvr.fee_invoices(status, due_date) WHERE status IN ('unpaid', 'overdue');
CREATE INDEX idx_fee_invoices_org ON lth_pvr.fee_invoices(org_id, invoice_month);

COMMENT ON TABLE lth_pvr.fee_invoices IS 'Monthly fee invoices showing platform and performance fees breakdown';
COMMENT ON COLUMN lth_pvr.fee_invoices.exchange_fees_info IS 'VALR exchange fees (informational only, not charged by BitWealth)';
COMMENT ON COLUMN lth_pvr.fee_invoices.status IS 'Payment status: unpaid (initial), paid (confirmed), overdue (past due_date), waived (admin discretion)';


-- =============================================================================
-- 4. Create withdrawal_fee_snapshots - Pre-withdrawal state for reversions
-- =============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.withdrawal_fee_snapshots (
  snapshot_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id BIGINT NOT NULL,
  withdrawal_request_id UUID NOT NULL,  -- Links to future withdrawal_requests table
  
  -- Pre-withdrawal state (for reversion if withdrawal fails/declined)
  snapshot_date DATE NOT NULL,
  pre_withdrawal_hwm NUMERIC(20, 2) NOT NULL,
  pre_withdrawal_contrib_net NUMERIC(20, 2) NOT NULL,
  pre_withdrawal_nav NUMERIC(20, 2) NOT NULL,
  
  -- Interim fee charged at withdrawal request
  interim_performance_fee NUMERIC(20, 2) NOT NULL DEFAULT 0,
  new_hwm NUMERIC(20, 2) NOT NULL,  -- HWM after interim fee
  
  -- Reversion tracking
  reverted BOOLEAN NOT NULL DEFAULT FALSE,
  reverted_at TIMESTAMPTZ,
  reversion_reason TEXT,  -- 'withdrawal_declined', 'withdrawal_failed', 'admin_override'
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(withdrawal_request_id)
);

CREATE INDEX idx_withdrawal_snapshots_customer ON lth_pvr.withdrawal_fee_snapshots(customer_id, snapshot_date DESC);
CREATE INDEX idx_withdrawal_snapshots_reverted ON lth_pvr.withdrawal_fee_snapshots(reverted) WHERE reverted = FALSE;

COMMENT ON TABLE lth_pvr.withdrawal_fee_snapshots IS 'Stores pre-withdrawal HWM state to enable reversion if withdrawal is declined or fails';
COMMENT ON COLUMN lth_pvr.withdrawal_fee_snapshots.reverted IS 'TRUE if snapshot was used to revert HWM (withdrawal declined/failed)';


-- =============================================================================
-- 5. Create fee_conversion_approvals - BTC→USDT approval workflow
-- =============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.fee_conversion_approvals (
  approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id BIGINT NOT NULL,
  
  -- Conversion details
  usdt_needed NUMERIC(20, 2) NOT NULL,           -- USDT amount needed for fee payment
  btc_to_sell NUMERIC(20, 8) NOT NULL,           -- BTC amount to sell (with 2% buffer)
  btc_price_estimate NUMERIC(20, 2) NOT NULL,    -- BTC price at approval request time
  conversion_buffer_pct NUMERIC(5, 2) NOT NULL DEFAULT 2.00,  -- Slippage buffer (2%)
  
  -- Approval workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'expired', 'executed')),
  approval_token UUID NOT NULL DEFAULT gen_random_uuid(),  -- Secure approval link token
  expires_at TIMESTAMPTZ NOT NULL,  -- 24-hour expiry
  
  -- Customer action tracking
  approved_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  decline_reason TEXT,
  
  -- Execution tracking
  executed_at TIMESTAMPTZ,
  order_id UUID,  -- Links to lth_pvr.exchange_orders
  actual_btc_sold NUMERIC(20, 8),
  actual_usdt_received NUMERIC(20, 2),
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(approval_token)
);

CREATE INDEX idx_fee_conversion_customer ON lth_pvr.fee_conversion_approvals(customer_id, created_at DESC);
CREATE INDEX idx_fee_conversion_status ON lth_pvr.fee_conversion_approvals(status, expires_at) WHERE status = 'pending';
CREATE INDEX idx_fee_conversion_token ON lth_pvr.fee_conversion_approvals(approval_token) WHERE status = 'pending';

COMMENT ON TABLE lth_pvr.fee_conversion_approvals IS 'Customer approval workflow for selling BTC to cover USDT fees';
COMMENT ON COLUMN lth_pvr.fee_conversion_approvals.conversion_buffer_pct IS '2% slippage buffer per compliance agreements';
COMMENT ON COLUMN lth_pvr.fee_conversion_approvals.approval_token IS 'Secure UUID for approval link (one-time use)';


-- =============================================================================
-- 6. Create valr_transfer_log - Platform fee transfer audit trail
-- =============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.valr_transfer_log (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id BIGINT NOT NULL,
  
  -- Transfer details
  transfer_type TEXT NOT NULL CHECK (transfer_type IN ('platform_fee', 'performance_fee', 'manual')),
  currency TEXT NOT NULL CHECK (currency IN ('USDT', 'BTC', 'ZAR')),
  amount NUMERIC(20, 8) NOT NULL,
  
  -- VALR API details
  from_subaccount_id TEXT NOT NULL,
  to_account TEXT NOT NULL DEFAULT 'main',  -- Usually 'main' BitWealth account
  valr_api_response JSONB,  -- Full VALR API response for debugging
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  
  -- Links to ledger
  ledger_id UUID REFERENCES lth_pvr.ledger_lines(ledger_id),
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  UNIQUE(ledger_id, transfer_type)
);

CREATE INDEX idx_valr_transfer_customer ON lth_pvr.valr_transfer_log(customer_id, created_at DESC);
CREATE INDEX idx_valr_transfer_status ON lth_pvr.valr_transfer_log(status, created_at) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_valr_transfer_type ON lth_pvr.valr_transfer_log(transfer_type, created_at DESC);

COMMENT ON TABLE lth_pvr.valr_transfer_log IS 'Audit trail for all VALR subaccount→main account transfers (platform fees, performance fees)';
COMMENT ON COLUMN lth_pvr.valr_transfer_log.valr_api_response IS 'Full VALR API response stored as JSONB for debugging transfer issues';


-- =============================================================================
-- 6b. Add Foreign Key Constraints (after all tables created)
-- =============================================================================

ALTER TABLE lth_pvr.ledger_lines
  ADD CONSTRAINT fk_conversion_approval 
  FOREIGN KEY (conversion_approval_id) 
  REFERENCES lth_pvr.fee_conversion_approvals(approval_id);

ALTER TABLE lth_pvr.valr_transfer_log
  ADD CONSTRAINT fk_ledger_line
  FOREIGN KEY (ledger_id)
  REFERENCES lth_pvr.ledger_lines(ledger_id);


-- =============================================================================
-- 7. Row Level Security (RLS) Policies
-- =============================================================================

-- Service role bypass for all fee tables
ALTER TABLE lth_pvr.customer_state_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_customer_state ON lth_pvr.customer_state_daily
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

ALTER TABLE lth_pvr.fee_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_fee_invoices ON lth_pvr.fee_invoices
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

ALTER TABLE lth_pvr.withdrawal_fee_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_withdrawal_snapshots ON lth_pvr.withdrawal_fee_snapshots
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

ALTER TABLE lth_pvr.fee_conversion_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_fee_conversions ON lth_pvr.fee_conversion_approvals
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

ALTER TABLE lth_pvr.valr_transfer_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_valr_transfers ON lth_pvr.valr_transfer_log
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');


-- =============================================================================
-- 8. Initialization: Seed customer_state_daily for existing customers
-- =============================================================================

-- Initialize HWM state for all existing active customers
-- HWM = current NAV - cumulative net contributions
INSERT INTO lth_pvr.customer_state_daily (
  org_id,
  customer_id,
  trade_date,
  high_water_mark_usd,
  hwm_contrib_net_cum,
  last_perf_fee_month
)
SELECT 
  cs.org_id,
  cs.customer_id,
  CURRENT_DATE AS trade_date,
  -- HWM = NAV - net contributions (profit component only)
  COALESCE(bd.nav_usd, 0) - COALESCE(contrib.net_contrib, 0) AS high_water_mark_usd,
  0.00 AS hwm_contrib_net_cum,  -- Reset to 0 (no new contributions since HWM)
  NULL AS last_perf_fee_month    -- No performance fee charged yet
FROM public.customer_strategies cs
LEFT JOIN LATERAL (
  SELECT 
    nav_usd,
    btc_balance,
    usdt_balance
  FROM lth_pvr.balances_daily
  WHERE customer_id = cs.customer_id
  ORDER BY date DESC
  LIMIT 1
) bd ON true
LEFT JOIN LATERAL (
  SELECT 
    SUM(CASE WHEN kind = 'deposit' THEN amount_usdt ELSE 0 END) -
    SUM(CASE WHEN kind = 'withdrawal' THEN amount_usdt ELSE 0 END) AS net_contrib
  FROM lth_pvr.ledger_lines
  WHERE customer_id = cs.customer_id
) contrib ON true
WHERE cs.status = 'active'
ON CONFLICT (customer_id, trade_date) DO NOTHING;


-- =============================================================================
-- 9. Verification Queries
-- =============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Check ledger_lines columns added
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'lth_pvr'
    AND table_name = 'ledger_lines'
    AND column_name IN ('platform_fee_usdt', 'platform_fee_btc', 'performance_fee_usdt');
  
  IF v_count = 3 THEN
    RAISE NOTICE '✓ ledger_lines extended with 3 fee columns';
  ELSE
    RAISE WARNING 'ledger_lines fee columns incomplete (found %, expected 3)', v_count;
  END IF;

  -- Check new tables created
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'lth_pvr'
    AND table_name IN ('customer_state_daily', 'fee_invoices', 'withdrawal_fee_snapshots', 
                       'fee_conversion_approvals', 'valr_transfer_log');
  
  IF v_count = 5 THEN
    RAISE NOTICE '✓ 5 new fee system tables created';
  ELSE
    RAISE WARNING 'Fee system tables incomplete (found %, expected 5)', v_count;
  END IF;

  -- Check customer_state_daily initialization
  SELECT COUNT(*) INTO v_count
  FROM lth_pvr.customer_state_daily;
  
  RAISE NOTICE '✓ customer_state_daily initialized with % customer HWM records', v_count;
END $$;
