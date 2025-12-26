-- 1.1 List alerts (optionally only open)
create or replace function public.list_lth_alert_events(
  p_only_open boolean default true,
  p_limit     integer default 50
)
returns table (
  alert_id        uuid,
  created_at      timestamptz,
  component       text,
  severity        text,
  org_id          uuid,
  customer_id     bigint,
  portfolio_id    uuid,
  message         text,
  context         jsonb,
  resolved_at     timestamptz,
  resolved_by     text,
  resolution_note text
)
language sql
security definer
set search_path = public, lth_pvr
as $$
  select
    a.alert_id,
    a.created_at,
    a.component,
    a.severity,
    a.org_id,
    a.customer_id,
    a.portfolio_id,
    a.message,
    a.context,
    a.resolved_at,
    a.resolved_by,
    a.resolution_note
  from lth_pvr.alert_events a
  where (not p_only_open or a.resolved_at is null)
  order by a.created_at desc
  limit coalesce(p_limit, 50);
$$;

revoke all on function public.list_lth_alert_events(boolean, integer) from public;
grant execute on function public.list_lth_alert_events(boolean, integer) to anon, authenticated;