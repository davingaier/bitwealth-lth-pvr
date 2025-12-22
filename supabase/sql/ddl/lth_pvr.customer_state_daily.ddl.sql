create table lth_pvr.customer_state_daily (
  org_id uuid not null,
  customer_id bigint not null,
  date date not null,
  bear_pause boolean not null default false,
  was_above_p1 boolean not null default false,
  was_above_p15 boolean not null default false,
  r1_armed boolean not null default true,
  r15_armed boolean not null default true,
  constraint customer_state_daily_pkey primary key (org_id, customer_id, date)
) TABLESPACE pg_default;