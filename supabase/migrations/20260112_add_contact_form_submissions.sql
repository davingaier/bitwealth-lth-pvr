-- Add contact_form_submissions table for website contact form tracking
-- Created: 2026-01-12
-- Purpose: Store contact form submissions with reCAPTCHA verification and email delivery tracking

CREATE TABLE IF NOT EXISTS public.contact_form_submissions (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    captcha_verified BOOLEAN NOT NULL DEFAULT false,
    admin_notified_at TIMESTAMPTZ,
    auto_reply_sent_at TIMESTAMPTZ,
    user_agent TEXT,
    ip_address TEXT
);

-- Index for email lookup (rate limiting)
CREATE INDEX IF NOT EXISTS idx_contact_form_email_date 
ON public.contact_form_submissions(email, created_at DESC);

-- Index for admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_contact_form_created_at 
ON public.contact_form_submissions(created_at DESC);

-- RLS policies (admin read-only, public insert via edge function)
ALTER TABLE public.contact_form_submissions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to contact_form_submissions"
ON public.contact_form_submissions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- No public read access (admin UI uses service role)
-- Public inserts handled via edge function with service role key

COMMENT ON TABLE public.contact_form_submissions IS 'Stores contact form submissions from website with reCAPTCHA verification and email delivery tracking';
COMMENT ON COLUMN public.contact_form_submissions.captcha_verified IS 'True if Google reCAPTCHA verification passed';
COMMENT ON COLUMN public.contact_form_submissions.admin_notified_at IS 'Timestamp when admin notification email sent to info@bitwealth.co.za';
COMMENT ON COLUMN public.contact_form_submissions.auto_reply_sent_at IS 'Timestamp when auto-reply confirmation email sent to submitter';
