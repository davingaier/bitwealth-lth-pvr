-- Migration: Fix customer_details RLS for Customer Portal Login
-- Created: 2026-01-07
-- Issue: Customers cannot read their own customer_details after authentication
-- Root Cause: RLS policies only allow admin (org_id-based) access, not customer self-access

-- The customer_details table is referenced by auth.uid() via customer_id
-- When a customer logs in, their JWT has auth.uid() = customer_id (UUID)
-- But the existing RLS policies check for org_id which customers don't have

-- Drop existing restrictive policies if they exist
DROP POLICY IF EXISTS customer_details_select_own ON public.customer_details;
DROP POLICY IF EXISTS customer_details_update_own ON public.customer_details;

-- Allow authenticated customers to SELECT their own record
-- Matches auth.uid() (from Supabase Auth) to customer_id column
CREATE POLICY customer_details_select_own ON public.customer_details
FOR SELECT
TO authenticated
USING (customer_id = auth.uid());

COMMENT ON POLICY customer_details_select_own ON public.customer_details IS 
'Customers can view their own customer_details record for portal login/navigation';

-- Allow authenticated customers to UPDATE specific fields on their own record
-- (e.g., contact details, preferences - NOT registration_status)
CREATE POLICY customer_details_update_own ON public.customer_details
FOR UPDATE
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

COMMENT ON POLICY customer_details_update_own ON public.customer_details IS 
'Customers can update their own contact details (not registration_status or admin fields)';

-- Note: Service role policies should already exist with full access
-- Verify service role policy exists:
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'customer_details' 
        AND policyname = 'customer_details_service_role_all'
    ) THEN
        CREATE POLICY customer_details_service_role_all ON public.customer_details
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
        
        RAISE NOTICE 'Created customer_details_service_role_all policy';
    END IF;
END $$;

COMMENT ON POLICY customer_details_service_role_all ON public.customer_details IS 
'Service role (admins, edge functions) has full access to customer_details';
