create view public.std_yearly_snapshots as
select
  customer_id,
  trading_year,
  transaction_date,
  portfolio_value_usd,
  total_roi_percent,
  cagr_percent
from
  (
    select
      t.id,
      t.created_at,
      t.customer_id,
      t.transaction_date,
      t.btc_date_closing,
      t.btc_closing_price_usd,
      t.signal_type,
      t.daily_dca_usd,
      t.buy_usd,
      t.buy_btc,
      t.opening_balance_usd,
      t.closing_balance_usd,
      t.opening_balance_btc,
      t.closing_balance_btc,
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
      std_dca_customer_transactions t
  ) x
where
  rn = 1;