-- Fix Customer Portal Login - RLS Policy
-- Execute this in Supabase SQL Editor
-- Issue: PGRST118 error - customers cannot read their own customer_details

-- Drop existing customer-level policies if they exist
DROP POLICY IF EXISTS customer_details_select_own ON public.customer_details;
DROP POLICY IF EXISTS customer_details_update_own ON public.customer_details;

-- Allow authenticated customers to SELECT their own record
CREATE POLICY customer_details_select_own ON public.customer_details
FOR SELECT
TO authenticated
USING (customer_id = auth.uid());

-- Allow authenticated customers to UPDATE specific fields
CREATE POLICY customer_details_update_own ON public.customer_details
FOR UPDATE
TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- Verify service role policy exists
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
    END IF;
END $$;

-- Verify the policies were created
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'customer_details'
ORDER BY policyname;
