-- Migration: Create Customer Portal Tables
-- Created: 2025-12-29
-- Purpose: Add new tables for customer lifecycle management

-- =============================================
-- 1. withdrawal_requests
-- =============================================
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    customer_id UUID NOT NULL REFERENCES public.customer_details(customer_id),
    portfolio_id UUID REFERENCES public.customer_portfolios(portfolio_id),
    amount_usdt NUMERIC(20,8) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'completed', 'rejected')),
    notes TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    created_by UUID,
    approved_by UUID,
    CONSTRAINT positive_amount CHECK (amount_usdt > 0)
);

CREATE INDEX idx_withdrawal_requests_customer ON public.withdrawal_requests(customer_id);
CREATE INDEX idx_withdrawal_requests_status ON public.withdrawal_requests(status);
CREATE INDEX idx_withdrawal_requests_org ON public.withdrawal_requests(org_id);

COMMENT ON TABLE public.withdrawal_requests IS 'Customer withdrawal requests with approval workflow';
COMMENT ON COLUMN public.withdrawal_requests.amount_usdt IS 'Withdrawal amount in USDT. BTC will be sold if USDT balance insufficient';
COMMENT ON COLUMN public.withdrawal_requests.created_by IS 'Customer ID who requested withdrawal';
COMMENT ON COLUMN public.withdrawal_requests.approved_by IS 'Admin user ID who approved/rejected';

-- =============================================
-- 2. support_requests
-- =============================================
CREATE TABLE IF NOT EXISTS public.support_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    customer_id UUID REFERENCES public.customer_details(customer_id),
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID,
    resolution_notes TEXT
);

CREATE INDEX idx_support_requests_customer ON public.support_requests(customer_id);
CREATE INDEX idx_support_requests_status ON public.support_requests(status);
CREATE INDEX idx_support_requests_created ON public.support_requests(created_at DESC);
CREATE INDEX idx_support_requests_org ON public.support_requests(org_id);

COMMENT ON TABLE public.support_requests IS 'Customer support tickets with resolution tracking';
COMMENT ON COLUMN public.support_requests.customer_id IS 'NULL if unauthenticated prospect submits request';
COMMENT ON COLUMN public.support_requests.email IS 'Contact email captured even if not registered customer';

-- =============================================
-- 3. customer_agreements
-- =============================================
CREATE TABLE IF NOT EXISTS public.customer_agreements (
    agreement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    customer_id UUID NOT NULL REFERENCES public.customer_details(customer_id),
    agreement_type TEXT NOT NULL CHECK (agreement_type IN ('terms_of_service', 'privacy_policy', 'investment_disclaimer')),
    version TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT,
    UNIQUE(customer_id, agreement_type, version)
);

CREATE INDEX idx_customer_agreements_customer ON public.customer_agreements(customer_id);
CREATE INDEX idx_customer_agreements_org ON public.customer_agreements(org_id);
CREATE INDEX idx_customer_agreements_type ON public.customer_agreements(agreement_type);

COMMENT ON TABLE public.customer_agreements IS 'Legal agreement acceptances with audit trail (POPI Act compliance)';
COMMENT ON COLUMN public.customer_agreements.version IS 'Agreement version (e.g., v1.0, v1.1) for tracking changes';

-- =============================================
-- 4. email_templates
-- =============================================
CREATE TABLE IF NOT EXISTS public.email_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    template_code TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_templates_org ON public.email_templates(org_id);
CREATE INDEX idx_email_templates_code ON public.email_templates(template_code);
CREATE INDEX idx_email_templates_active ON public.email_templates(active);

COMMENT ON TABLE public.email_templates IS 'Email templates with {{placeholder}} variables for dynamic content';
COMMENT ON COLUMN public.email_templates.template_code IS 'Unique identifier (e.g., prospect_notification, kyc_request)';
COMMENT ON COLUMN public.email_templates.body_html IS 'HTML email body with {{variable}} placeholders';
COMMENT ON COLUMN public.email_templates.body_text IS 'Plain text fallback for email clients that dont support HTML';

-- =============================================
-- 5. email_logs
-- =============================================
CREATE TABLE IF NOT EXISTS public.email_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.orgs(org_id),
    template_code TEXT REFERENCES public.email_templates(template_code),
    recipient_email TEXT NOT NULL,
    subject TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT CHECK (status IN ('sent', 'failed', 'bounced')),
    resend_message_id TEXT,
    error_message TEXT
);

CREATE INDEX idx_email_logs_recipient ON public.email_logs(recipient_email);
CREATE INDEX idx_email_logs_sent_at ON public.email_logs(sent_at DESC);
CREATE INDEX idx_email_logs_org ON public.email_logs(org_id);
CREATE INDEX idx_email_logs_status ON public.email_logs(status);

COMMENT ON TABLE public.email_logs IS 'Email delivery audit log with Resend API tracking';
COMMENT ON COLUMN public.email_logs.resend_message_id IS 'Message ID returned by Resend API for tracking';

-- =============================================
-- Grant permissions
-- =============================================
GRANT SELECT, INSERT, UPDATE ON public.withdrawal_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_requests TO authenticated;
GRANT SELECT, INSERT ON public.customer_agreements TO authenticated;
GRANT SELECT ON public.email_templates TO authenticated;
GRANT SELECT ON public.email_logs TO service_role;

-- Service role needs full access for admin operations
GRANT ALL ON public.withdrawal_requests TO service_role;
GRANT ALL ON public.support_requests TO service_role;
GRANT ALL ON public.customer_agreements TO service_role;
GRANT ALL ON public.email_templates TO service_role;
GRANT ALL ON public.email_logs TO service_role;
