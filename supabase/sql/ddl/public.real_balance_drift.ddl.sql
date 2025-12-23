create view public.real_balance_drift as
with
  exp as (
    select
      real_exchange_txs.customer_id,
      date_trunc(
        'day'::text,
        real_exchange_txs.transaction_timestamp
      )::date as day,
      sum(
        case
          when real_exchange_txs.credit_currency = 'USDT'::text then real_exchange_txs.credit_value
          else 0::numeric
        end - case
          when real_exchange_txs.debit_currency = 'USDT'::text then real_exchange_txs.debit_value
          else 0::numeric
        end
      ) as exp_usdt_delta,
      sum(
        case
          when real_exchange_txs.credit_currency = 'BTC'::text then real_exchange_txs.credit_value
          else 0::numeric
        end - case
          when real_exchange_txs.debit_currency = 'BTC'::text then real_exchange_txs.debit_value
          else 0::numeric
        end
      ) as exp_btc_delta,
      sum(
        case
          when real_exchange_txs.credit_currency = 'ZAR'::text then real_exchange_txs.credit_value
          else 0::numeric
        end - case
          when real_exchange_txs.debit_currency = 'ZAR'::text then real_exchange_txs.debit_value
          else 0::numeric
        end
      ) as exp_zar_delta
    from
      real_exchange_txs
    group by
      real_exchange_txs.customer_id,
      (
        date_trunc(
          'day'::text,
          real_exchange_txs.transaction_timestamp
        )::date
      )
  ),
  obs_raw as (
    select
      exchange_daily_balances.customer_id,
      exchange_daily_balances.as_of_date as day,
      exchange_daily_balances.usdt_total,
      exchange_daily_balances.btc_total,
      exchange_daily_balances.zar_total,
      lag(exchange_daily_balances.usdt_total) over (
        partition by
          exchange_daily_balances.customer_id
        order by
          exchange_daily_balances.as_of_date
      ) as prev_usdt_total,
      lag(exchange_daily_balances.btc_total) over (
        partition by
          exchange_daily_balances.customer_id
        order by
          exchange_daily_balances.as_of_date
      ) as prev_btc_total,
      lag(exchange_daily_balances.zar_total) over (
        partition by
          exchange_daily_balances.customer_id
        order by
          exchange_daily_balances.as_of_date
      ) as prev_zar_total
    from
      exchange_daily_balances
  ),
  obs as (
    select
      obs_raw.customer_id,
      obs_raw.day,
      obs_raw.usdt_total - COALESCE(obs_raw.prev_usdt_total, obs_raw.usdt_total) as obs_usdt_delta,
      obs_raw.btc_total - COALESCE(obs_raw.prev_btc_total, obs_raw.btc_total) as obs_btc_delta,
      obs_raw.zar_total - COALESCE(obs_raw.prev_zar_total, obs_raw.zar_total) as obs_zar_delta
    from
      obs_raw
  )
select
  COALESCE(o.customer_id, e.customer_id) as customer_id,
  COALESCE(o.day, e.day) as day,
  o.obs_usdt_delta,
  COALESCE(e.exp_usdt_delta, 0::numeric) as exp_usdt_delta,
  o.obs_usdt_delta - COALESCE(e.exp_usdt_delta, 0::numeric) as drift_usdt,
  o.obs_btc_delta,
  COALESCE(e.exp_btc_delta, 0::numeric) as exp_btc_delta,
  o.obs_btc_delta - COALESCE(e.exp_btc_delta, 0::numeric) as drift_btc,
  o.obs_zar_delta,
  COALESCE(e.exp_zar_delta, 0::numeric) as exp_zar_delta,
  o.obs_zar_delta - COALESCE(e.exp_zar_delta, 0::numeric) as drift_zar
from
  obs o
  full join exp e on e.customer_id = o.customer_id
  and e.day = o.day;