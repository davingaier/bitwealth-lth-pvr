-- Enhanced version of ensure_ci_bands_today with optional auto-resume capability
-- After successfully fetching CI bands, optionally triggers pipeline resume if within processing window

create or replace function lth_pvr.ensure_ci_bands_today_with_resume(
  p_auto_resume boolean default false
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_exists        boolean;
  v_target_date   date := (now() at time zone 'UTC')::date - interval '1 day';
  v_current_hour  int := extract(hour from (now() at time zone 'UTC'));
  v_in_window     boolean;

  v_org           uuid := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  v_mode          text := 'static';

  v_request_id    bigint;
  v_service_key   text;
  v_resume_result jsonb;
begin
  -- Get service role key from vault
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
    
    -- If auto-resume enabled and we're in processing window (03:00-08:00 UTC)
    -- and CI bands exist, trigger pipeline resume
    v_in_window := v_current_hour >= 3 and v_current_hour < 8;
    
    if p_auto_resume and v_in_window then
      -- Call resume_daily_pipeline for current date (which uses yesterday's CI bands)
      select lth_pvr.resume_daily_pipeline() into v_resume_result;
      
      return jsonb_build_object(
        'ci_bands_status', 'already_present',
        'target_date', v_target_date,
        'auto_resume_triggered', true,
        'resume_result', v_resume_result
      );
    end if;
    
    return jsonb_build_object(
      'ci_bands_status', 'already_present',
      'target_date', v_target_date,
      'auto_resume_triggered', false
    );
  end if;

  --------------------------------------------------------------------
  -- 2) Call ef_fetch_ci_bands ONLY if yesterday is missing
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
      'target_date', v_target_date,
      'auto_resume_pending', p_auto_resume
    )
  );

  -- Note: Since http_post is async, we cannot immediately trigger resume here
  -- The resume would need to be triggered by a subsequent guard run or manually
  -- For immediate auto-resume after fetch, consider using a separate scheduled function
  
  return jsonb_build_object(
    'ci_bands_status', 'fetch_triggered',
    'target_date', v_target_date,
    'request_id', v_request_id,
    'auto_resume_pending', p_auto_resume,
    'note', 'CI bands fetch initiated. Run guard again after fetch completes for auto-resume.'
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
    
    return jsonb_build_object(
      'ci_bands_status', 'error',
      'target_date', v_target_date,
      'error', sqlerrm
    );
end;
$$;

comment on function lth_pvr.ensure_ci_bands_today_with_resume is 
  'Enhanced guard function with optional auto-resume capability. Set p_auto_resume=true to automatically trigger pipeline when CI bands become available within processing window (03:00-08:00 UTC).';
