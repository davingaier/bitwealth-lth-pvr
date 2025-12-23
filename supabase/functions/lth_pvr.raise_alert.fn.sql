-- 2) Convenience function to insert alerts

create or replace function lth_pvr.raise_alert(
  p_component    text,
  p_severity     text,
  p_message      text,
  p_context      jsonb default '{}'::jsonb,
  p_org_id       uuid  default null,
  p_customer_id  bigint default null,
  p_portfolio_id uuid  default null
)
returns void
language plpgsql
security definer
as $$
begin
  insert into lth_pvr.alert_events (
    component,
    severity,
    message,
    context,
    org_id,
    customer_id,
    portfolio_id
  )
  values (
    p_component,
    p_severity,
    p_message,
    coalesce(p_context, '{}'::jsonb),
    p_org_id,
    p_customer_id,
    p_portfolio_id
  );
end;
$$;
