-- Migration: Fee Management RPC
-- Created: 2025-12-29
-- Purpose: Allow admin to update customer fee rates (effective current month)

-- =============================================
-- RPC: Update Customer Fee Rate
-- =============================================
CREATE OR REPLACE FUNCTION public.update_customer_fee_rate(
  p_customer_id BIGINT,
  p_new_fee_rate NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, lth_pvr
AS $$
DECLARE
  v_org_id UUID;
  v_current_rate NUMERIC;
  v_result JSONB;
BEGIN
  -- Validate fee rate range (0% to 100%)
  IF p_new_fee_rate < 0 OR p_new_fee_rate > 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Fee rate must be between 0.00 (0%) and 1.00 (100%)'
    );
  END IF;

  -- Get customer's org_id and verify customer exists
  SELECT org_id INTO v_org_id
  FROM public.customer_details
  WHERE customer_id = p_customer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Customer not found'
    );
  END IF;

  -- Get current fee rate (if exists)
  SELECT fee_rate INTO v_current_rate
  FROM lth_pvr.fee_configs
  WHERE customer_id = p_customer_id;

  -- Insert or update fee_configs
  INSERT INTO lth_pvr.fee_configs (org_id, customer_id, fee_rate)
  VALUES (v_org_id, p_customer_id, p_new_fee_rate)
  ON CONFLICT (org_id, customer_id)
  DO UPDATE SET
    fee_rate = EXCLUDED.fee_rate,
    created_at = NOW();

  -- Return success with old and new rates
  v_result := jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'previous_fee_rate', COALESCE(v_current_rate, 0.10),
    'new_fee_rate', p_new_fee_rate,
    'effective_date', DATE_TRUNC('month', CURRENT_DATE),
    'message', 'Fee rate updated successfully. Will apply to current month when monthly close runs.'
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.update_customer_fee_rate IS 'Update BitWealth fee rate for a customer. Changes apply to current month when ef_fee_monthly_close runs on 1st of next month.';

-- Grant execute to authenticated users (admin only in practice via RLS)
GRANT EXECUTE ON FUNCTION public.update_customer_fee_rate TO authenticated;

-- =============================================
-- RPC: Get Customer Fee Rate
-- =============================================
CREATE OR REPLACE FUNCTION public.get_customer_fee_rate(
  p_customer_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, lth_pvr
AS $$
DECLARE
  v_fee_rate NUMERIC;
  v_settlement_mode TEXT;
  v_result JSONB;
BEGIN
  -- Get fee configuration
  SELECT fee_rate, settlement_mode
  INTO v_fee_rate, v_settlement_mode
  FROM lth_pvr.fee_configs
  WHERE customer_id = p_customer_id;

  -- Return config (with defaults if not found)
  v_result := jsonb_build_object(
    'customer_id', p_customer_id,
    'fee_rate', COALESCE(v_fee_rate, 0.10),
    'fee_percentage', COALESCE(v_fee_rate, 0.10) * 100,
    'settlement_mode', COALESCE(v_settlement_mode, 'usdt_or_sell_btc')
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_customer_fee_rate IS 'Get current BitWealth fee rate for a customer (defaults to 10% if not configured)';

GRANT EXECUTE ON FUNCTION public.get_customer_fee_rate TO authenticated;
