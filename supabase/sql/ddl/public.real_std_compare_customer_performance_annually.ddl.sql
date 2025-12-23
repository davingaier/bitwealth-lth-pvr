create view public.real_std_compare_customer_performance_annually as
with
  d as (
    select
      dd.customer_id,
      dd.tx_date,
      dd.btc_closing_price_usd,
      dd.std_buy_usdt,
      dd.std_buy_btc,
      dd.closing_balance_usdt,
      dd.closing_balance_btc,
      dd.total_invested_usdt,
      dd.total_deployed_usdt,
      dd.total_fees_paid_usdt,
      dd.total_fees_paid_btc,
      dd.portfolio_value_usd,
      dd.total_roi_percent,
      dd.cagr_percent,
      case
        when cd.trade_start_date is null then null::integer
        when dd.tx_date < cd.trade_start_date then 0
        else date_part(
          'year'::text,
          age (
            dd.tx_date::timestamp with time zone,
            cd.trade_start_date::timestamp with time zone
          )
        )::integer + 1
      end as trading_year
    from
      real_std_compare_customer_performance_daily dd
      left join customer_details cd on cd.customer_id = dd.customer_id
  ),
  filt as (
    select
      d.customer_id,
      d.tx_date,
      d.btc_closing_price_usd,
      d.std_buy_usdt,
      d.std_buy_btc,
      d.closing_balance_usdt,
      d.closing_balance_btc,
      d.total_invested_usdt,
      d.total_deployed_usdt,
      d.total_fees_paid_usdt,
      d.total_fees_paid_btc,
      d.portfolio_value_usd,
      d.total_roi_percent,
      d.cagr_percent,
      d.trading_year
    from
      d
    where
      d.trading_year is not null
      and d.trading_year > 0
  ),
  agg as (
    select
      f.customer_id,
      f.trading_year,
      max(f.tx_date) as latest_tx_date,
      sum(f.std_buy_usdt) as total_std_dca_buy_usdt,
      sum(f.std_buy_btc) as total_std_dca_buy_btc
    from
      filt f
    group by
      f.customer_id,
      f.trading_year
  ),
  last_row as (
    select
      f.customer_id,
      f.tx_date,
      f.btc_closing_price_usd,
      f.closing_balance_usdt,
      f.closing_balance_btc,
      f.total_invested_usdt,
      f.total_deployed_usdt,
      f.total_fees_paid_usdt,
      f.total_fees_paid_btc,
      f.portfolio_value_usd,
      f.total_roi_percent,
      f.cagr_percent,
      f.trading_year
    from
      filt f
      join agg a_1 on a_1.customer_id = f.customer_id
      and a_1.trading_year = f.trading_year
      and a_1.latest_tx_date = f.tx_date
  )
select
  a.customer_id,
  a.trading_year,
  a.latest_tx_date,
  lr.btc_closing_price_usd as latest_btc_closing_price_usd,
  a.total_std_dca_buy_usdt,
  lr.closing_balance_usdt,
  a.total_std_dca_buy_btc,
  lr.closing_balance_btc,
  lr.total_invested_usdt,
  lr.total_deployed_usdt,
  lr.total_fees_paid_usdt,
  lr.total_fees_paid_btc,
  lr.portfolio_value_usd,
  lr.total_roi_percent,
  lr.cagr_percent
from
  agg a
  join last_row lr on lr.customer_id = a.customer_id
  and lr.trading_year = a.trading_year
order by
  a.customer_id,
  a.trading_year;