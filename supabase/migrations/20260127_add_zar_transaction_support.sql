-- Migration: Add ZAR Transaction Support (Phase 1)
-- Date: 2026-01-27
-- Purpose: Enable tracking of ZAR deposits, conversions (both directions), and withdrawals

-- ============================================================================
-- 1. Extend funding_event_kind enum with ZAR transaction types
-- ============================================================================

-- Add new kinds for ZAR flow:
-- - zar_deposit: ZAR deposited into subaccount (before conversion)
-- - zar_balance: ZAR received from USDT→ZAR conversion (before bank withdrawal)
-- - zar_withdrawal: ZAR withdrawn to bank account

ALTER TYPE lth_pvr.funding_event_kind ADD VALUE IF NOT EXISTS 'zar_deposit';
ALTER TYPE lth_pvr.funding_event_kind ADD VALUE IF NOT EXISTS 'zar_balance';
ALTER TYPE lth_pvr.funding_event_kind ADD VALUE IF NOT EXISTS 'zar_withdrawal';

-- ============================================================================
-- 2. Add metadata column to exchange_funding_events
-- ============================================================================

-- Stores conversion details to link related transactions:
-- For ZAR→USDT conversions (LIMIT_BUY):
--   {
--     "zar_deposit_id": "uuid",           -- Links to original zar_deposit
--     "zar_amount": 150.00,               -- ZAR spent in conversion
--     "conversion_rate": 16.18,           -- ZAR/USDT rate
--     "conversion_fee_zar": 0.27,         -- VALR's fee in ZAR (0.18%)
--     "conversion_fee_usdt": 0.01672812   -- VALR's fee in USDT
--   }
--
-- For USDT→ZAR conversions (LIMIT_SELL):
--   {
--     "usdt_amount": 10.00,               -- USDT spent in conversion
--     "conversion_rate": 16.20,           -- ZAR/USDT rate
--     "conversion_fee_usdt": 0.018,       -- VALR's fee in USDT (0.18%)
--     "conversion_fee_zar": 0.29          -- VALR's fee in ZAR
--   }

ALTER TABLE lth_pvr.exchange_funding_events 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN lth_pvr.exchange_funding_events.metadata IS 
'Stores conversion details linking related transactions (deposits, conversions, withdrawals)';

