-- Migration: add_kyc_additional_documents
-- Applied: 2026-03-03 via MCP
-- Purpose: Add 3 additional KYC document columns to customer_details
--   (proof of address, source of income, bank account confirmation letter)

ALTER TABLE public.customer_details
  ADD COLUMN IF NOT EXISTS kyc_proof_address_url           TEXT,
  ADD COLUMN IF NOT EXISTS kyc_proof_address_uploaded_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_source_of_income            TEXT,
  ADD COLUMN IF NOT EXISTS kyc_source_of_income_doc_url    TEXT,
  ADD COLUMN IF NOT EXISTS kyc_source_of_income_doc_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_bank_confirmation_url       TEXT,
  ADD COLUMN IF NOT EXISTS kyc_bank_confirmation_uploaded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.customer_details.kyc_proof_address_url           IS 'Supabase Storage URL for proof of address document';
COMMENT ON COLUMN public.customer_details.kyc_proof_address_uploaded_at   IS 'Timestamp when proof of address document was uploaded';
COMMENT ON COLUMN public.customer_details.kyc_source_of_income            IS 'Customer-selected source of income (dropdown value)';
COMMENT ON COLUMN public.customer_details.kyc_source_of_income_doc_url    IS 'Supabase Storage URL for source of income supporting document';
COMMENT ON COLUMN public.customer_details.kyc_source_of_income_doc_uploaded_at IS 'Timestamp when source of income document was uploaded';
COMMENT ON COLUMN public.customer_details.kyc_bank_confirmation_url       IS 'Supabase Storage URL for bank account confirmation letter';
COMMENT ON COLUMN public.customer_details.kyc_bank_confirmation_uploaded_at IS 'Timestamp when bank account confirmation letter was uploaded';

-- Constrain source of income to allowed values
ALTER TABLE public.customer_details
  ADD CONSTRAINT chk_kyc_source_of_income
    CHECK (
      kyc_source_of_income IS NULL OR
      kyc_source_of_income IN (
        'Employment / Salary',
        'Self-employment / Freelance',
        'Business income',
        'Investments / Dividends',
        'Pension / Retirement',
        'Inheritance / Gift'
      )
    );
