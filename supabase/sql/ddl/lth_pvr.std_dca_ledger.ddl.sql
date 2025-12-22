create table lth_pvr.std_dca_ledger (
  ledger_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  customer_id bigint not null,
  date date not null,
  usdt_spent numeric(38, 2) not null default 0,
  btc_bought numeric(38, 8) not null default 0,
  price_used numeric(38, 2) not null,
  fee_btc numeric(38, 8) not null default 0,
  note text null,
  constraint std_dca_ledger_pkey primary key (ledger_id),
  constraint std_dca_ledger_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT
) TABLESPACE pg_default;

create trigger trg_std_dca_ledger_round BEFORE INSERT
or
update on lth_pvr.std_dca_ledger for EACH row
execute FUNCTION lth_pvr.fn_round_financial ();