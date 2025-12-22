create table lth_pvr.exchange_accounts (
  exchange_account_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  exchange text not null default 'VALR'::text,
  label text null,
  is_omnibus boolean not null default true,
  subaccount_ref text null,
  created_at timestamp with time zone not null default now(),
  subaccount_id text null,
  constraint exchange_accounts_pkey primary key (exchange_account_id)
) TABLESPACE pg_default;