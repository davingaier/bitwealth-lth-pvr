create or replace function lth_pvr.ensure_ci_bands_today()
returns void
language plpgsql
as $$
declare
  v_exists      boolean;
  v_target_date date := (now() at time zone 'UTC')::date - interval '1 day';
  v_url         text := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/ef_fetch_ci_bands';
  v_org         uuid := 'b0a77009-03b9-4a41-ae1d-34f157d44a8b'; -- your org_id
  v_mode        text := 'static';
  v_resp        http_response;
begin
  -- 1) Check if we already have ci_bands for yesterday
  select exists (
    select 1
    from   lth_pvr.ci_bands_daily
    where  date   = v_target_date
      and  mode   = v_mode
      and  org_id = v_org
  )
  into v_exists;

  if v_exists then
    -- Row is present, just log that the guard skipped the call
    insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
    values (
      false,
      200,
      jsonb_build_object(
        'info',        'row present',
        'target_date', v_target_date
      )
    );
    return;
  end if;

  -- 2) Row missing → call ef_fetch_ci_bands via pg_net
  v_resp := net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY_HERE'
    ),
    body    := jsonb_build_object(
      'org_id', v_org,
      'mode',  v_mode,
      'days',  5,         -- small window for self-heal
      'guard', true
    )
  );

  insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
  values (
    true,
    coalesce(v_resp.status, 0),
    jsonb_build_object(
      'target_date', v_target_date,
      'status',      v_resp.status,
      'content',     coalesce(v_resp.content, ''),
      'headers',     v_resp.headers
    )
  );

exception
  when others then
    -- Any failure ends up both in guard_log and (via ef_alert_* logic) in alert_events
    insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
    values (
      true,
      599,
      jsonb_build_object(
        'error',       sqlerrm,
        'sqlstate',    sqlstate,
        'target_date', v_target_date
      )
    );
end;
$$;
