-- Test Data for TC2.7: Verify status badge colors in Customer Onboarding Pipeline card
-- This script creates test customers for 'deposit' and 'inactive' statuses
-- Run this in the Supabase SQL Editor

-- Insert test customers with correct column names
WITH org AS (
  SELECT id as org_id FROM public.organizations LIMIT 1
)
INSERT INTO public.customer_details (
  org_id, 
  first_names, 
  last_name, 
  email,
  email_address,
  phone_number,
  registration_status
)
SELECT
  org.org_id,
  'Test',
  'Deposit',
  'test.deposit@example.com',
  'test.deposit@example.com',
  '+27811111111',
  'deposit'
FROM org
UNION ALL
SELECT
  org.org_id,
  'Test',
  'Inactive',
  'test.inactive@example.com',
  'test.inactive@example.com',
  '+27822222222',
  'inactive'
FROM org;

-- Verify the test data was created
SELECT customer_id, first_names, last_name, email, registration_status, created_at
FROM public.customer_details
WHERE email IN ('test.deposit@example.com', 'test.inactive@example.com')
ORDER BY email;
