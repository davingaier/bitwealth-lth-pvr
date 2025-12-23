create table public.strategies (
  strategy_code text not null,
  name text not null,
  description text null,
  schema_name text not null,
  created_at timestamp with time zone not null default now(),
  constraint strategies_pkey primary key (strategy_code)
) TABLESPACE pg_default;