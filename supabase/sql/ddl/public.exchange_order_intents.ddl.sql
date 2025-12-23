create table public.exchange_order_intents (
  intent_id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  customer_id bigint not null,
  date_closing date not null,
  symbol text not null,
  side text not null,
  intent_usdt numeric(28, 6) not null default 0,
  intent_btc numeric(28, 10) not null default 0,
  intent_price numeric(28, 6) not null default 0,
  best_bid numeric(28, 6) null,
  best_ask numeric(28, 6) null,
  price_tick numeric(28, 8) null,
  qty_step numeric(28, 8) null,
  min_notional numeric(28, 6) null,
  status text not null default 'preview'::text,
  notes text null,
  fee_usdt numeric(24, 8) null default 0,
  fee_btc numeric(24, 8) null default 0,
  exchange_order_id text null,
  closed_at timestamp with time zone null,
  fee_zar numeric null default 0,
  avg_price numeric null,
  source_signal text null,
  intent_date timestamp with time zone null default now(),
  submitted_at timestamp with time zone null,
  valr_order_id text null,
  constraint exchange_order_intents_pkey primary key (intent_id),
  constraint exchange_order_intents_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete CASCADE,
  constraint exchange_order_intents_side_check check ((side = any (array['BUY'::text, 'SELL'::text]))),
  constraint exchange_order_intents_status_check check (
    (
      status = any (
        array[
          'preview'::text,
          'submitted'::text,
          'executing'::text,
          'partially_filled'::text,
          'filled'::text,
          'cancelled'::text,
          'error'::text,
          'skipped'::text
        ]
      )
    )
  ),
  constraint fee_zar_nonneg check ((fee_zar >= (0)::numeric))
) TABLESPACE pg_default;

create index IF not exists eoi_cust_exorder_idx on public.exchange_order_intents using btree (customer_id, exchange_order_id) TABLESPACE pg_default;

create index IF not exists eoi_submitted_idx on public.exchange_order_intents using btree (submitted_at) TABLESPACE pg_default;

create index IF not exists eoi_valr_order_id_idx on public.exchange_order_intents using btree (valr_order_id) TABLESPACE pg_default;

create index IF not exists eoi_preview_key_idx on public.exchange_order_intents using btree (customer_id, date_closing, side) TABLESPACE pg_default
where
  (
    (status = 'preview'::text)
    and (exchange_order_id is null)
    and (valr_order_id is null)
  );

create index IF not exists eoi_date_cust_idx on public.exchange_order_intents using btree (date_closing, customer_id) TABLESPACE pg_default;

create index IF not exists eoi_status_idx on public.exchange_order_intents using btree (status) TABLESPACE pg_default;

create index IF not exists exchange_order_intents_order_id_idx on public.exchange_order_intents using btree (exchange_order_id) TABLESPACE pg_default;

create index IF not exists eoi_symbol_status_idx on public.exchange_order_intents using btree (symbol, status) TABLESPACE pg_default;

create index IF not exists eoi_intent_date_status_idx on public.exchange_order_intents using btree (intent_date, status) TABLESPACE pg_default;

create index IF not exists eoi_date_status_idx on public.exchange_order_intents using btree (date_closing, status) TABLESPACE pg_default;

create trigger trg_eoi_date_closing BEFORE INSERT
or
update on exchange_order_intents for EACH row
execute FUNCTION eoi_set_date_closing ();

create trigger trg_eoi_intent_date_on_status BEFORE
update OF status on exchange_order_intents for EACH row
execute FUNCTION eoi_set_intent_date_on_status ();

create trigger trg_eoi_market_meta BEFORE INSERT
or
update OF symbol on exchange_order_intents for EACH row
execute FUNCTION eoi_fill_market_meta ();