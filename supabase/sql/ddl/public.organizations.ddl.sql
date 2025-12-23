create table public.organizations (
  id uuid not null default gen_random_uuid (),
  name text not null,
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  constraint organizations_pkey primary key (id),
  constraint organizations_name_key unique (name),
  constraint organizations_created_by_fkey foreign KEY (created_by) references auth.users (id) on delete set null
) TABLESPACE pg_default;