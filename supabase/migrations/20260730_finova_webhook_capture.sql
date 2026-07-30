-- ============================================================================
-- TEMPORARY: Finova KYCDD webhook capture table
-- Date: 2026-07-30
-- Purpose: Capture the exact webhook payload Finova/KYCDD POSTs when a client
--          completes the onboarding workflow, so we can finalise the field
--          mapping and confirm the signature format BEFORE building the real
--          ef_finova_webhook. Used for a one-off test run with customer 60.
--
-- SECURITY: Rows contain real KYC PII. RLS is enabled with NO policies, so the
--           table is readable/writable ONLY via the service role (the edge
--           function and admin/SQL editor). anon/authenticated get nothing.
--
-- CLEANUP: This table and the ef_finova_webhook_test function are throwaway.
--          After the sample payload is captured and mapping is finalised, drop
--          both:  DROP TABLE public.finova_webhook_capture;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.finova_webhook_capture (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now(),
  method       text,
  content_type text,
  signature    text,            -- value of the X-Signature-SHA256 header
  source_ip    text,
  byte_length  integer,
  headers      jsonb,           -- all request headers (for inspection)
  raw_body     text,            -- exact bytes received (needed to verify signature)
  parsed       jsonb            -- best-effort JSON.parse of raw_body (may be null)
);

COMMENT ON TABLE public.finova_webhook_capture IS
  'TEMPORARY capture of Finova KYCDD webhook payloads for integration testing (customer 60). Contains PII. Service-role only. Drop after mapping is finalised.';

-- Service-role-only access: enable RLS, add no policies.
ALTER TABLE public.finova_webhook_capture ENABLE ROW LEVEL SECURITY;
