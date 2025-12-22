create table lth_pvr.std_dca_config (
  org_id uuid not null,
  customer_id bigint not null,
  method text not null default 'month_proportional'::text,
  fixed_usdt_per_day numeric(38, 2) null,
  maker_bps_base numeric(38, 5) not null default 8.0,
  created_at timestamp with time zone not null default now(),
  constraint std_dca_config_pk primary key (org_id, customer_id),
  constraint std_dca_config_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint std_dca_config_method_check check (
    (
      method = any (array['month_proportional'::text, 'fixed'::text])
    )
  )
) TABLESPACE pg_default;