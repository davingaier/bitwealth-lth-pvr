create view public.real_unallocated_deposits as
select
  id,
  customer_id,
  transaction_timestamp,
  exchange_order_id,
  currency_pair,
  COALESCE(trade_side, ''::text) as trade_side,
  credit_value as usdt_amount,
  trade_price,
  notes
from
  real_exchange_txs
where
  kind = 'USDT_DEPOSIT'::text
  and allocated_month is null
order by
  transaction_timestamp desc;