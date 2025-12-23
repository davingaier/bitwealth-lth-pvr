create view public.real_customer_performance_daily as
with
  tx_min as (
    select
      t.customer_id,
      min(
        (t.transaction_timestamp AT TIME ZONE 'UTC'::text)::date
      ) as min_tx_date
    from
      real_exchange_txs t
    group by
      t.customer_id
  ),
  cust as (
    select
      cd.customer_id,
      cd.trade_start_date,
      COALESCE(cd.trade_start_date, tm.min_tx_date) as series_start
    from
      customer_details cd
      join tx_min tm on tm.customer_id = cd.customer_id
  ),
  date_series as (
    select
      c.customer_id,
      c.trade_start_date,
      gs.gs::date as tx_date
    from
      cust c
      cross join lateral generate_series(
        c.series_start::timestamp with time zone,
        CURRENT_DATE::timestamp with time zone,
        '1 day'::interval
      ) gs (gs)
  ),
  tx_norm as (
    select
      (t.transaction_timestamp AT TIME ZONE 'UTC'::text)::date as tx_date,
      t.customer_id,
      upper(btrim(t.kind)) as k,
      upper(btrim(t.debit_currency)) as dc,
      upper(btrim(t.credit_currency)) as cc,
      upper(btrim(t.fee_currency)) as fc,
      t.debit_value,
      t.credit_value,
      t.fee_value
    from
      real_exchange_txs t
  ),
  tx_raw as (
    select
      n.tx_date,
      n.customer_id,
      sum(n.debit_value) filter (
        where
          n.k = 'BTC_BUY'::text
          and n.dc = 'USDT'::text
      ) as buy_usdt,
      sum(n.credit_value) filter (
        where
          n.k = 'BTC_SELL'::text
          and n.cc = 'USDT'::text
      ) as sell_usdt,
      sum(n.credit_value) filter (
        where
          n.k = 'BTC_BUY'::text
          and n.cc = 'BTC'::text
      ) as buy_btc,
      sum(n.debit_value) filter (
        where
          n.k = 'BTC_SELL'::text
          and n.dc = 'BTC'::text
      ) as sell_btc,
      sum(n.fee_value) filter (
        where
          n.fc = 'USDT'::text
      ) as fee_paid_usdt,
      sum(n.fee_value) filter (
        where
          n.fc = 'BTC'::text
      ) as fee_paid_btc,
      sum(n.fee_value) filter (
        where
          n.fc = 'ZAR'::text
      ) as fee_paid_zar,
      sum(n.credit_value) filter (
        where
          n.k = 'USDT_DEPOSIT'::text
          and n.cc = 'USDT'::text
      ) as usdt_deposit
    from
      tx_norm n
    group by
      n.tx_date,
      n.customer_id
  ),
  dd as (
    select
      d.date_closing,
      d.btc_closing_price_usd
    from
      daily_data d
  ),
  joined as (
    select
      s.customer_id,
      s.tx_date,
      s.trade_start_date,
      dd_prev.date_closing,
      dd_prev.btc_closing_price_usd,
      rule.omega_on_off,
      COALESCE(r.buy_usdt, 0::numeric) as buy_usdt,
      COALESCE(r.sell_usdt, 0::numeric) as sell_usdt,
      COALESCE(r.buy_btc, 0::numeric) as buy_btc,
      COALESCE(r.sell_btc, 0::numeric) as sell_btc,
      COALESCE(r.fee_paid_usdt, 0::numeric) as fee_paid_usdt,
      COALESCE(r.fee_paid_btc, 0::numeric) as fee_paid_btc,
      COALESCE(r.fee_paid_zar, 0::numeric) as fee_paid_zar,
      COALESCE(r.usdt_deposit, 0::numeric) as usdt_deposit,
      bal.usdt_total::numeric as closing_balance_usdt,
      bal.btc_total::numeric as closing_balance_btc,
      bal.zar_total::numeric as closing_balance_zar
    from
      date_series s
      left join tx_raw r on r.customer_id = s.customer_id
      and r.tx_date = s.tx_date
      left join lateral (
        select
          b.usdt_total,
          b.btc_total,
          b.zar_total
        from
          exchange_daily_balances b
        where
          b.customer_id = s.customer_id
          and b.as_of_date <= s.tx_date
        order by
          b.as_of_date desc
        limit
          1
      ) bal on true
      left join dd dd_prev on dd_prev.date_closing = (s.tx_date - '1 day'::interval)::date
      left join lateral (
        select
          r_1.omega_on_off
        from
          adv_dca_buy_sell_rules r_1
        where
          r_1.customer_id = s.customer_id
          and r_1.date_closing = (s.tx_date - '1 day'::interval)::date
        order by
          r_1.created_at desc nulls last
        limit
          1
      ) rule on true
  ),
  with_splits as (
    select
      j.customer_id,
      j.tx_date,
      j.trade_start_date,
      j.date_closing,
      j.btc_closing_price_usd,
      j.omega_on_off,
      j.buy_usdt,
      j.sell_usdt,
      j.buy_btc,
      j.sell_btc,
      j.fee_paid_usdt,
      j.fee_paid_btc,
      j.fee_paid_zar,
      j.usdt_deposit,
      j.closing_balance_usdt,
      j.closing_balance_btc,
      j.closing_balance_zar,
      case
        when j.omega_on_off is true then j.buy_usdt
        else 0::numeric
      end as omega_buy_usdt,
      case
        when j.omega_on_off is true then j.sell_usdt
        else 0::numeric
      end as omega_sell_usdt,
      case
        when j.omega_on_off is false then j.buy_usdt
        else 0::numeric
      end as sab_buy_usdt,
      case
        when j.omega_on_off is true then j.buy_btc
        else 0::numeric
      end as omega_buy_btc,
      case
        when j.omega_on_off is true then j.sell_btc
        else 0::numeric
      end as omega_sell_btc,
      case
        when j.omega_on_off is false then j.buy_btc
        else 0::numeric
      end as sab_buy_btc
    from
      joined j
  ),
  with_totals as (
    select
      w.customer_id,
      w.tx_date,
      w.trade_start_date,
      w.date_closing,
      w.btc_closing_price_usd,
      w.omega_on_off,
      w.buy_usdt,
      w.sell_usdt,
      w.buy_btc,
      w.sell_btc,
      w.fee_paid_usdt,
      w.fee_paid_btc,
      w.fee_paid_zar,
      w.usdt_deposit,
      w.closing_balance_usdt,
      w.closing_balance_btc,
      w.closing_balance_zar,
      w.omega_buy_usdt,
      w.omega_sell_usdt,
      w.sab_buy_usdt,
      w.omega_buy_btc,
      w.omega_sell_btc,
      w.sab_buy_btc,
      sum(w.usdt_deposit) filter (
        where
          w.trade_start_date is not null
          and w.tx_date >= w.trade_start_date
      ) over (
        partition by
          w.customer_id
        order by
          w.tx_date rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as total_invested_usdt,
      sum(w.fee_paid_usdt) filter (
        where
          w.trade_start_date is not null
          and w.tx_date >= w.trade_start_date
      ) over (
        partition by
          w.customer_id
        order by
          w.tx_date rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as total_fees_paid_usdt,
      sum(w.fee_paid_btc) filter (
        where
          w.trade_start_date is not null
          and w.tx_date >= w.trade_start_date
      ) over (
        partition by
          w.customer_id
        order by
          w.tx_date rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as total_fees_paid_btc,
      sum(w.fee_paid_zar) filter (
        where
          w.trade_start_date is not null
          and w.tx_date >= w.trade_start_date
      ) over (
        partition by
          w.customer_id
        order by
          w.tx_date rows between UNBOUNDED PRECEDING
          and CURRENT row
      ) as total_fees_paid_zar,
      case
        when w.trade_start_date is null then null::integer
        when w.tx_date < w.trade_start_date then 0
        else date_part(
          'year'::text,
          age (
            w.tx_date::timestamp with time zone,
            w.trade_start_date::timestamp with time zone
          )
        )::integer + 1
      end as trading_year
    from
      with_splits w
  )
select
  customer_id,
  tx_date,
  date_closing,
  btc_closing_price_usd,
  omega_buy_usdt,
  omega_sell_usdt,
  sab_buy_usdt,
  closing_balance_usdt,
  omega_buy_btc,
  omega_sell_btc,
  sab_buy_btc,
  closing_balance_btc,
  total_invested_usdt,
  COALESCE(total_invested_usdt, 0::numeric) - COALESCE(closing_balance_usdt, 0::numeric) as total_deployed_usdt,
  closing_balance_zar,
  fee_paid_usdt,
  fee_paid_btc,
  fee_paid_zar,
  total_fees_paid_usdt,
  total_fees_paid_btc,
  total_fees_paid_zar,
  COALESCE(closing_balance_btc, 0::numeric) * COALESCE(btc_closing_price_usd, 0::numeric) + COALESCE(closing_balance_usdt, 0::numeric) as portfolio_value_usd,
  case
    when total_invested_usdt is null
    or total_invested_usdt = 0::numeric then null::numeric
    else (
      COALESCE(closing_balance_btc, 0::numeric) * COALESCE(btc_closing_price_usd, 0::numeric) + COALESCE(closing_balance_usdt, 0::numeric) - total_invested_usdt
    ) / total_invested_usdt
  end as total_roi_percent,
  case
    when total_invested_usdt is null
    or total_invested_usdt = 0::numeric then null::numeric
    when trading_year is null
    or trading_year <= 0 then null::numeric
    else power(
      (
        COALESCE(closing_balance_btc, 0::numeric) * COALESCE(btc_closing_price_usd, 0::numeric) + COALESCE(closing_balance_usdt, 0::numeric)
      ) / total_invested_usdt,
      1.0 / trading_year::numeric
    ) - 1::numeric
  end as cagr_percent
from
  with_totals;