alter table lth_pvr.alert_events
  add column if not exists notified_at timestamp with time zone;