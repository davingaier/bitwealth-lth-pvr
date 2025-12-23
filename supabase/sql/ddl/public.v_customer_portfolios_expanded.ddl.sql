create view public.v_customer_portfolios_expanded as
select
  cp.portfolio_id,
  cp.org_id,
  cp.customer_id,
  s.strategy_code,
  s.name as strategy_name,
  cp.label,
  cp.exchange,
  cp.exchange_account_id,
  cp.exchange_subaccount,
  cp.base_asset,
  cp.quote_asset,
  cp.status,
  cp.created_at,
  cp.closed_at
from
  customer_portfolios cp
  join strategies s on s.strategy_code = cp.strategy_code;