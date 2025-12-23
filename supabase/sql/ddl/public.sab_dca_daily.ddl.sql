create table public.sab_dca_daily (
  customer_id bigint not null,
  date_closing date not null,
  month_yyyymm text not null,
  omega_on_off boolean not null,
  sab_buy_signal boolean not null,
  sab_unpause boolean not null,
  is_sab_release_day boolean not null,
  daily_dca_intent_usdt numeric not null default 0,
  banked_usdt_before numeric not null default 0,
  banked_delta_usdt numeric not null default 0,
  banked_usdt_after numeric not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint sab_dca_daily_pk primary key (customer_id, date_closing),
  constraint sab_dca_daily_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id)
) TABLESPACE pg_default;

create index IF not exists idx_sab_dca_daily_month on public.sab_dca_daily using btree (customer_id, month_yyyymm) TABLESPACE pg_default;