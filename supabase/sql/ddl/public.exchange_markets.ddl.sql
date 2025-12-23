create table public.exchange_markets (
  symbol text not null,
  price_tick numeric null,
  qty_step numeric null,
  min_notional numeric null,
  constraint exchange_markets_pkey primary key (symbol)
) TABLESPACE pg_default;