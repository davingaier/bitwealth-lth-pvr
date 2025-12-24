-- 2.1 Indexes for lth_pvr.alert_events (aligned with your DDL)

-- You already have this one in the DDL, but it's safe to keep:
create index if not exists idx_lth_alerts_created_at
  on lth_pvr.alert_events (created_at desc);

-- Optional: a plain severity index (helps some queries / summaries)
create index if not exists idx_lth_alerts_severity
  on lth_pvr.alert_events (severity);

-- You also already have this "unresolved" index; again safe to re-run:
create index if not exists idx_lth_alerts_unresolved_on
  on lth_pvr.alert_events (severity, created_at)
  where resolved_at is null;
