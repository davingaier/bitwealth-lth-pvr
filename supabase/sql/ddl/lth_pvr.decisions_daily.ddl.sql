create table lth_pvr.decisions_daily (
  org_id uuid not null,
  customer_id bigint not null,
  signal_date date not null,
  trade_date date not null,
  price_usd numeric(18, 2) null,
  band_bucket text null,
  action text null,
  amount_pct numeric(12, 8) null,
  rule text null,
  note text null,
  strategy_version_id uuid null,
  constraint decisions_daily_org_id_customer_id_trade_date_key unique (org_id, customer_id, trade_date),
  constraint decisions_daily_action_check check (
    (
      action = any (array['BUY'::text, 'SELL'::text, 'HOLD'::text])
    )
  )
) TABLESPACE pg_default;

create index IF not exists ix_decisions_daily_org_date on lth_pvr.decisions_daily using btree (org_id, trade_date desc) TABLESPACE pg_default;