-- ============================================================================
-- Finova KYCDD integration — schema
-- Date: 2026-07-31
-- Purpose: Support receiving KYC data + documents from Finova/KYCDD via webhook.
--   1. Relax the 6-value kyc_source_of_income CHECK (Finova sends its own values,
--      often a joined list e.g. "Salary").
--   2. Add columns on customer_details for structured address, source of
--      funds/wealth, marital status, the extra Finova documents, and the Finova
--      client UUID.
--   3. New public.kyc_finova table: one row per customer tracking the Finova
--      onboarding (status, risk scores, screening result, document archive,
--      last raw payload). Service-role only.
--
-- registration_status is intentionally NOT extended — the customer stays 'kyc'
-- through the whole Finova phase; granular state lives in kyc_finova.finova_status.
-- ============================================================================

-- 1. Relax source-of-income constraint (Finova values differ from our old 6) ----
ALTER TABLE public.customer_details
  DROP CONSTRAINT IF EXISTS chk_kyc_source_of_income;

-- 2. New columns on customer_details -----------------------------------------
ALTER TABLE public.customer_details
  ADD COLUMN IF NOT EXISTS address_line1                 text,
  ADD COLUMN IF NOT EXISTS address_line2                 text,
  ADD COLUMN IF NOT EXISTS address_line3                 text,
  ADD COLUMN IF NOT EXISTS city                          text,
  ADD COLUMN IF NOT EXISTS province                      text,
  ADD COLUMN IF NOT EXISTS postal_code                   text,
  ADD COLUMN IF NOT EXISTS source_of_funds               text,
  ADD COLUMN IF NOT EXISTS source_of_wealth              text,
  ADD COLUMN IF NOT EXISTS marital_status                text,
  ADD COLUMN IF NOT EXISTS kyc_selfie_url                text,
  ADD COLUMN IF NOT EXISTS kyc_selfie_uploaded_at        timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_id_backside_url           text,
  ADD COLUMN IF NOT EXISTS kyc_id_backside_uploaded_at   timestamptz,
  ADD COLUMN IF NOT EXISTS kyc_finova_report_url         text,
  ADD COLUMN IF NOT EXISTS finova_client_id              text;

-- 3. kyc_finova tracking table -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.kyc_finova (
  kyc_finova_id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id              bigint NOT NULL UNIQUE
                             REFERENCES public.customer_details(customer_id),
  org_id                   uuid,
  finova_client_id         text,          -- Finova's own client UUID
  finova_status            text NOT NULL DEFAULT 'invited',
                             -- invited | in_progress | passed | rejected | review | error
  current_step             text,          -- payload "step" (e.g. 'passed')
  status_type_id           text,          -- payload "status_type_id"
  client_risk_score        numeric,
  liveness_risk_score      numeric,
  doc_discrepancy_risk_score numeric,
  screening                jsonb,          -- raw complyadvantage_mesh_screening object
  screening_status         text,          -- 'clear' | 'hit' | 'unknown' (TODO: Finova rep)
  doc_urls                 jsonb,          -- re-hosted archive: report/mandate/addendum URLs
  investment_profile       jsonb,          -- suitability answers + scores
  register_email_sent_at   timestamptz,    -- idempotency guard for the post-approval email
  invited_at               timestamptz,
  completed_at             timestamptz,
  last_event_at            timestamptz,
  last_payload             jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kyc_finova IS
  'Tracks each customer''s Finova/KYCDD onboarding. One row per customer. Service-role only.';

-- Service-role-only access: enable RLS, add no policies.
ALTER TABLE public.kyc_finova ENABLE ROW LEVEL SECURITY;