-- ============================================================================
-- 3. Create pending_zar_conversions table for admin notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.pending_zar_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES public.customer_details(customer_id),
  funding_id UUID NOT NULL REFERENCES lth_pvr.exchange_funding_events(funding_id),
  zar_amount NUMERIC(15,2) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  notified_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  conversion_funding_id UUID REFERENCES lth_pvr.exchange_funding_events(funding_id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE lth_pvr.pending_zar_conversions IS 
'Tracks ZAR deposits awaiting manual conversion to USDT for admin notification';

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_pending_zar_unconverted 
ON lth_pvr.pending_zar_conversions(customer_id, org_id, converted_at) 
WHERE converted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_zar_customer 
ON lth_pvr.pending_zar_conversions(customer_id);

CREATE INDEX IF NOT EXISTS idx_pending_zar_occurred 
ON lth_pvr.pending_zar_conversions(occurred_at DESC);

-- RLS policies for pending_zar_conversions
ALTER TABLE lth_pvr.pending_zar_conversions ENABLE ROW LEVEL SECURITY;

-- Admin users can view all pending conversions in their org
CREATE POLICY "Allow org admins to view pending conversions"
ON lth_pvr.pending_zar_conversions
FOR SELECT
USING (
  org_id IN (
    SELECT om.org_id 
    FROM public.org_members om 
    WHERE om.user_id = auth.uid() 
      AND om.role IN ('admin', 'owner')
  )
);

-- System can insert/update pending conversions
CREATE POLICY "Allow system to manage pending conversions"
ON lth_pvr.pending_zar_conversions
FOR ALL
USING (true)
WITH CHECK (true);

-- ============================================================================
-- 4. Create function to auto-insert pending conversions on ZAR deposits
-- ============================================================================

CREATE OR REPLACE FUNCTION lth_pvr.on_zar_deposit_create_pending()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create pending conversion for ZAR deposits
  IF NEW.kind = 'zar_deposit' THEN
    INSERT INTO lth_pvr.pending_zar_conversions (
      org_id,
      customer_id,
      funding_id,
      zar_amount,
      occurred_at
    )
    VALUES (
      NEW.org_id,
      NEW.customer_id,
      NEW.funding_id,
      NEW.amount,
      NEW.occurred_at
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create pending conversion records
DROP TRIGGER IF EXISTS trigger_zar_deposit_pending ON lth_pvr.exchange_funding_events;
CREATE TRIGGER trigger_zar_deposit_pending
  AFTER INSERT ON lth_pvr.exchange_funding_events
  FOR EACH ROW
  EXECUTE FUNCTION lth_pvr.on_zar_deposit_create_pending();

-- ============================================================================
-- 5. Create function to auto-resolve pending conversions
-- ============================================================================

CREATE OR REPLACE FUNCTION lth_pvr.on_zar_conversion_resolve_pending()
RETURNS TRIGGER AS $$
DECLARE
  v_zar_deposit_id UUID;
BEGIN
  -- Only process USDT deposits with ZAR conversion metadata
  IF NEW.kind = 'deposit' 
     AND NEW.asset = 'USDT' 
     AND NEW.metadata ? 'zar_deposit_id' THEN
    
    v_zar_deposit_id := (NEW.metadata->>'zar_deposit_id')::UUID;
    
    -- Mark the pending conversion as converted
    UPDATE lth_pvr.pending_zar_conversions
    SET converted_at = NEW.occurred_at,
        conversion_funding_id = NEW.funding_id,
        updated_at = CURRENT_TIMESTAMP
    WHERE funding_id = v_zar_deposit_id
      AND converted_at IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-resolve pending conversions when conversion happens
DROP TRIGGER IF EXISTS trigger_zar_conversion_resolve ON lth_pvr.exchange_funding_events;
CREATE TRIGGER trigger_zar_conversion_resolve
  AFTER INSERT ON lth_pvr.exchange_funding_events
  FOR EACH ROW
  EXECUTE FUNCTION lth_pvr.on_zar_conversion_resolve_pending();

-- ============================================================================
-- 6. Create view for admin dashboard
-- ============================================================================

CREATE OR REPLACE VIEW lth_pvr.v_pending_zar_conversions AS
SELECT 
  pzc.id,
  pzc.org_id,
  pzc.customer_id,
  cd.first_names,
  cd.last_name,
  cd.email,
  pzc.zar_amount,
  pzc.occurred_at,
  pzc.notified_at,
  pzc.converted_at,
  pzc.notes,
  -- Age in hours
  EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - pzc.occurred_at)) / 3600 AS hours_pending,
  -- Customer's current USDT balance
  COALESCE(
    (SELECT usdt_balance 
     FROM lth_pvr.balances_daily 
     WHERE customer_id = pzc.customer_id 
     ORDER BY date DESC 
     LIMIT 1),
    0
  ) AS current_usdt_balance
FROM lth_pvr.pending_zar_conversions pzc
JOIN public.customer_details cd ON cd.customer_id = pzc.customer_id
WHERE pzc.converted_at IS NULL
ORDER BY pzc.occurred_at ASC;

COMMENT ON VIEW lth_pvr.v_pending_zar_conversions IS 
'Admin dashboard view showing ZAR deposits awaiting conversion to USDT';

-- ============================================================================
-- 7. Grant permissions
-- ============================================================================

-- Service role needs full access
GRANT ALL ON lth_pvr.pending_zar_conversions TO service_role;
GRANT ALL ON lth_pvr.v_pending_zar_conversions TO service_role;

-- Authenticated users can read view (RLS will filter by org)
GRANT SELECT ON lth_pvr.v_pending_zar_conversions TO authenticated;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
