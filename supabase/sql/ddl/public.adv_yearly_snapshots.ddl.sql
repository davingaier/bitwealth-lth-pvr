create view public.adv_yearly_snapshots as
select
  customer_id,
  trading_year,
  transaction_date,
  btc_closing_price_usd,
  total_dca_invested_usd,
  portfolio_value_usd,
  closing_balance_btc,
  closing_balance_usd,
  total_roi_percent,
  cagr_percent
from
  (
    select
      t.id,
      t.created_at,
      t.customer_id,
      t.transaction_date,
      t.signal_type,
      t.omega_buy_usd,
      t.omega_buy_btc,
      t.omega_sell_btc,
      t.source_signal,
      t.opening_balance_usd,
      t.closing_balance_usd,
      t.opening_balance_btc,
      t.closing_balance_btc,
      t.daily_dca_usd,
      t.omega_sell_usd,
      t.btc_closing_price_usd,
      t.sab_buy_usd,
      t.sab_buy_btc,
      t.date_closing,
      t.total_dca_invested_usd,
      t.portfolio_value_usd,
      t.total_roi_percent,
      t.trading_year,
      t.cagr_percent,
      row_number() over (
        partition by
          t.customer_id,
          t.trading_year
        order by
          t.transaction_date desc nulls last,
          t.created_at desc nulls last,
          t.id desc
      ) as rn
    from
      adv_dca_customer_transactions t
  ) x
where
  rn = 1;