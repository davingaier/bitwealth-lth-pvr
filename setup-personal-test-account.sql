-- Setup Davin's personal test account in database (INACTIVE - no trading)
-- Subaccount ID: 1419286489401798656
-- Purpose: Test transaction classification (ZAR conversions, external withdrawals)

-- 1. Exchange account already created: 1da38bcb-8c24-464d-81a0-7b388f84c8b3

-- 2. Create customer_details record
INSERT INTO public.customer_details (
  customer_id,
  first_names,
  last_name,
  email_address,
  customer_status,
  created_at
)
VALUES (
  999,
  'Davin',
  'Personal Test',
  'davin.gaier+personal@gmail.com',
  'inactive',  -- INACTIVE to prevent trading
  NOW()
)
ON CONFLICT (customer_id) DO UPDATE 
SET customer_status = 'inactive',
    first_names = 'Davin',
    last_name = 'Personal Test'
RETURNING customer_id, first_names, last_name, customer_status;

-- 3. Create customer_portfolios record
INSERT INTO public.customer_portfolios (
  customer_id,
  portfolio_id,
  org_id,
  status,
  portfolio_name,
  portfolio_type,
  created_at,
  updated_at
)
VALUES (
  999,
  gen_random_uuid(),
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b'::uuid,
  'inactive',  -- INACTIVE to prevent trading
  'Personal Test Portfolio',
  'LTH_PVR',
  NOW(),
  NOW()
)
ON CONFLICT (customer_id) DO UPDATE
SET status = 'inactive'
RETURNING customer_id, portfolio_id, status;

-- 4. Create customer_strategies record (links to exchange account)
INSERT INTO lth_pvr.customer_strategies (
  customer_id,
  org_id,
  strategy_name,
  exchange_account_id,
  status,
  platform_fee_rate,
  created_at,
  updated_at
)
VALUES (
  999,
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b'::uuid,
  'LTH_PVR',
  '1da38bcb-8c24-464d-81a0-7b388f84c8b3'::uuid,  -- Personal subaccount exchange account
  'inactive',  -- INACTIVE to prevent trading
  '0.0075',  -- 0.75% platform fee
  NOW(),
  NOW()
)
ON CONFLICT (customer_id) DO UPDATE
SET status = 'inactive',
    exchange_account_id = '1da38bcb-8c24-464d-81a0-7b388f84c8b3'::uuid
RETURNING customer_id, exchange_account_id, status, platform_fee_rate;

-- 5. Verify setup
SELECT 
  cd.customer_id,
  cd.first_names || ' ' || cd.last_name AS name,
  cd.customer_status,
  ea.subaccount_id,
  ea.label AS exchange_account_label,
  cs.platform_fee_rate,
  cs.status AS strategy_status
FROM public.customer_details cd
JOIN lth_pvr.customer_strategies cs ON cs.customer_id = cd.customer_id
JOIN public.exchange_accounts ea ON ea.exchange_account_id = cs.exchange_account_id
WHERE cd.customer_id = 999;
