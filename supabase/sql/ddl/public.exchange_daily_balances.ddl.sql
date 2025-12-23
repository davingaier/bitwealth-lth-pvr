create table public.exchange_daily_balances (
  id bigint generated always as identity not null,
  created_at timestamp with time zone not null default now(),
  as_of_date date not null,
  customer_id bigint not null,
  source_exchange text not null default 'VALR'::text,
  btc_total numeric(28, 10) null default 0,
  btc_available numeric(28, 10) null default 0,
  usdt_total numeric(28, 6) null default 0,
  usdt_available numeric(28, 6) null default 0,
  zar_total numeric(28, 2) null default 0,
  zar_available numeric(28, 2) null default 0,
  note text null,
  updated_at timestamp with time zone not null default now(),
  source text null default 'unknown'::text,
  constraint exchange_daily_balances_pkey primary key (id),
  constraint u_exchange_daily_balances_day unique (customer_id, as_of_date),
  constraint exchange_daily_balances_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete CASCADE
) TABLESPACE pg_default;

create unique INDEX IF not exists uq_ex_daily_bal on public.exchange_daily_balances using btree (customer_id, source_exchange, as_of_date) TABLESPACE pg_default;

create index IF not exists xdb_cust_date_idx on public.exchange_daily_balances using btree (customer_id, as_of_date) TABLESPACE pg_default;

create unique INDEX IF not exists uq_exchange_daily_balances_day on public.exchange_daily_balances using btree (customer_id, as_of_date) TABLESPACE pg_default;

create unique INDEX IF not exists u_exchange_daily_balances on public.exchange_daily_balances using btree (customer_id, as_of_date) TABLESPACE pg_default;

create index IF not exists i_exchange_daily_balances_cust_date on public.exchange_daily_balances using btree (customer_id, as_of_date desc) TABLESPACE pg_default;