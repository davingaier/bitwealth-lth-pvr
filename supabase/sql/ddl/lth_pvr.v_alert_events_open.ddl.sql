create or replace view lth_pvr.v_alert_events_open as
select
  a.alert_id,
  a.created_at,
  a.org_id,
  a.customer_id,
  a.portfolio_id,
  a.component,
  a.severity,
  a.message,
  a.context,
  a.resolved_at,
  a.resolved_by,
  a.resolution_note
from lth_pvr.alert_events a
where
  a.resolved_at is null
  and a.created_at >= now() - interval '30 days'
  and a.severity in ('warn', 'error', 'critical')
order by a.created_at desc;
