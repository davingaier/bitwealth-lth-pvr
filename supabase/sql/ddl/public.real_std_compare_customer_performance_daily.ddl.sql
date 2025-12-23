create view public.real_std_compare_customer_performance_daily as
with
  active_cust as (
    select
      customer_details.customer_id,
      customer_details.trade_start_date
    from
      customer_details
    where
      customer_details.customer_status = 'Active'::text
      and customer_details.trade_start_date is not null
  ),
  dseries as (
    select
      ac.customer_id,
      ac.trade_start_date,
      gs.gs::date as tx_date
    from
      active_cust ac
      cross join lateral generate_series(
        ac.trade_start_date::timestamp with time zone,
        (now() AT TIME ZONE 'UTC'::text)::date::timestamp with time zone,
        '1 day'::interval
      ) gs (gs)
  ),
  tx_norm as (
    select
      (t.transaction_timestamp AT TIME ZONE 'UTC'::text)::date as tx_date,
      t.customer_id,
      upper(
        TRIM(
          both
          from
            t.debit_currency
        )
      ) as dc,
      upper(
        TRIM(
          both
          from
            t.credit_currency
        )
      ) as cc,
      upper(
        TRIM(
          both
          from
            t.fee_currency
        )
      ) as fc,
      t.debit_value,
      t.credit_value,
      t.fee_value
    from
      real_std_compare_txs t
  ),
  tx_day as (
    select
      n.tx_date,
      n.customer_id,
      sum(n.debit_value) filter (
        where
          n.dc = 'USDT'::text
      ) as std_buy_usdt,
      sum(n.credit_value) filter (
        where
          n.cc = 'BTC'::text
      ) as std_buy_btc,
      sum(n.debit_value) filter (
        where
          n.dc = 'BTC'::text
      ) as std_sell_btc,
      sum(n.credit_value) filter (
        where
          n.cc = 'USDT'::text
      ) as std_sell_usdt,
      sum(n.fee_value) filter (
        where
          n.fc = 'BTC'::text
      ) as fee_paid_btc
    from
      tx_norm n
    group by
      n.tx_date,
      n.customer_id
  ),
  real_fee_usdt as (
    select
      (t.transaction_timestamp AT TIME ZONE 'UTC'::text)::date as tx_date,
      t.customer_id,
      sum(t.fee_value) as fee_paid_usdt
    from
      real_exchange_txs t
    where
      upper(t.fee_currency) = 'USDT'::text
    group by
      (
        (t.transaction_timestamp AT TIME ZONE 'UTC'::text)::date
      ),
      t.customer_id
  ),
  px as (
    select
      daily_data.date_closing,
      daily_data.btc_closing_price_usd
    from
      daily_data
  ),
  real_cash as (
    select
      real_customer_performance_daily.customer_id,
      real_customer_performance_daily.tx_date,
      real_customer_performance_daily.closing_balance_usdt
    from
      real_customer_performance_daily
  ),
  joined as (
    select
      s.customer_id,
      s.tx_date,
      s.trade_start_date,
      p.date_closing,
      p.btc_closing_price_usd,
      COALESCE(t.std_buy_usdt, 0::numeric) as std_buy_usdt,
      COALESCE(t.std_buy_btc, 0::numeric) as std_buy_btc,
      COALESCE(t.std_sell_btc, 0::numeric) as std_sell_btc,
      COALESCE(t.std_sell_usdt, 0::numeric) as std_sell_usdt,
      COALESCE(t.fee_paid_btc, 0::numeric) as fee_paid_btc,
      COALESCE(rf.fee_paid_usdt, 0::numeric) as fee_paid_usdt,
      COALESCE(rc.closing_balance_usdt, 0::numeric) as closing_balance_usdt
    from
      dseries s
      left join tx_day t on t.customer_id = s.customer_id
      and t.tx_date = s.tx_date
      left join px p on p.date_closing = (s.tx_date - '1 day'::interval)::date
      left join real_fee_usdt rf on rf.customer_id = s.customer_id
      and rf.tx_date = s.tx_date
      left join real_cash rc on rc.customer_id = s.customer_id
      and rc.tx_date = s.tx_date
  ),
  with_bal as (
    select
      j.customer_id,
      j.tx_date,
      j.trade_start_date,
      j.date_closing,
      j.btc_closing_price_usd,
      j.std_buy_usdt,
      j.std_buy_btc,
      j.std_sell_btc,
      j.std_sell_usdt,
      j.fee_paid_btc,
      j.fee_paid_usdt,
      j.closing_balance_usdt,
      sum(j.std_buy_btc - j.std_sell_btc - j.fee_paid_btc) over (
        partition by
          j.customer_id
        order by
          j.tx_date rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as closing_balance_btc
    from
      joined j
  ),
  with_totals as (
    select
      wb.customer_id,
      wb.tx_date,
      wb.trade_start_date,
      wb.date_closing,
      wb.btc_closing_price_usd,
      wb.std_buy_usdt,
      wb.std_buy_btc,
      wb.std_sell_btc,
      wb.std_sell_usdt,
      wb.fee_paid_btc,
      wb.fee_paid_usdt,
      wb.closing_balance_usdt,
      wb.closing_balance_btc,
      sum(wb.std_buy_usdt + wb.fee_paid_usdt) over (
        partition by
          wb.customer_id
        order by
          wb.tx_date rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as total_deployed_usdt,
      sum(wb.fee_paid_usdt) over (
        partition by
          wb.customer_id
        order by
          wb.tx_date rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as total_fees_paid_usdt,
      sum(wb.fee_paid_btc) over (
        partition by
          wb.customer_id
        order by
          wb.tx_date rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as total_fees_paid_btc,
      case
        when wb.trade_start_date is null then null::integer
        when wb.tx_date < wb.trade_start_date then 0
        else date_part(
          'year'::text,
          age (
            wb.tx_date::timestamp with time zone,
            wb.trade_start_date::timestamp with time zone
          )
        )::integer + 1
      end as trading_year
    from
      with_bal wb
  )
select
  customer_id,
  tx_date,
  date_closing,
  btc_closing_price_usd,
  std_buy_usdt,
  std_buy_btc,
  closing_balance_usdt,
  closing_balance_btc,
  total_deployed_usdt,
  total_deployed_usdt + closing_balance_usdt as total_invested_usdt,
  fee_paid_usdt,
  fee_paid_btc,
  total_fees_paid_usdt,
  total_fees_paid_btc,
  COALESCE(closing_balance_btc, 0::numeric) * COALESCE(btc_closing_price_usd, 0::numeric) + COALESCE(closing_balance_usdt, 0::numeric) as portfolio_value_usd,
  case
    when (total_deployed_usdt + closing_balance_usdt) = 0::numeric then null::numeric
    else (
      COALESCE(closing_balance_btc, 0::numeric) * COALESCE(btc_closing_price_usd, 0::numeric) + COALESCE(closing_balance_usdt, 0::numeric) - (total_deployed_usdt + closing_balance_usdt)
    ) / (total_deployed_usdt + closing_balance_usdt)
  end as total_roi_percent,
  case
    when (total_deployed_usdt + closing_balance_usdt) = 0::numeric then null::numeric
    when trading_year is null
    or trading_year <= 0 then null::numeric
    else power(
      (
        COALESCE(closing_balance_btc, 0::numeric) * COALESCE(btc_closing_price_usd, 0::numeric) + COALESCE(closing_balance_usdt, 0::numeric)
      ) / (total_deployed_usdt + closing_balance_usdt),
      1.0 / trading_year::numeric
    ) - 1::numeric
  end as cagr_percent
from
  with_totals;