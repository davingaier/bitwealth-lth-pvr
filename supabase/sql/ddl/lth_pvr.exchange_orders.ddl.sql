create table lth_pvr.exchange_orders (
  exchange_order_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  exchange_account_id uuid not null,
  intent_id uuid null,
  ext_order_id text null,
  pair text not null default 'BTC/USDT'::text,
  side text not null,
  price numeric(38, 2) null,
  qty numeric(38, 8) not null,
  status text not null,
  submitted_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone null,
  raw jsonb null,
  constraint exchange_orders_pkey primary key (exchange_order_id),
  constraint exchange_orders_ext_uq unique (org_id, ext_order_id),
  constraint exchange_orders_exchange_account_id_fkey foreign KEY (exchange_account_id) references lth_pvr.exchange_accounts (exchange_account_id),
  constraint exchange_orders_intent_id_fkey foreign KEY (intent_id) references lth_pvr.order_intents (intent_id),
  constraint exchange_orders_side_check check ((side = any (array['BUY'::text, 'SELL'::text]))),
  constraint exchange_orders_status_check check (
    (
      status = any (
        array[
          'submitted'::text,
          'filled'::text,
          'cancelled'::text,
          'partially_filled'::text,
          'rejected'::text,
          'error'::text,
          'failed'::text,
          'expired'::text,
          'pending'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_exchange_orders_working on lth_pvr.exchange_orders using btree (org_id, status) TABLESPACE pg_default;

create trigger trg_exchange_orders_round BEFORE INSERT
or
update on lth_pvr.exchange_orders for EACH row
execute FUNCTION lth_pvr.fn_round_financial ();