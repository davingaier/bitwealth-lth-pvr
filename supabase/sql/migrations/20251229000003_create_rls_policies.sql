-- Migration: RLS Policies for Customer Portal Tables
-- Created: 2025-12-29
-- Purpose: Row-level security policies ensuring customers only see their own data

-- =============================================
-- 1. withdrawal_requests RLS
-- =============================================
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- Customers can view only their own withdrawal requests
CREATE POLICY withdrawal_requests_customer_select ON public.withdrawal_requests
FOR SELECT
TO authenticated
USING (customer_id = auth.uid());

-- Customers can insert their own withdrawal requests (status must be 'pending')
CREATE POLICY withdrawal_requests_customer_insert ON public.withdrawal_requests
FOR INSERT
TO authenticated
WITH CHECK (
    customer_id = auth.uid() 
    AND status = 'pending'
    AND created_by = auth.uid()
);

-- Service role (admins) can do anything
CREATE POLICY withdrawal_requests_service_role_all ON public.withdrawal_requests
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON POLICY withdrawal_requests_customer_select ON public.withdrawal_requests IS 'Customers see only their own withdrawal requests';
COMMENT ON POLICY withdrawal_requests_customer_insert ON public.withdrawal_requests IS 'Customers can only create pending requests for themselves';

-- =============================================
-- 2. support_requests RLS
-- =============================================
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

-- Customers can view only their own support requests
CREATE POLICY support_requests_customer_select ON public.support_requests
FOR SELECT
TO authenticated
USING (customer_id = auth.uid());

-- Customers can insert support requests (customer_id can be NULL for unauthenticated)
CREATE POLICY support_requests_customer_insert ON public.support_requests
FOR INSERT
TO authenticated
WITH CHECK (
    customer_id = auth.uid() OR customer_id IS NULL
);

-- Allow anon users to submit support requests (public form)
CREATE POLICY support_requests_anon_insert ON public.support_requests
FOR INSERT
TO anon
WITH CHECK (customer_id IS NULL);

-- Service role can do anything
CREATE POLICY support_requests_service_role_all ON public.support_requests
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON POLICY support_requests_customer_select ON public.support_requests IS 'Customers see only their own support requests';
COMMENT ON POLICY support_requests_anon_insert ON public.support_requests IS 'Anonymous users can submit support requests via public form';

-- =============================================
-- 3. customer_agreements RLS
-- =============================================
ALTER TABLE public.customer_agreements ENABLE ROW LEVEL SECURITY;

-- Customers can view only their own agreements
CREATE POLICY customer_agreements_customer_select ON public.customer_agreements
FOR SELECT
TO authenticated
USING (customer_id = auth.uid());

-- Customers can insert their own agreement acceptances
CREATE POLICY customer_agreements_customer_insert ON public.customer_agreements
FOR INSERT
TO authenticated
WITH CHECK (customer_id = auth.uid());

-- Service role can do anything
CREATE POLICY customer_agreements_service_role_all ON public.customer_agreements
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON POLICY customer_agreements_customer_select ON public.customer_agreements IS 'Customers see only their own agreement acceptances';
COMMENT ON POLICY customer_agreements_customer_insert ON public.customer_agreements IS 'Customers can record their own agreement acceptances';

-- =============================================
-- 4. email_templates RLS (read-only for authenticated)
-- =============================================
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Authenticated users can view active templates (for preview purposes)
CREATE POLICY email_templates_authenticated_select ON public.email_templates
FOR SELECT
TO authenticated
USING (active = true);

-- Service role can do anything
CREATE POLICY email_templates_service_role_all ON public.email_templates
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON POLICY email_templates_authenticated_select ON public.email_templates IS 'Authenticated users can view active email templates';

-- =============================================
-- 5. email_logs RLS (service role only)
-- =============================================
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

-- Only service role can access email logs (admin audit only)
CREATE POLICY email_logs_service_role_all ON public.email_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

COMMENT ON POLICY email_logs_service_role_all ON public.email_logs IS 'Email logs are admin-only for audit purposes';
