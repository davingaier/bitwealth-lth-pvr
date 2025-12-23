create view public.live_customer_performance_daily as
with
  d as (
    select
      daily_data.date_closing,
      daily_data.btc_closing_price_usd
    from
      daily_data
  ),
  o as (
    select
      exchange_order_intents.customer_id,
      exchange_order_intents.date_closing,
      exchange_order_intents.symbol,
      exchange_order_intents.side,
      COALESCE(exchange_order_intents.intent_btc, 0::numeric) as btc_qty,
      COALESCE(exchange_order_intents.intent_usdt, 0::numeric) as usdt_amt,
      exchange_order_intents.status
    from
      exchange_order_intents
    where
      exchange_order_intents.symbol = 'BTCUSDT'::text
      and (
        exchange_order_intents.status = any (
          array[
            'submitted'::text,
            'open'::text,
            'partially_filled'::text,
            'filled'::text
          ]
        )
      )
  ),
  net_flows as (
    select
      o_1.customer_id,
      o_1.date_closing,
      sum(
        case
          when o_1.side = 'BUY'::text then o_1.usdt_amt
          else 0::numeric
        end
      ) as buy_usdt,
      sum(
        case
          when o_1.side = 'SELL'::text then o_1.usdt_amt
          else 0::numeric
        end
      ) as sell_usdt,
      sum(
        case
          when o_1.side = 'BUY'::text then o_1.btc_qty
          else - o_1.btc_qty
        end
      ) as delta_btc
    from
      o o_1
    group by
      o_1.customer_id,
      o_1.date_closing
  ),
  positions as (
    select
      n.customer_id,
      n.date_closing,
      sum(n.delta_btc) over (
        partition by
          n.customer_id
        order by
          n.date_closing rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as closing_btc,
      sum(n.buy_usdt - n.sell_usdt) over (
        partition by
          n.customer_id
        order by
          n.date_closing rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as closing_usdt
    from
      net_flows n
  )
select
  p.customer_id,
  p.date_closing as transaction_date,
  'live'::text as signal_type,
  0::numeric as omega_buy_usd,
  0::numeric as omega_buy_btc,
  0::numeric as omega_sell_btc,
  'live'::text as source_signal,
  lag(p.closing_usdt) over (
    partition by
      p.customer_id
    order by
      p.date_closing
  ) as opening_balance_usd,
  p.closing_usdt as closing_balance_usd,
  lag(p.closing_btc) over (
    partition by
      p.customer_id
    order by
      p.date_closing
  ) as opening_balance_btc,
  p.closing_btc as closing_balance_btc,
  0::numeric as daily_dca_usd,
  0::numeric as omega_sell_usd,
  d.btc_closing_price_usd,
  0::numeric as sab_buy_usd,
  0::numeric as sab_buy_btc,
  p.date_closing,
  sum(
    case
      when o.side = 'BUY'::text then o.usdt_amt
      else 0::numeric
    end
  ) over (
    partition by
      p.customer_id
    order by
      p.date_closing rows between UNBOUNDED PRECEDING
      and CURRENT row
  ) as total_dca_invested_usd,
  round(
    COALESCE(d.btc_closing_price_usd, 0::numeric) * COALESCE(p.closing_btc, 0::numeric) + COALESCE(p.closing_usdt, 0::numeric),
    2
  ) as portfolio_value_usd
from
  positions p
  join d on d.date_closing = p.date_closing
  left join o on o.customer_id = p.customer_id
  and o.date_closing = p.date_closing;