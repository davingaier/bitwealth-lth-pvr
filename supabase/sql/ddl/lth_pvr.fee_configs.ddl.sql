create table lth_pvr.fee_configs (
  org_id uuid not null,
  customer_id bigint not null,
  fee_rate numeric(38, 5) not null default 0.10,
  settlement_mode text not null default 'usdt_or_sell_btc'::text,
  min_usdt_reserve numeric(38, 2) not null default 0.00,
  reserve_pct numeric(38, 5) not null default 0.00,
  created_at timestamp with time zone not null default now(),
  constraint fee_configs_pk primary key (org_id, customer_id),
  constraint fee_configs_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint fee_configs_settlement_mode_check check (
    (
      settlement_mode = any (
        array[
          'usdt_only'::text,
          'usdt_or_sell_btc'::text,
          'invoice_only'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;