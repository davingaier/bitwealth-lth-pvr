create view lth_pvr.v_order_status as
select
  i.org_id,
  i.customer_id,
  i.trade_date,
  i.intent_id,
  i.side,
  i.limit_price,
  i.amount,
  i.status as intent_status,
  eo.exchange_order_id,
  eo.ext_order_id,
  eo.status as order_status,
  eo.price as order_price,
  eo.qty as order_qty,
  eo.submitted_at,
  eo.updated_at
from
  lth_pvr.order_intents i
  left join lateral (
    select
      eo_1.exchange_order_id,
      eo_1.org_id,
      eo_1.exchange_account_id,
      eo_1.intent_id,
      eo_1.ext_order_id,
      eo_1.pair,
      eo_1.side,
      eo_1.price,
      eo_1.qty,
      eo_1.status,
      eo_1.submitted_at,
      eo_1.updated_at,
      eo_1.raw
    from
      lth_pvr.exchange_orders eo_1
    where
      eo_1.intent_id = i.intent_id
    order by
      eo_1.submitted_at desc
    limit
      1
  ) eo on true;