create view public.v_exchange_daily_balances_latest as
select distinct
  on (customer_id, as_of_date) customer_id,
  as_of_date,
  btc_total,
  usdt_total,
  zar_total,
  created_at,
  updated_at,
  source
from
  exchange_daily_balances
order by
  customer_id,
  as_of_date,
  created_at desc;