-- 1.2 Resolve a single alert
create or replace function public.resolve_lth_alert_event(
  p_alert_id        uuid,
  p_resolved_by     text,
  p_resolution_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, lth_pvr
as $$
begin
  update lth_pvr.alert_events
     set resolved_at     = now(),
         resolved_by     = p_resolved_by,
         resolution_note = coalesce(p_resolution_note, resolution_note)
   where alert_id    = p_alert_id
     and resolved_at is null;
end;
$$;

revoke all on function public.resolve_lth_alert_event(uuid, text, text) from public;
grant execute on function public.resolve_lth_alert_event(uuid, text, text) to anon, authenticated;