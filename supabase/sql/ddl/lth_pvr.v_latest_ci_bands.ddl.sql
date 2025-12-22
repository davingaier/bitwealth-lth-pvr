create view lth_pvr.v_latest_ci_bands as
select distinct
  on (org_id) org_id,
  date,
  mode,
  btc_price,
  price_at_mean,
  price_at_m025,
  price_at_m050,
  price_at_m075,
  price_at_m100,
  price_at_p050,
  price_at_p100,
  price_at_p150,
  price_at_p200,
  price_at_p250,
  fetched_at
from
  lth_pvr.ci_bands_daily
order by
  org_id,
  date desc;