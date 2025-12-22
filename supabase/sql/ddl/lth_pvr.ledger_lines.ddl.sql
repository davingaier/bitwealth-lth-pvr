-- Canonical DDL for lth_pvr.ledger_lines
create table lth_pvr.ledger_lines (
  ledger_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  customer_id bigint not null,
  trade_date date not null,
  kind text not null,
  amount_btc numeric(38, 8) not null default 0,
  amount_usdt numeric(38, 2) not null default 0,
  fee_btc numeric(38, 8) not null default 0,
  fee_usdt numeric(38, 2) not null default 0,
  ref_intent_id uuid null,
  ref_order_id uuid null,
  note text null,
  created_at timestamp with time zone not null default now(),
  ref_fill_id uuid null,
  constraint ledger_lines_pkey primary key (ledger_id),
  constraint ledger_lines_ref_fill_id_key unique (ref_fill_id),
  constraint ledger_lines_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint ledger_lines_kind_check check (
    (
      kind = any (
        array[
          'topup'::text,
          'withdrawal'::text,
          'buy'::text,
          'sell'::text,
          'fee'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create trigger trg_ledger_lines_round BEFORE INSERT
or
update on lth_pvr.ledger_lines for EACH row
execute FUNCTION lth_pvr.fn_round_financial ();