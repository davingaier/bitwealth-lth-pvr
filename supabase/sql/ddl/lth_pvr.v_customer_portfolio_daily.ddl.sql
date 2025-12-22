create view lth_pvr.v_customer_portfolio_daily as
select
  b.org_id,
  b.customer_id,
  b.date,
  b.btc_balance,
  b.usdt_balance,
  b.nav_usd,
  d.action,
  d.amount_pct,
  d.rule,
  d.note,
  d.band_bucket,
  d.price_usd as signal_price_usd,
  d.signal_date,
  d.trade_date,
  sv.name as strategy_version_name
from
  lth_pvr.balances_daily b
  left join lth_pvr.decisions_daily d on d.org_id = b.org_id
  and d.customer_id = b.customer_id
  and d.trade_date = b.date
  left join lth_pvr.customer_strategies cs on cs.org_id = b.org_id
  and cs.customer_id = b.customer_id
  and cs.effective_from <= b.date
  and (
    cs.effective_to is null
    or cs.effective_to >= b.date
  )
  left join lth_pvr.strategy_versions sv on sv.strategy_version_id = cs.strategy_version_id;