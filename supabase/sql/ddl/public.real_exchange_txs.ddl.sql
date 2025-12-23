create table public.real_exchange_txs (
  id uuid not null default gen_random_uuid (),
  customer_id bigint not null,
  created_at timestamp with time zone not null default now(),
  transaction_timestamp timestamp with time zone not null,
  exchange_order_id text not null,
  tx_type text not null,
  currency_pair text not null,
  debit_currency text not null,
  debit_value numeric not null,
  credit_currency text not null,
  credit_value numeric not null,
  fee_currency text null,
  fee_value numeric null,
  trade_price_currency text null,
  trade_price numeric null,
  trade_side text null,
  source_signal text null,
  manual boolean null default false,
  avg_price numeric null,
  kind text GENERATED ALWAYS as (
    case
      when (
        (upper(currency_pair) = 'USDTZAR'::text)
        and (upper(debit_currency) = 'ZAR'::text)
        and (upper(credit_currency) = 'USDT'::text)
      ) then 'USDT_DEPOSIT'::text
      when (
        (upper(currency_pair) = 'USDTZAR'::text)
        and (upper(debit_currency) = 'USDT'::text)
        and (upper(credit_currency) = 'ZAR'::text)
      ) then 'USDT_WITHDRAWAL'::text
      when (
        (upper(currency_pair) = 'BTCUSDT'::text)
        and (upper(debit_currency) = 'USDT'::text)
        and (upper(credit_currency) = 'BTC'::text)
      ) then 'BTC_BUY'::text
      when (
        (upper(currency_pair) = 'BTCUSDT'::text)
        and (upper(debit_currency) = 'BTC'::text)
        and (upper(credit_currency) = 'USDT'::text)
      ) then 'BTC_SELL'::text
      else 'OTHER'::text
    end
  ) STORED null,
  allocated_month text null,
  notes text null,
  trading_year integer null,
  constraint real_exchange_txs_pkey primary key (id),
  constraint real_exchange_txs_customer_id_exchange_order_id_key unique (customer_id, exchange_order_id),
  constraint real_exchange_txs_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id)
) TABLESPACE pg_default;

create index IF not exists idx_real_txs_customer_date on public.real_exchange_txs using btree (customer_id, transaction_timestamp) TABLESPACE pg_default;

create index IF not exists idx_real_txs_kind_alloc on public.real_exchange_txs using btree (kind, allocated_month) TABLESPACE pg_default;

create index IF not exists idx_real_exchange_txs_trading_year on public.real_exchange_txs using btree (trading_year) TABLESPACE pg_default;

create trigger trg_real_exchange_txs_set_trading_year BEFORE INSERT
or
update OF customer_id,
transaction_timestamp on real_exchange_txs for EACH row
execute FUNCTION real_exchange_txs_set_trading_year ();

create trigger trg_real_txs_ai
after INSERT on real_exchange_txs for EACH row
execute FUNCTION real_txs_after_insert ();

create trigger trg_real_txs_set_source_signal BEFORE INSERT
or
update OF transaction_timestamp,
debit_currency,
credit_currency,
customer_id on real_exchange_txs for EACH row
execute FUNCTION real_txs_set_source_signal ();

create trigger trg_sync_std_on_real_sab
after INSERT on real_exchange_txs for EACH row
execute FUNCTION trg_sync_std_on_real_sab ();