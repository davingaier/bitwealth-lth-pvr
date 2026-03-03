-- public.get_customer_onboarding_status.fn.sql
-- Purpose: Get customer onboarding milestone status
-- Called by: Customer portal dashboard (for non-active customers)
-- RLS: Customer can only see their own status
-- Updated: 2026-02-25 — tracks all 4 KYC document sections

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
  v_docs_uploaded INT;
  v_all_kyc_docs BOOLEAN;
BEGIN
  -- Get customer details
  SELECT 
    registration_status,
    kyc_id_document_url,
    kyc_proof_address_url,
    kyc_source_of_income,
    kyc_source_of_income_doc_url,
    kyc_bank_confirmation_url,
    created_at
  INTO v_customer
  FROM public.customer_details
  WHERE customer_id = p_customer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Customer not found');
  END IF;

  -- Check whether all 4 KYC document sections have been completed
  v_all_kyc_docs :=
    v_customer.kyc_id_document_url          IS NOT NULL AND
    v_customer.kyc_proof_address_url         IS NOT NULL AND
    v_customer.kyc_source_of_income          IS NOT NULL AND
    v_customer.kyc_source_of_income_doc_url  IS NOT NULL AND
    v_customer.kyc_bank_confirmation_url     IS NOT NULL;

  -- Count completed doc sections for progress display
  v_docs_uploaded :=
    (CASE WHEN v_customer.kyc_id_document_url          IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_customer.kyc_proof_address_url         IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_customer.kyc_source_of_income_doc_url  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN v_customer.kyc_bank_confirmation_url     IS NOT NULL THEN 1 ELSE 0 END);

  -- Determine milestone (1-6) based on registration_status
  CASE v_customer.registration_status
    WHEN 'prospect' THEN 
      v_milestone := 1;
      v_next_action := 'Waiting for admin to confirm interest and select strategy';
    WHEN 'kyc' THEN 
      v_milestone := 3;
      IF v_all_kyc_docs THEN
        v_next_action := 'All KYC documents received - verification in progress';
      ELSE
        v_next_action := 'Please upload all required KYC documents (' || v_docs_uploaded || '/4 complete)';
      END IF;
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
      v_next_action := 'Account inactive';
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
    'customer_id',                p_customer_id,
    'current_milestone',          v_milestone,
    'milestone_statuses',         v_milestones,
    'next_action',                v_next_action,
    'portal_access_granted',      v_portal_access,
    'registration_status',        v_customer.registration_status,
    -- Legacy key (kept for backwards compatibility)
    'kyc_id_uploaded',            v_customer.kyc_id_document_url IS NOT NULL,
    -- Granular KYC document status
    'kyc_docs_uploaded',          v_docs_uploaded,
    'kyc_all_docs_uploaded',      v_all_kyc_docs,
    'kyc_id_doc_uploaded',        v_customer.kyc_id_document_url          IS NOT NULL,
    'kyc_proof_address_uploaded', v_customer.kyc_proof_address_url         IS NOT NULL,
    'kyc_source_of_income_set',   v_customer.kyc_source_of_income          IS NOT NULL,
    'kyc_income_doc_uploaded',    v_customer.kyc_source_of_income_doc_url  IS NOT NULL,
    'kyc_bank_conf_uploaded',     v_customer.kyc_bank_confirmation_url     IS NOT NULL,
    'created_at',                 v_customer.created_at
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_customer_onboarding_status(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.get_customer_onboarding_status IS 'Returns customer onboarding pipeline status (6 milestones) and next action required. Tracks all 4 KYC document sections.';
