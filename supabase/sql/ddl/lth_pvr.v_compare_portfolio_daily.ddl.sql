create view lth_pvr.v_compare_portfolio_daily as
with
  actual as (
    select
      balances_daily.org_id,
      balances_daily.customer_id,
      balances_daily.date,
      balances_daily.nav_usd as nav_actual
    from
      lth_pvr.balances_daily
  ),
  dca as (
    select
      std_dca_balances_daily.org_id,
      std_dca_balances_daily.customer_id,
      std_dca_balances_daily.date,
      std_dca_balances_daily.nav_usd as nav_dca
    from
      lth_pvr.std_dca_balances_daily
  )
select
  COALESCE(a.org_id, d.org_id) as org_id,
  COALESCE(a.customer_id, d.customer_id) as customer_id,
  COALESCE(a.date, d.date) as date,
  a.nav_actual,
  d.nav_dca,
  a.nav_actual - d.nav_dca as nav_outperformance,
  case
    when d.nav_dca is null
    or d.nav_dca = 0::numeric then null::numeric
    else (a.nav_actual - d.nav_dca) / d.nav_dca * 100::numeric
  end as outperformance_pct
from
  actual a
  full join dca d on d.org_id = a.org_id
  and d.customer_id = a.customer_id
  and d.date = a.date;