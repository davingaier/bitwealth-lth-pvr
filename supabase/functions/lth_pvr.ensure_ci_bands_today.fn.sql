create or replace function lth_pvr.ensure_ci_bands_today()
returns void
language plpgsql
as $$
declare
  v_exists      boolean;
  v_target_date date := (now() at time zone 'UTC')::date - interval '1 day';

  v_org   uuid := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  v_mode  text := 'static';

  -- values returned by net.http_post(...)
  v_status int;
  v_body   text;

  v_has_alert boolean;
begin
  --------------------------------------------------------------------
  -- 1) Check if yesterday already exists in lth_pvr.ci_bands_daily
  --------------------------------------------------------------------
  select exists (
    select 1
    from lth_pvr.ci_bands_daily
    where date   = v_target_date
      and mode   = v_mode
      and org_id = v_org
  )
  into v_exists;

  if v_exists then
    insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
    values (
      false,
      200,
      jsonb_build_object('info','row present','target_date', v_target_date)
    );
    return;
  end if;

  --------------------------------------------------------------------
  -- 2) Call ef_fetch_ci_bands ONLY if yesterday is missing
  --------------------------------------------------------------------
  select
    t.status,
    t.body
  into
    v_status,
    v_body
  from net.http_post(
    url := format(
      'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_fetch_ci_bands',
      current_setting('app.settings.project_ref', true)
    ),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'guard',  true,
      'org_id', v_org
    )::text
  ) as t(status int, headers jsonb, body text);

  insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
  values (
    true,
    coalesce(v_status, 0),
    jsonb_build_object(
      'body',        coalesce(v_body, ''),
      'target_date', v_target_date
    )
  );

  --------------------------------------------------------------------
  -- 3) Alert creation (idempotent per (org, date))
  --    Only if the EF call FAILED (>= 400) OR returned a “no data”
  --    style body.  And only if there is not already an unresolved
  --    alert for this org + component + target_date.
  --------------------------------------------------------------------
  if coalesce(v_status, 0) >= 400 then
    -- check for existing unresolved alert for this date
    select exists (
      select 1
      from lth_pvr.alert_events ae
      where ae.org_id      = v_org
        and ae.component   = 'ef_fetch_ci_bands'
        and ae.severity    in ('warn','error')
        and ae.resolved_at is null
        and ae.context ->> 'target_date' = v_target_date::text
    )
    into v_has_alert;

    if not v_has_alert then
      insert into lth_pvr.alert_events(
        component,
        severity,
        org_id,
        message,
        context
      )
      values (
        'ef_fetch_ci_bands',
        'error',
        v_org,
        'CI bands fetch via ef_fetch_ci_bands failed',
        jsonb_build_object(
          'target_date', v_target_date,
          'status',      v_status,
          'body',        coalesce(v_body, '')
        )
      );
    end if;
  end if;

exception
  when others then
    insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
    values (
      true,
      599,
      jsonb_build_object(
        'error',       sqlstate,
        'msg',         sqlerrm,
        'target_date', v_target_date
      )
    );
end;
$$;
