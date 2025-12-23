create view public.v_real_txs_sab_monthly_flows as
select
  customer_id,
  case
    when kind = 'USDT_DEPOSIT'::text then allocated_month
    when currency_pair = 'USDTZAR'::text
    and upper(credit_currency) = 'USDT'::text then allocated_month
    else to_char(
      (transaction_timestamp AT TIME ZONE 'UTC'::text),
      'YYYY-MM'::text
    )
  end as month_yyyymm,
  'VALR'::text as exchange,
  case
    when kind = 'USDT_DEPOSIT'::text
    and allocated_month is not null then credit_value
    when currency_pair = 'USDTZAR'::text
    and upper(credit_currency) = 'USDT'::text
    and allocated_month is not null then credit_value
    when kind = 'BTC_SELL'::text then credit_value
    else 0::numeric
  end as usdt_in_row,
  case
    when kind = 'USDT_WITHDRAWAL'::text then debit_value
    when kind = 'BTC_BUY'::text then debit_value
    else 0::numeric
  end as usdt_out_row,
  case
    when upper(fee_currency) = 'USDT'::text
    and not (
      kind = 'USDT_DEPOSIT'::text
      and allocated_month is null
      or currency_pair = 'USDTZAR'::text
      and upper(credit_currency) = 'USDT'::text
      and allocated_month is null
    ) then COALESCE(fee_value, 0::numeric)
    else 0::numeric
  end as fee_usdt_row
from
  real_exchange_txs t;