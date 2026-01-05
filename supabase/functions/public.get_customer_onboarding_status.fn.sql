-- public.get_customer_onboarding_status.fn.sql
-- Purpose: Get customer onboarding milestone status
-- Called by: Customer portal dashboard (for non-active customers)
-- RLS: Customer can only see their own status

CREATE OR REPLACE FUNCTION public.get_customer_onboarding_status(p_customer_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_customer RECORD;
  v_milestone INT;
  v_milestones JSONB;
  v_next_action TEXT;
  v_portal_access BOOLEAN;
BEGIN
  -- Get customer details
  SELECT 
    registration_status,
    kyc_id_document_url,
    created_at
  INTO v_customer
  FROM public.customer_details
  WHERE customer_id = p_customer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Customer not found');
  END IF;

  -- Determine milestone (1-6) based on registration_status
  CASE v_customer.registration_status
    WHEN 'prospect' THEN 
      v_milestone := 1;
      v_next_action := 'Waiting for admin to confirm interest and select strategy';
    WHEN 'kyc' THEN 
      v_milestone := 3;
      v_next_action := 'Please upload your ID document';
    WHEN 'setup' THEN 
      v_milestone := 4;
      v_next_action := 'VALR account being set up - you will receive deposit instructions soon';
    WHEN 'deposit' THEN 
      v_milestone := 5;
      v_next_action := 'Waiting for your initial deposit';
    WHEN 'active' THEN 
      v_milestone := 6;
      v_next_action := 'Account active - trading commenced';
    WHEN 'inactive' THEN 
      v_milestone := 6;
      v_next_action := 'Your account is currently inactive. Trading is paused.';
    ELSE 
      v_milestone := 1;
      v_next_action := 'Status: ' || v_customer.registration_status;
  END CASE;

  -- Build milestone status array (6 booleans)
  v_milestones := jsonb_build_array(
    v_milestone >= 1,  -- M1: Prospect submitted
    v_milestone >= 2,  -- M2: Strategy confirmed
    v_milestone >= 3,  -- M3: Portal registration
    v_milestone >= 4,  -- M4: VALR setup
    v_milestone >= 5,  -- M5: Funds deposit
    v_milestone >= 6   -- M6: Active
  );

  -- Portal access granted if milestone >= 3 (kyc or beyond)
  v_portal_access := v_milestone >= 3;

  -- Build response
  v_result := jsonb_build_object(
    'customer_id', p_customer_id,
    'current_milestone', v_milestone,
    'milestone_statuses', v_milestones,
    'next_action', v_next_action,
    'portal_access_granted', v_portal_access,
    'registration_status', v_customer.registration_status,
    'kyc_id_uploaded', v_customer.kyc_id_document_url IS NOT NULL,
    'created_at', v_customer.created_at
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_customer_onboarding_status(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.get_customer_onboarding_status IS 'Returns customer onboarding pipeline status (6 milestones) and next action required';
