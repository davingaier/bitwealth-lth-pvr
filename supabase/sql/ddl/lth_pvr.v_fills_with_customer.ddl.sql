create view lth_pvr.v_fills_with_customer as
select
  f.org_id,
  cd.customer_id,
  cd.first_names,
  cd.last_name,
  cd.email_address,
  cd.cellphone_number,
  f.fill_id,
  f.exchange_order_id,
  f.trade_ts,
  f.price as fill_price,
  f.qty as fill_qty,
  f.fee_asset,
  f.fee_qty,
  f.created_at as fill_created_at,
  eo.exchange_account_id,
  eo.ext_order_id,
  eo.pair as order_pair,
  eo.side as order_side,
  eo.price as order_price,
  eo.qty as order_qty,
  eo.status as order_status,
  eo.submitted_at as order_submitted_at,
  eo.updated_at as order_updated_at,
  eo.raw as order_raw,
  i.intent_id,
  i.trade_date,
  i.side as intent_side,
  i.limit_price as intent_limit_price,
  i.amount as intent_amount,
  i.base_asset,
  i.quote_asset,
  i.reason as intent_reason,
  i.note as intent_note,
  i.status as intent_status,
  i.created_at as intent_created_at
from
  lth_pvr.order_fills f
  join lth_pvr.exchange_orders eo on eo.exchange_order_id = f.exchange_order_id
  and eo.org_id = f.org_id
  join lth_pvr.order_intents i on i.intent_id = eo.intent_id
  and i.org_id = eo.org_id
  join customer_details cd on cd.customer_id = i.customer_id
  and cd.org_id = i.org_id;