create table lth_pvr.customer_strategies (
  customer_strategy_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  customer_id bigint not null,
  strategy_version_id uuid not null,
  exchange_account_id uuid not null,
  live_enabled boolean not null default false,
  min_order_usdt numeric(38, 2) not null default 1.00,
  effective_from date not null default CURRENT_DATE,
  effective_to date null,
  created_at timestamp with time zone not null default now(),
  portfolio_id uuid null,
  constraint customer_strategies_pkey primary key (customer_strategy_id),
  constraint customer_strategies_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint customer_strategies_exchange_account_id_fkey foreign KEY (exchange_account_id) references lth_pvr.exchange_accounts (exchange_account_id) on delete RESTRICT,
  constraint customer_strategies_portfolio_id_fkey foreign KEY (portfolio_id) references customer_portfolios (portfolio_id) on delete RESTRICT,
  constraint customer_strategies_strategy_version_id_fkey foreign KEY (strategy_version_id) references lth_pvr.strategy_versions (strategy_version_id) on delete RESTRICT
) TABLESPACE pg_default;