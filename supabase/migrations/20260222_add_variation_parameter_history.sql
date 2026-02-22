-- Migration: Add variation_parameter_history table for audit trail
-- Date: 2026-02-22
-- Purpose: Track parameter changes for strategy variations with rollback capability

-- Create parameter history table
CREATE TABLE IF NOT EXISTS lth_pvr.variation_parameter_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_id UUID NOT NULL REFERENCES lth_pvr.strategy_variation_templates(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  
  -- Change metadata
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES auth.users(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('manual', 'optimization', 'rollback', 'initial')),
  change_reason TEXT,
  
  -- Configuration snapshots (JSONB for flexibility)
  old_config JSONB,  -- Previous configuration (NULL for initial/first change)
  new_config JSONB NOT NULL,  -- New configuration after change
  
  -- Impact metrics (optional, populated post-change)
  impact_metrics JSONB,  -- { navDelta, roiDelta, etc. }
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_variation_parameter_history_variation 
ON lth_pvr.variation_parameter_history(variation_id, changed_at DESC);

CREATE INDEX idx_variation_parameter_history_org 
ON lth_pvr.variation_parameter_history(org_id, changed_at DESC);

-- Add comments for documentation
COMMENT ON TABLE lth_pvr.variation_parameter_history IS 
  'Audit trail for parameter changes to strategy variations. Enables rollback and change tracking.';

COMMENT ON COLUMN lth_pvr.variation_parameter_history.change_type IS 
  'Type of change: manual (user edit), optimization (from optimizer), rollback (revert), initial (first version)';

COMMENT ON COLUMN lth_pvr.variation_parameter_history.old_config IS 
  'JSON snapshot of configuration BEFORE change. NULL for initial creation.';

COMMENT ON COLUMN lth_pvr.variation_parameter_history.new_config IS 
  'JSON snapshot of configuration AFTER change. Format: { B: {B1-B11}, bearPauseEnterSigma, bearPauseExitSigma, momentumLength, momentumThreshold, enableRetrace, retraceBase }';

COMMENT ON COLUMN lth_pvr.variation_parameter_history.impact_metrics IS 
  'Optional metrics calculated after change takes effect. Format: { navDelta: number, roiDelta: number, cagrDelta: number }';

-- RLS policies (inherit from variation_templates, org-level security)
ALTER TABLE lth_pvr.variation_parameter_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY variation_parameter_history_org_isolation
ON lth_pvr.variation_parameter_history
FOR ALL
USING (org_id = current_setting('app.current_org_id')::UUID);

-- Function to log parameter changes automatically (called from applyOptimizedConfig)
CREATE OR REPLACE FUNCTION lth_pvr.log_parameter_change(
  p_variation_id UUID,
  p_org_id UUID,
  p_changed_by UUID,
  p_change_type TEXT,
  p_change_reason TEXT,
  p_old_config JSONB,
  p_new_config JSONB
) RETURNS UUID AS $$
DECLARE
  v_history_id UUID;
BEGIN
  INSERT INTO lth_pvr.variation_parameter_history (
    variation_id,
    org_id,
    changed_by,
    change_type,
    change_reason,
    old_config,
    new_config
  ) VALUES (
    p_variation_id,
    p_org_id,
    p_changed_by,
    p_change_type,
    p_change_reason,
    p_old_config,
    p_new_config
  )
  RETURNING id INTO v_history_id;
  
  RETURN v_history_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION lth_pvr.log_parameter_change IS 
  'Logs a parameter change to the history table. Called by applyOptimizedConfig and rollback functions.';
