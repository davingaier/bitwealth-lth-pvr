-- Migration: Add Customer Portal Columns to Existing Tables
-- Created: 2025-12-29
-- Purpose: Extend existing tables for customer lifecycle management

-- =============================================
-- 1. Add columns to public.customer_details
-- =============================================
ALTER TABLE public.customer_details
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS phone_country_code TEXT,
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS upfront_investment_amount_range TEXT,
ADD COLUMN IF NOT EXISTS monthly_investment_amount_range TEXT,
ADD COLUMN IF NOT EXISTS prospect_message TEXT,
ADD COLUMN IF NOT EXISTS kyc_id_document_url TEXT,
ADD COLUMN IF NOT EXISTS kyc_id_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS kyc_verified_by UUID,
ADD COLUMN IF NOT EXISTS portal_access_granted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS disclaimer_signed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.customer_details.phone_country_code IS 'Country dialing code, e.g., +27 for South Africa';
COMMENT ON COLUMN public.customer_details.upfront_investment_amount_range IS 'Initial lump sum investment range (e.g., R10000-R50000)';
COMMENT ON COLUMN public.customer_details.monthly_investment_amount_range IS 'Recurring monthly contribution range (e.g., R1000-R5000)';
COMMENT ON COLUMN public.customer_details.prospect_message IS 'Initial message from interest form';
COMMENT ON COLUMN public.customer_details.kyc_id_document_url IS 'Supabase Storage URL for uploaded ID document';
COMMENT ON COLUMN public.customer_details.kyc_verified_by IS 'Admin user ID who verified KYC documents';
COMMENT ON COLUMN public.customer_details.portal_access_granted_at IS 'Timestamp when customer received portal login credentials';

-- =============================================
-- 2. Add columns to public.exchange_accounts
-- =============================================
ALTER TABLE public.exchange_accounts
ADD COLUMN IF NOT EXISTS deposit_reference TEXT;

COMMENT ON COLUMN public.exchange_accounts.deposit_reference IS 'VALR deposit reference code for customer deposits (manually retrieved from VALR UI)';

-- =============================================
-- 3. Create indexes for new columns
-- =============================================
CREATE INDEX IF NOT EXISTS idx_customer_details_status ON public.customer_details(status);
CREATE INDEX IF NOT EXISTS idx_customer_details_email ON public.customer_details(email);
CREATE INDEX IF NOT EXISTS idx_customer_details_portal_access ON public.customer_details(portal_access_granted_at) WHERE portal_access_granted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_details_kyc_verified ON public.customer_details(kyc_id_verified_at) WHERE kyc_id_verified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exchange_accounts_deposit_ref ON public.exchange_accounts(deposit_reference) WHERE deposit_reference IS NOT NULL;
