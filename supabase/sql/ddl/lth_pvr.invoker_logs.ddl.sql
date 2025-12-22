create table lth_pvr.invoker_logs (
  id bigserial not null,
  called_at timestamp with time zone null default now(),
  fn_name text not null,
  url text not null,
  status integer null,
  body text null,
  headers jsonb null,
  payload jsonb null,
  constraint invoker_logs_pkey primary key (id)
) TABLESPACE pg_default;