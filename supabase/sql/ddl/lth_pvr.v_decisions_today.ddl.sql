create view lth_pvr.v_decisions_today as
select
  org_id,
  customer_id,
  signal_date,
  trade_date,
  price_usd,
  band_bucket,
  action,
  amount_pct,
  rule,
  note,
  strategy_version_id
from
  lth_pvr.decisions_daily d
where
  trade_date = CURRENT_DATE;