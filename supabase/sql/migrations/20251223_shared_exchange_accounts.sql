-- 1) Shared exchange_accounts table in public schema
create table if not exists public.exchange_accounts (
  exchange_account_id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  exchange text not null default 'VALR'::text,
  label text null,
  is_omnibus boolean not null default true,
  subaccount_ref text null,
  subaccount_id text null,
  status text not null default 'active'::text,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz null,
  constraint exchange_accounts_pkey primary key (exchange_account_id)
);

-- 2) Backfill from existing lth_pvr.exchange_accounts (if any rows exist)
insert into public.exchange_accounts (
  exchange_account_id,
  org_id,
  exchange,
  label,
  is_omnibus,
  subaccount_ref,
  subaccount_id,
  created_at
)
select
  exchange_account_id,
  org_id,
  exchange,
  label,
  is_omnibus,
  subaccount_ref,
  subaccount_id,
  created_at
from lth_pvr.exchange_accounts
on conflict (exchange_account_id) do nothing;

-- 3) Move foreign keys off lth_pvr.exchange_accounts and onto public.exchange_accounts
do $$
declare
  r record;
begin
  -- Drop any existing FKs that reference lth_pvr.exchange_accounts
  for r in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where contype = 'f'
      and confrelid = 'lth_pvr.exchange_accounts'::regclass
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  -- Re-create explicit FKs pointing to public.exchange_accounts

  -- lth_pvr.exchange_funding_events.exchange_account_id → public.exchange_accounts
  if to_regclass('lth_pvr.exchange_funding_events') is not null then
    execute $q$
      alter table lth_pvr.exchange_funding_events
      add constraint exchange_funding_events_exchange_account_id_fkey
      foreign key (exchange_account_id)
      references public.exchange_accounts(exchange_account_id)
    $q$;
  end if;

  -- lth_pvr.exchange_orders.exchange_account_id → public.exchange_accounts
  if to_regclass('lth_pvr.exchange_orders') is not null then
    execute $q$
      alter table lth_pvr.exchange_orders
      add constraint exchange_orders_exchange_account_id_fkey
      foreign key (exchange_account_id)
      references public.exchange_accounts(exchange_account_id)
    $q$;
  end if;

  -- lth_pvr.order_intents.exchange_account_id → public.exchange_accounts
  if to_regclass('lth_pvr.order_intents') is not null then
    execute $q$
      alter table lth_pvr.order_intents
      add constraint fk_order_intents_exchange_account
      foreign key (exchange_account_id)
      references public.exchange_accounts(exchange_account_id)
    $q$;
  end if;
end$$;

-- 4) Replace lth_pvr.exchange_accounts table with a view over the shared table
-- (so any existing SELECTs against lth_pvr.exchange_accounts keep working)
drop view if exists lth_pvr.exchange_accounts;
drop table if exists lth_pvr.exchange_accounts;

create view lth_pvr.exchange_accounts as
select
  exchange_account_id,
  org_id,
  exchange,
  label,
  is_omnibus,
  subaccount_ref,
  created_at,
  subaccount_id
from public.exchange_accounts
where exchange = 'VALR';

-- 5) RLS for public.exchange_accounts (browser clients)
alter table public.exchange_accounts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'exchange_accounts'
      and policyname = 'org_can_select_exchange_accounts'
  ) then
    create policy org_can_select_exchange_accounts
      on public.exchange_accounts
      for select
      using (org_id in (select id from public.my_orgs()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'exchange_accounts'
      and policyname = 'org_can_insert_exchange_accounts'
  ) then
    create policy org_can_insert_exchange_accounts
      on public.exchange_accounts
      for insert
      with check (org_id in (select id from public.my_orgs()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'exchange_accounts'
      and policyname = 'org_can_update_exchange_accounts'
  ) then
    create policy org_can_update_exchange_accounts
      on public.exchange_accounts
      for update
      using (org_id in (select id from public.my_orgs()))
      with check (org_id in (select id from public.my_orgs()));
  end if;
end$$;
