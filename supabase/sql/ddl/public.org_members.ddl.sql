create table public.org_members (
  org_id uuid not null,
  user_id uuid not null,
  role public.org_role not null default 'viewer'::org_role,
  invited_by uuid null,
  created_at timestamp with time zone not null default now(),
  constraint org_members_pkey primary key (org_id, user_id),
  constraint org_members_invited_by_fkey foreign KEY (invited_by) references auth.users (id) on delete set null,
  constraint org_members_org_id_fkey foreign KEY (org_id) references organizations (id) on delete CASCADE,
  constraint org_members_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists org_members_user_id_idx on public.org_members using btree (user_id) TABLESPACE pg_default;

create index IF not exists org_members_org_id_idx on public.org_members using btree (org_id) TABLESPACE pg_default;