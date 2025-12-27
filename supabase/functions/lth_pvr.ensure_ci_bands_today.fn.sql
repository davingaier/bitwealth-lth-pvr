create or replace function lth_pvr.ensure_ci_bands_today()
returns void
language plpgsql
security definer
as $$
declare
  v_exists      boolean;
  v_target_date date := (now() at time zone 'UTC')::date - interval '1 day';

  v_org   uuid := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  v_mode  text := 'static';

  -- request_id returned by net.http_post(...)
  v_request_id bigint;
  
  -- service role key from vault
  v_service_key text;
begin
  -- Get service role key from vault (UPDATED: now uses 'Secret Key')
  select decrypted_secret into v_service_key 
  from vault.decrypted_secrets 
  where name = 'Secret Key';
  
  if v_service_key is null then
    raise exception 'Secret Key not found in vault';
  end if;
  
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
  --    Note: net.http_post is async and returns a request_id immediately
  --------------------------------------------------------------------
  v_request_id := net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_fetch_ci_bands',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'guard',  true,
      'org_id', v_org
    )
  );

  insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
  values (
    true,
    200,
    jsonb_build_object(
      'request_id',  v_request_id,
      'target_date', v_target_date
    )
  );

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
