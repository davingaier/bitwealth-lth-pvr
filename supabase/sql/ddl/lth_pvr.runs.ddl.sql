create table lth_pvr.runs (
  run_id uuid not null default gen_random_uuid (),
  org_id uuid not null,
  job_name text not null,
  started_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone null,
  status text not null default 'running'::text,
  error text null,
  args jsonb null,
  counts jsonb null,
  constraint runs_pkey primary key (run_id),
  constraint runs_status_check check (
    (
      status = any (array['running'::text, 'ok'::text, 'error'::text])
    )
  )
) TABLESPACE pg_default;