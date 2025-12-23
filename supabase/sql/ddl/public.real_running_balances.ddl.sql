create view public.real_running_balances as
with
  deltas as (
    select
      real_exchange_txs.customer_id,
      real_exchange_txs.transaction_timestamp,
      case real_exchange_txs.kind
        when 'USDT_DEPOSIT'::text then COALESCE(real_exchange_txs.credit_value, 0::numeric)
        when 'USDT_WITHDRAWAL'::text then - COALESCE(real_exchange_txs.debit_value, 0::numeric)
        when 'BTC_BUY'::text then - COALESCE(real_exchange_txs.debit_value, 0::numeric)
        when 'BTC_SELL'::text then COALESCE(real_exchange_txs.credit_value, 0::numeric)
        else 0::numeric
      end as usdt_delta,
      case real_exchange_txs.kind
        when 'BTC_BUY'::text then COALESCE(real_exchange_txs.credit_value, 0::numeric)
        when 'BTC_SELL'::text then - COALESCE(real_exchange_txs.debit_value, 0::numeric)
        else 0::numeric
      end as btc_delta,
      case real_exchange_txs.kind
        when 'USDT_DEPOSIT'::text then - COALESCE(real_exchange_txs.debit_value, 0::numeric)
        when 'USDT_WITHDRAWAL'::text then COALESCE(real_exchange_txs.credit_value, 0::numeric)
        else 0::numeric
      end as zar_delta
    from
      real_exchange_txs
  ),
  by_day as (
    select
      deltas.customer_id,
      date_trunc('day'::text, deltas.transaction_timestamp) as day,
      sum(deltas.usdt_delta) as usdt_delta_day,
      sum(deltas.btc_delta) as btc_delta_day,
      sum(deltas.zar_delta) as zar_delta_day
    from
      deltas
    group by
      deltas.customer_id,
      (
        date_trunc('day'::text, deltas.transaction_timestamp)
      )
  )
select
  customer_id,
  day::date as day,
  sum(usdt_delta_day) over (
    partition by
      customer_id
    order by
      by_day.day
  ) as usdt_balance_est,
  sum(btc_delta_day) over (
    partition by
      customer_id
    order by
      by_day.day
  ) as btc_balance_est,
  sum(zar_delta_day) over (
    partition by
      customer_id
    order by
      by_day.day
  ) as zar_balance_est
from
  by_day
order by
  customer_id,
  (day::date);