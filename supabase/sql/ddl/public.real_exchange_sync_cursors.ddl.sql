create table public.real_exchange_sync_cursors (
  customer_id integer not null,
  last_ts timestamp with time zone null,
  last_seen_order text null,
  updated_at timestamp with time zone not null default now(),
  constraint real_exchange_sync_cursors_pkey primary key (customer_id),
  constraint real_exchange_sync_cursors_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete CASCADE
) TABLESPACE pg_default;