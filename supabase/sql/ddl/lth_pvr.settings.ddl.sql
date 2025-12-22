create table lth_pvr.settings (
  key text not null,
  val text not null,
  constraint settings_pkey primary key (key)
) TABLESPACE pg_default;