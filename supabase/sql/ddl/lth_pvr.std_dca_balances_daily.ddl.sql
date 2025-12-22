create table lth_pvr.std_dca_balances_daily (
  org_id uuid not null,
  customer_id bigint not null,
  date date not null,
  btc_balance numeric(38, 8) not null default 0,
  usdt_balance numeric(38, 2) not null default 0,
  nav_usd numeric(38, 2) not null default 0,
  constraint std_dca_balances_pk primary key (org_id, customer_id, date),
  constraint std_dca_balances_daily_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT
) TABLESPACE pg_default;

create trigger trg_std_dca_balances_daily_round BEFORE INSERT
or
update on lth_pvr.std_dca_balances_daily for EACH row
execute FUNCTION lth_pvr.fn_round_financial ();