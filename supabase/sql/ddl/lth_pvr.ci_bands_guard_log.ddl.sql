create table lth_pvr.ci_bands_guard_log (
  id bigserial not null,
  ran_at timestamp with time zone null default now(),
  did_call boolean not null,
  status integer null,
  details jsonb null,
  constraint ci_bands_guard_log_pkey primary key (id)
) TABLESPACE pg_default;