-- Migration: Add SMTP support to email_logs table
-- Date: 2026-01-04
-- Purpose: Replace Resend message ID with SMTP message ID

-- Add new SMTP message ID column
ALTER TABLE public.email_logs
ADD COLUMN IF NOT EXISTS smtp_message_id TEXT;

-- Rename old Resend column for backward compatibility
ALTER TABLE public.email_logs
RENAME COLUMN resend_message_id TO legacy_resend_message_id;

-- Add comments
COMMENT ON COLUMN public.email_logs.smtp_message_id IS 'Message ID returned by SMTP server';
COMMENT ON COLUMN public.email_logs.legacy_resend_message_id IS 'Legacy Resend message ID (deprecated, replaced by SMTP)';

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_email_logs_smtp_message_id 
ON public.email_logs(smtp_message_id) 
WHERE smtp_message_id IS NOT NULL;
