create table lth_pvr.fees_monthly (
  fee_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  customer_id bigint not null,
  month_start date not null,
  month_end date not null,
  nav_start numeric(38, 2) not null,
  nav_end numeric(38, 2) not null,
  net_flows numeric(38, 2) not null,
  profit numeric GENERATED ALWAYS as (((nav_end - nav_start) - net_flows)) STORED (38, 2) null,
  fee_rate numeric(38, 5) not null,
  fee_due numeric GENERATED ALWAYS as (
    (
      GREATEST(((nav_end - nav_start) - net_flows), (0)::numeric) * fee_rate
    )
  ) STORED (38, 2) null,
  fee_paid_usdt numeric(38, 2) not null default 0,
  arrears_usdt numeric(38, 2) not null default 0,
  status text not null default 'pending'::text,
  invoiced_at timestamp with time zone null,
  settled_at timestamp with time zone null,
  note text null,
  created_at timestamp with time zone not null default now(),
  constraint fees_monthly_pkey primary key (fee_id),
  constraint fees_monthly_uq unique (org_id, customer_id, month_start, month_end),
  constraint fees_monthly_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint fees_monthly_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'invoiced'::text,
          'settled'::text,
          'waived'::text,
          'arrears'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;