-- Fix duplicate customer records for davin.gaier@gmail.com
-- This script identifies duplicates and keeps only the most recent one

-- Step 1: Identify all duplicate records
SELECT 
  customer_id, 
  email, 
  first_names, 
  surname, 
  registration_status, 
  created_at,
  updated_at,
  CASE 
    WHEN customer_id = (
      SELECT MAX(customer_id) 
      FROM public.customer_details cd2 
      WHERE cd2.email = customer_details.email
    ) THEN 'KEEP'
    ELSE 'DELETE'
  END as action
FROM public.customer_details 
WHERE email = 'davin.gaier@gmail.com'
ORDER BY customer_id DESC;

-- Step 2: Delete older duplicate records (keeps highest customer_id)
-- UNCOMMENT BELOW AFTER REVIEWING ABOVE QUERY RESULTS

/*
DELETE FROM public.customer_details
WHERE email = 'davin.gaier@gmail.com'
  AND customer_id < (
    SELECT MAX(customer_id) 
    FROM public.customer_details 
    WHERE email = 'davin.gaier@gmail.com'
  );
*/

-- Step 3: Add unique constraint to prevent future duplicates
-- UNCOMMENT AFTER CLEANING UP DUPLICATES

/*
ALTER TABLE public.customer_details
ADD CONSTRAINT customer_details_email_unique UNIQUE (email);
*/

-- Step 4: Verify cleanup
/*
SELECT 
  customer_id, 
  email, 
  first_names, 
  surname, 
  registration_status, 
  created_at
FROM public.customer_details 
WHERE email = 'davin.gaier@gmail.com';
*/
