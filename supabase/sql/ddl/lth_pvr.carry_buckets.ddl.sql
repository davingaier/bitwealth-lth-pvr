create table lth_pvr.carry_buckets (
  org_id uuid not null,
  customer_id bigint not null,
  asset text not null default 'USDT'::text,
  carry_amount numeric(38, 2) not null default 0.00,
  last_reset_date date null,
  constraint carry_buckets_pk primary key (org_id, customer_id, asset),
  constraint carry_buckets_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT
) TABLESPACE pg_default;