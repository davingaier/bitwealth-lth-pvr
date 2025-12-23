create table public.adv_dca_buy_sell_rules (
  customer_id bigint not null,
  date_closing date not null,
  created_at timestamp with time zone not null default now(),
  omega_threshold_id bigint null,
  sab_threshold_id bigint null,
  omega_buy_signal boolean not null default false,
  omega_sell_signal boolean not null default false,
  omega_buy_step_percent numeric not null default 0,
  omega_sell_step_percent numeric not null default 0,
  omega_buy_days_between_signal boolean not null default false,
  omega_sell_days_between_signal boolean not null default false,
  sab_buy_signal boolean not null default false,
  sab_price_below_buy_signal boolean not null default false,
  sab_dca_unpause_buy_signal boolean not null default false,
  btc_closing_price_usd numeric null,
  omega_on_off boolean not null default false,
  constraint adv_dca_buy_sell_rules_new_pkey primary key (customer_id, date_closing),
  constraint adv_dca_buy_sell_rules_new_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete CASCADE,
  constraint adv_dca_buy_sell_rules_new_omega_threshold_id_fkey foreign KEY (omega_threshold_id) references adv_dca_omega_thresholds (id),
  constraint adv_dca_buy_sell_rules_new_sab_threshold_id_fkey foreign KEY (sab_threshold_id) references adv_dca_sab_thresholds (id)
) TABLESPACE pg_default;

create index IF not exists adv_dca_buy_sell_rules_new_date_idx on public.adv_dca_buy_sell_rules using btree (date_closing) TABLESPACE pg_default;

create index IF not exists idx_rules_omega_threshold_id on public.adv_dca_buy_sell_rules using btree (omega_threshold_id) TABLESPACE pg_default;

create index IF not exists idx_rules_sab_threshold_id on public.adv_dca_buy_sell_rules using btree (sab_threshold_id) TABLESPACE pg_default;

create index IF not exists idx_adv_rules_customer_date on public.adv_dca_buy_sell_rules using btree (customer_id, date_closing) TABLESPACE pg_default;

create trigger trg_rules_seed_ledger_std
after INSERT
or
update on adv_dca_buy_sell_rules for EACH row
execute FUNCTION trg_rules_seed_ledger_std ();