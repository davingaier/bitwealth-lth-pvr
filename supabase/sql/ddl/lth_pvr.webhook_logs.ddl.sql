create table lth_pvr.webhook_logs (
  hook_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  direction text not null,
  endpoint text not null,
  payload jsonb not null,
  response_code integer null,
  ts timestamp with time zone not null default now(),
  constraint webhook_logs_pkey primary key (hook_id),
  constraint webhook_logs_direction_check check (
    (direction = any (array['in'::text, 'out'::text]))
  )
) TABLESPACE pg_default;