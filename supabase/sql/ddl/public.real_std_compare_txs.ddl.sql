create table public.real_std_compare_txs (
  id uuid not null default gen_random_uuid (),
  customer_id bigint not null,
  date_closing date not null,
  transaction_timestamp timestamp with time zone not null,
  currency_pair text not null default 'BTCUSDT'::text,
  debit_currency text not null default 'USDT'::text,
  debit_value numeric not null,
  credit_currency text not null default 'BTC'::text,
  credit_value numeric not null,
  fee_currency text not null default 'BTC'::text,
  fee_value numeric not null,
  trade_price numeric not null,
  trade_side text not null default 'BUY'::text,
  source_signal text not null default 'STD_DCA'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  trading_year integer null,
  constraint real_std_compare_txs_pkey primary key (id),
  constraint real_std_compare_uniq unique (customer_id, date_closing),
  constraint real_std_compare_txs_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id)
) TABLESPACE pg_default;

create index IF not exists idx_std_compare_trading_year on public.real_std_compare_txs using btree (trading_year) TABLESPACE pg_default;

create index IF not exists idx_std_compare_date on public.real_std_compare_txs using btree (customer_id, date_closing) TABLESPACE pg_default;

create trigger trg_std_compare_set_trading_year BEFORE INSERT
or
update OF customer_id,
transaction_timestamp on real_std_compare_txs for EACH row
execute FUNCTION real_std_compare_txs_set_trading_year ();