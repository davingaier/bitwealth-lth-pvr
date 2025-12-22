create table lth_pvr.exchange_funding_events (
  funding_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  customer_id bigint not null,
  exchange_account_id uuid not null,
  kind text not null,
  asset text not null,
  amount numeric(38, 8) not null,
  ext_ref text null,
  occurred_at timestamp with time zone not null,
  idempotency_key text null,
  created_at timestamp with time zone not null default now(),
  constraint exchange_funding_events_pkey primary key (funding_id),
  constraint exchange_funding_events_idempotency_key_key unique (idempotency_key),
  constraint exchange_funding_events_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint exchange_funding_events_exchange_account_id_fkey foreign KEY (exchange_account_id) references lth_pvr.exchange_accounts (exchange_account_id),
  constraint exchange_funding_events_asset_check check ((asset = any (array['USDT'::text, 'BTC'::text]))),
  constraint exchange_funding_events_kind_check check (
    (
      kind = any (array['deposit'::text, 'withdrawal'::text])
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_funding_idem on lth_pvr.exchange_funding_events using btree (idempotency_key) TABLESPACE pg_default;