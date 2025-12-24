create or replace function lth_pvr.alert_ack(
  p_alert_id uuid,
  p_user     text default null,
  p_note     text default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_user text;
begin
  -- Prefer explicit user, then JWT email (Supabase), then DB user
  v_user := coalesce(
    p_user,
    nullif(current_setting('request.jwt.claim.email', true), ''),
    current_user
  );

  update lth_pvr.alert_events
  set
    resolved_at   = coalesce(resolved_at, now()),
    resolved_by   = coalesce(v_user, resolved_by),
    resolution_note = coalesce(p_note, resolution_note)
  where alert_id = p_alert_id;
end;
$$;
