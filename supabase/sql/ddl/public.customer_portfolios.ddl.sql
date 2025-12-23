create table public.customer_portfolios (
  portfolio_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  customer_id bigint not null,
  strategy_code text not null,
  label text not null,
  exchange text not null default 'VALR'::text,
  exchange_account_id uuid null,
  exchange_subaccount text null,
  base_asset text not null default 'BTC'::text,
  quote_asset text not null default 'USDT'::text,
  status text not null default 'active'::text,
  created_at timestamp with time zone not null default now(),
  closed_at timestamp with time zone null,
  constraint customer_portfolios_pkey primary key (portfolio_id),
  constraint customer_portfolios_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint customer_portfolios_exchange_account_id_fkey foreign KEY (exchange_account_id) references lth_pvr.exchange_accounts (exchange_account_id) on delete RESTRICT,
  constraint customer_portfolios_strategy_code_fkey foreign KEY (strategy_code) references strategies (strategy_code) on delete RESTRICT
) TABLESPACE pg_default;

create index IF not exists idx_customer_portfolios_org_cust on public.customer_portfolios using btree (org_id, customer_id, strategy_code, status) TABLESPACE pg_default;