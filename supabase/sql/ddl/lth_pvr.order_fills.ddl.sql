create table lth_pvr.order_fills (
  fill_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  exchange_order_id uuid not null,
  trade_ts timestamp with time zone not null,
  price numeric(38, 2) not null,
  qty numeric(38, 8) not null,
  fee_asset text not null,
  fee_qty numeric(38, 8) not null,
  raw jsonb null,
  created_at timestamp with time zone not null default now(),
  constraint order_fills_pkey primary key (fill_id),
  constraint order_fills_exchange_order_id_fkey foreign KEY (exchange_order_id) references lth_pvr.exchange_orders (exchange_order_id) on delete CASCADE,
  constraint order_fills_fee_asset_check check (
    (
      fee_asset = any (array['BTC'::text, 'USDT'::text])
    )
  )
) TABLESPACE pg_default;

create trigger trg_order_fills_round BEFORE INSERT
or
update on lth_pvr.order_fills for EACH row
execute FUNCTION lth_pvr.fn_round_financial ();