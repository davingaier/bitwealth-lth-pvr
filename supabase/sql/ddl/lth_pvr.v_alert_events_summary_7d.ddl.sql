create or replace view lth_pvr.v_alert_events_summary_7d as
select
  component,
  severity,
  count(*)        as alert_count,
  min(created_at) as first_seen,
  max(created_at) as last_seen
from lth_pvr.alert_events
where created_at >= now() - interval '7 days'
group by component, severity
order by
  case severity
    when 'critical' then 1
    when 'error'    then 2
    when 'warn'     then 3
    else 4
  end,
  component;
