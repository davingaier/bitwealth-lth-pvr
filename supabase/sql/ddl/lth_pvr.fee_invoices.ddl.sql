create table lth_pvr.fee_invoices (
  invoice_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  customer_id bigint not null,
  fee_id uuid not null,
  invoice_date date not null,
  amount_usdt numeric(38, 2) not null,
  status text not null default 'open'::text,
  created_at timestamp with time zone not null default now(),
  invoice_number text null,
  sent_at timestamp with time zone null,
  constraint fee_invoices_pkey primary key (invoice_id),
  constraint fee_invoices_customer_id_fkey foreign KEY (customer_id) references customer_details (customer_id) on delete RESTRICT,
  constraint fee_invoices_fee_id_fkey foreign KEY (fee_id) references lth_pvr.fees_monthly (fee_id) on delete CASCADE,
  constraint fee_invoices_status_check check (
    (
      status = any (array['open'::text, 'paid'::text, 'void'::text])
    )
  )
) TABLESPACE pg_default;

create unique INDEX IF not exists idx_fee_invoices_number on lth_pvr.fee_invoices using btree (org_id, invoice_number) TABLESPACE pg_default;