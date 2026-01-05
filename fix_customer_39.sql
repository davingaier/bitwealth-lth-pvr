-- Fix Customer 39: Create missing customer_strategies row
-- This customer was activated before the fix was deployed

-- First, verify customer 39 details
SELECT 
  cd.customer_id, 
  cd.first_names, 
  cd.last_name, 
  cd.registration_status,
  cd.trade_start_date,
  cp.portfolio_id, 
  cp.strategy_code, 
  cp.status AS portfolio_status,
  cp.exchange_account_id,
  ea.subaccount_id,
  ea.label AS exchange_label
FROM public.customer_details cd
JOIN public.customer_portfolios cp ON cd.customer_id = cp.customer_id
JOIN public.exchange_accounts ea ON cp.exchange_account_id = ea.exchange_account_id
WHERE cd.customer_id = 39;

-- Get the strategy_version_id for LTH_PVR strategy
SELECT strategy_version_id, strategy_code, version_number, is_latest
FROM lth_pvr.strategy_versions
WHERE strategy_code = 'LTH_PVR'
AND is_latest = true;

-- Check if customer_strategies row already exists
SELECT * FROM lth_pvr.customer_strategies WHERE customer_id = 39;

-- Create customer_strategies row (if not exists)
-- Replace the placeholders with actual values from queries above:
-- - {org_id} from customer_details
-- - {strategy_version_id} from strategy_versions query
-- - {exchange_account_id} from customer_portfolios
-- - {portfolio_id} from customer_portfolios

/*
INSERT INTO lth_pvr.customer_strategies (
  org_id,
  customer_id,
  strategy_version_id,
  exchange_account_id,
  live_enabled,
  effective_from,
  portfolio_id
)
SELECT
  cd.org_id,
  39::bigint,
  sv.strategy_version_id,
  cp.exchange_account_id,
  true,
  CURRENT_DATE,
  cp.portfolio_id
FROM public.customer_details cd
JOIN public.customer_portfolios cp ON cd.customer_id = cp.customer_id
CROSS JOIN lth_pvr.strategy_versions sv
WHERE cd.customer_id = 39
  AND sv.strategy_code = cp.strategy_code
  AND sv.is_latest = true
  AND NOT EXISTS (
    SELECT 1 FROM lth_pvr.customer_strategies cs WHERE cs.customer_id = 39
  );
*/

-- Set trade_start_date if not already set
UPDATE public.customer_details
SET trade_start_date = CURRENT_DATE
WHERE customer_id = 39
  AND trade_start_date IS NULL;

-- Verify the fix
SELECT 
  cs.customer_strategy_id,
  cs.customer_id,
  cs.live_enabled,
  cs.effective_from,
  sv.strategy_code,
  sv.version_number
FROM lth_pvr.customer_strategies cs
JOIN lth_pvr.strategy_versions sv ON cs.strategy_version_id = sv.strategy_version_id
WHERE cs.customer_id = 39;

SELECT customer_id, trade_start_date FROM public.customer_details WHERE customer_id = 39;
