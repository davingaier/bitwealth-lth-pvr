-- Migration: 20260429_statement_redesign
-- Purpose: Support the redesigned monthly customer statement (HTML+Browserless PDF).
-- Adds:
--   1. lth_pvr.statements_sent       — idempotency guard so a statement is generated/emailed
--                                       at most once per (customer_id, statement_month).
--   2. public storage bucket: branding — holds the BitWealth logo (SVG) and other shared
--                                       brand assets used in PDFs, emails and the portal.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Idempotency table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lth_pvr.statements_sent (
  statement_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL,
  customer_id       BIGINT      NOT NULL REFERENCES public.customer_details(customer_id) ON DELETE CASCADE,
  statement_month   DATE        NOT NULL, -- always first day of the statement period (YYYY-MM-01)
  storage_path      TEXT        NOT NULL, -- path within the customer-statements bucket
  filename          TEXT        NOT NULL,
  download_url      TEXT,                  -- last issued signed URL (informational only)
  pdf_bytes         INT,                   -- size of generated PDF (sanity / monitoring)
  emailed_at        TIMESTAMPTZ,           -- NULL until ef_monthly_statement_generator emails it
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generator_version TEXT        NOT NULL DEFAULT 'v2-html',
  CONSTRAINT statements_sent_unique_per_month
    UNIQUE (org_id, customer_id, statement_month)
);

CREATE INDEX IF NOT EXISTS idx_statements_sent_customer_month
  ON lth_pvr.statements_sent (customer_id, statement_month DESC);

CREATE INDEX IF NOT EXISTS idx_statements_sent_unsent
  ON lth_pvr.statements_sent (statement_month)
  WHERE emailed_at IS NULL;

COMMENT ON TABLE lth_pvr.statements_sent IS
  'Idempotency record for monthly customer statements. Inserted by ef_generate_statement after a successful PDF render+upload. ef_monthly_statement_generator skips customers already present for the target month, then sets emailed_at after a successful send.';

COMMENT ON COLUMN lth_pvr.statements_sent.statement_month IS
  'First day of the statement period (e.g. 2026-03-01 for the March 2026 statement).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Public storage bucket for brand assets
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent: ON CONFLICT (id) DO NOTHING so re-running this migration is safe.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branding',
  'branding',
  TRUE,                                        -- public bucket: logo URLs are not secrets
  5242880,                                     -- 5 MB per asset is plenty for SVGs/PNGs
  ARRAY['image/svg+xml','image/png','image/jpeg','image/x-icon','image/vnd.microsoft.icon']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Public read policy (anyone can fetch a logo by URL — these are not secrets and they
-- are referenced from rendered PDFs and from the public-facing website).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'branding_public_read'
  ) THEN
    CREATE POLICY branding_public_read
      ON storage.objects FOR SELECT
      USING (bucket_id = 'branding');
  END IF;
END$$;

-- Authenticated upload policy (service role bypasses RLS already; this lets future
-- admin-side uploads via the dashboard work without per-call grants).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'branding_authenticated_write'
  ) THEN
    CREATE POLICY branding_authenticated_write
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'branding' AND auth.role() = 'authenticated');
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper RPC: has the statement for (customer, month) already been generated?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION lth_pvr.statement_already_generated(
  p_org_id          UUID,
  p_customer_id     BIGINT,
  p_statement_month DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM lth_pvr.statements_sent
    WHERE org_id = p_org_id
      AND customer_id = p_customer_id
      AND statement_month = date_trunc('month', p_statement_month)::date
  );
$$;

GRANT EXECUTE ON FUNCTION lth_pvr.statement_already_generated(UUID, BIGINT, DATE) TO service_role, authenticated;
