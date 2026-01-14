-- Check for duplicate customer records
SELECT 
  customer_id, 
  email, 
  first_names, 
  surname, 
  registration_status, 
  created_at,
  updated_at
FROM public.customer_details 
WHERE email = 'davin.gaier@gmail.com' 
ORDER BY customer_id;

-- Check all customers with this pattern
SELECT 
  customer_id, 
  email, 
  first_names, 
  surname, 
  registration_status, 
  created_at
FROM public.customer_details 
WHERE email ILIKE '%davin%' 
ORDER BY customer_id;
