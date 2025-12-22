create table lth_pvr.order_intents (
  intent_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  customer_id bigint not null,
  trade_date date not null,
  pair text not null default 'BTC/USDT'::text,
  side text not null,
  limit_price numeric(38, 2) null,
  amount numeric(38, 8) not null,
  base_asset text not null default 'BTC'::text,
  quote_asset text not null default 'USDT'::text,
  reason text null,
  note text null,
  status text not null default 'pending'::text,
  idempotency_key text not null,
  created_at timestamp with time zone not null default now(),
  exchange_account_id uuid null,
  constraint order_intents_pkey primary key (intent_id),
  constraint order_intents_idempotency_key_key unique (idempotency_key),
  constraint fk_order_intents_exchange_account foreign KEY (exchange_account_id) references lth_pvr.exchange_accounts (exchange_account_id),
  constraint order_intents_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint order_intents_side_check check ((side = any (array['BUY'::text, 'SELL'::text]))),
  constraint order_intents_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'executed'::text,
          'skipped'::text,
          'canceled'::text,
          'error'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_order_intents_status on lth_pvr.order_intents using btree (org_id, status, trade_date) TABLESPACE pg_default;

create index IF not exists idx_order_intents_exchange_account_id on lth_pvr.order_intents using btree (exchange_account_id) TABLESPACE pg_default;

create trigger trg_order_intents_round BEFORE INSERT
or
update on lth_pvr.order_intents for EACH row
execute FUNCTION lth_pvr.fn_round_financial ();