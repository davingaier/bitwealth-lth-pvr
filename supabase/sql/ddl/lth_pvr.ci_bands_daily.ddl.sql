create table lth_pvr.ci_bands_daily (
  org_id uuid not null,
  date date not null,
  mode text not null default 'static'::text,
  btc_price numeric(38, 2) not null,
  price_at_mean numeric(38, 2) null,
  price_at_m025 numeric(38, 2) null,
  price_at_m050 numeric(38, 2) null,
  price_at_m075 numeric(38, 2) null,
  price_at_m100 numeric(38, 2) null,
  price_at_p050 numeric(38, 2) null,
  price_at_p100 numeric(38, 2) null,
  price_at_p150 numeric(38, 2) null,
  price_at_p200 numeric(38, 2) null,
  price_at_p250 numeric(38, 2) null,
  fetched_at timestamp with time zone not null default now(),
  source_hash text null,
  constraint ci_bands_daily_mode_check check ((mode = 'static'::text))
) TABLESPACE pg_default;

create unique INDEX IF not exists ci_bands_daily_org_date_mode_uq on lth_pvr.ci_bands_daily using btree (org_id, date, mode) TABLESPACE pg_default;

create index IF not exists ix_ci_bands_daily_date_desc on lth_pvr.ci_bands_daily using btree (date desc) TABLESPACE pg_default;