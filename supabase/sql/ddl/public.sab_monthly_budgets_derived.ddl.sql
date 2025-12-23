create view public.sab_monthly_budgets_derived as
select
  customer_id,
  exchange,
  month_yyyymm,
  sum(usdt_in_row) as usdt_in,
  sum(usdt_out_row + fee_usdt_row) as usdt_out
from
  v_real_txs_sab_monthly_flows f
where
  month_yyyymm is not null
group by
  customer_id,
  exchange,
  month_yyyymm;