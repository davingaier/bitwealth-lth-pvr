-- Migration: Add LTH_PVR Pipeline Resume Capability
-- Date: 2025-12-28
-- Description: Adds functions and UI for resuming the LTH_PVR pipeline after CI bands become available
--              Includes trade window expiration validation to prevent stale trades

-- =====================================================================
-- 1. Helper function to check pipeline status
-- =====================================================================

create or replace function lth_pvr.get_pipeline_status(
  p_trade_date date default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_trade_date     date;
  v_signal_date    date;
  v_current_date   date;
  v_org_id         uuid := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  
  v_ci_exists      boolean;
  v_window_valid   boolean;
  v_window_closes  timestamp;
  
  v_decisions_done boolean;
  v_intents_done   boolean;
  v_orders_done    boolean;
  v_ledger_done    boolean;
  
  v_can_resume     boolean;
  v_resume_reason  text;
begin
  -- Determine dates
  v_trade_date := coalesce(p_trade_date, (now() at time zone 'UTC')::date);
  v_signal_date := v_trade_date - interval '1 day';
  v_current_date := (now() at time zone 'UTC')::date;
  v_window_closes := (v_signal_date + interval '1 day' + interval '23 hours 59 minutes')::timestamp;
  
  -- Check CI bands existence
  select exists (
    select 1
    from lth_pvr.ci_bands_daily
    where date = v_signal_date
      and mode = 'static'
      and org_id = v_org_id
  )
  into v_ci_exists;
  
  -- Check trade window validity: current_date <= signal_date + 1
  v_window_valid := v_current_date <= (v_signal_date + interval '1 day')::date;
  
  -- Check completed steps
  select exists (
    select 1
    from lth_pvr.decisions_daily
    where trade_date = v_trade_date
      and org_id = v_org_id
  )
  into v_decisions_done;
  
  select exists (
    select 1
    from lth_pvr.order_intents
    where trade_date = v_trade_date
      and org_id = v_org_id
  )
  into v_intents_done;
  
  select exists (
    select 1
    from lth_pvr.exchange_orders
    where created_at::date = v_trade_date
      and org_id = v_org_id
  )
  into v_orders_done;
  
  select exists (
    select 1
    from lth_pvr.ledger_lines
    where line_date = v_trade_date
      and org_id = v_org_id
  )
  into v_ledger_done;
  
  -- Determine if pipeline can be resumed
  v_can_resume := v_ci_exists and v_window_valid and not v_decisions_done;
  
  if not v_ci_exists then
    v_resume_reason := format('CI bands for %s not yet available', v_signal_date);
  elsif not v_window_valid then
    v_resume_reason := format('Trade window expired (current date: %s, window closed: %s)', 
                              v_current_date, v_window_closes);
  elsif v_decisions_done then
    v_resume_reason := 'Pipeline already executed for this trade date';
  else
    v_resume_reason := 'Pipeline ready to resume';
  end if;
  
  return jsonb_build_object(
    'trade_date', v_trade_date,
    'signal_date', v_signal_date,
    'current_date', v_current_date,
    'window_closes', v_window_closes,
    'ci_bands_available', v_ci_exists,
    'window_valid', v_window_valid,
    'can_resume', v_can_resume,
    'resume_reason', v_resume_reason,
    'steps', jsonb_build_object(
      'decisions_generated', v_decisions_done,
      'intents_created', v_intents_done,
      'orders_executed', v_orders_done,
      'ledger_posted', v_ledger_done
    )
  );
end;
$$;

comment on function lth_pvr.get_pipeline_status is 
  'Returns pipeline execution status for a trade date, including CI bands availability and trade window validity.';

-- =====================================================================
-- 2. Main function to resume pipeline with expiration validation
-- =====================================================================

create or replace function lth_pvr.resume_daily_pipeline(
  p_trade_date date default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_trade_date     date;
  v_signal_date    date;
  v_org_id         uuid := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  v_service_key    text;
  v_project_ref    text := 'wqnmxpooabmedvtackji';
  v_base_url       text;
  
  v_ci_exists      boolean;
  v_window_valid   boolean;
  v_current_date   date;
  
  v_step           text;
  v_response       record;
  
  v_steps          jsonb := '[]'::jsonb;
  v_step_result    jsonb;
begin
  -- Determine trade date (default to today)
  v_trade_date := coalesce(p_trade_date, (now() at time zone 'UTC')::date);
  v_signal_date := v_trade_date - interval '1 day';
  v_current_date := (now() at time zone 'UTC')::date;
  v_base_url := format('https://%s.supabase.co/functions/v1/', v_project_ref);
  
  -- Get service key from vault
  select decrypted_secret into v_service_key 
  from vault.decrypted_secrets 
  where name = 'Secret Key';
  
  if v_service_key is null then
    raise exception 'Secret Key not found in vault';
  end if;
  
  --------------------------------------------------------------------
  -- Validation 1: Check if CI bands exist for signal_date
  --------------------------------------------------------------------
  select exists (
    select 1
    from lth_pvr.ci_bands_daily
    where date   = v_signal_date
      and mode   = 'static'
      and org_id = v_org_id
  )
  into v_ci_exists;
  
  if not v_ci_exists then
    return jsonb_build_object(
      'success', false,
      'error', 'CI bands data not available',
      'signal_date', v_signal_date,
      'trade_date', v_trade_date,
      'message', format('CI bands for %s not found. Cannot generate decisions for %s.', 
                       v_signal_date, v_trade_date)
    );
  end if;
  
  --------------------------------------------------------------------
  -- Validation 2: Check trade window expiration
  -- CRITICAL: Trade window expires when current_date > signal_date + 1
  -- This prevents retroactive trading on stale data
  --------------------------------------------------------------------
  v_window_valid := v_current_date <= (v_signal_date + interval '1 day')::date;
  
  if not v_window_valid then
    return jsonb_build_object(
      'success', false,
      'error', 'Trade window expired',
      'signal_date', v_signal_date,
      'trade_date', v_trade_date,
      'current_date', v_current_date,
      'message', format('Trade window for %s (based on %s CI bands) has expired. Current date is %s. Cannot execute stale trades.', 
                       v_trade_date, v_signal_date, v_current_date)
    );
  end if;
  
  --------------------------------------------------------------------
  -- Execute pipeline steps sequentially
  --------------------------------------------------------------------
  
  -- Step 1: Generate Decisions
  v_step := 'ef_generate_decisions';
  begin
    select t.status, t.body
    into v_response
    from net.http_post(
      url := v_base_url || v_step,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object()
    ) as t(status int, headers jsonb, body text);
    
    v_step_result := jsonb_build_object(
      'step', v_step,
      'status', v_response.status,
      'success', v_response.status between 200 and 299,
      'timestamp', now()
    );
    v_steps := v_steps || v_step_result;
    
    if v_response.status not between 200 and 299 then
      return jsonb_build_object(
        'success', false,
        'error', 'Pipeline failed at ' || v_step,
        'steps', v_steps,
        'signal_date', v_signal_date,
        'trade_date', v_trade_date
      );
    end if;
  exception when others then
    v_step_result := jsonb_build_object('step', v_step, 'success', false, 'error', sqlerrm, 'timestamp', now());
    v_steps := v_steps || v_step_result;
    return jsonb_build_object('success', false, 'error', 'Pipeline failed at ' || v_step, 'exception', sqlerrm, 'steps', v_steps);
  end;
  
  perform pg_sleep(2);
  
  -- Step 2: Create Order Intents
  v_step := 'ef_create_order_intents';
  begin
    select t.status, t.body into v_response
    from net.http_post(
      url := v_base_url || v_step,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object()
    ) as t(status int, headers jsonb, body text);
    
    v_step_result := jsonb_build_object('step', v_step, 'status', v_response.status, 'success', v_response.status between 200 and 299, 'timestamp', now());
    v_steps := v_steps || v_step_result;
    
    if v_response.status not between 200 and 299 then
      return jsonb_build_object('success', false, 'error', 'Pipeline failed at ' || v_step, 'steps', v_steps);
    end if;
  exception when others then
    v_step_result := jsonb_build_object('step', v_step, 'success', false, 'error', sqlerrm, 'timestamp', now());
    v_steps := v_steps || v_step_result;
    return jsonb_build_object('success', false, 'error', 'Pipeline failed at ' || v_step, 'exception', sqlerrm, 'steps', v_steps);
  end;
  
  perform pg_sleep(2);
  
  -- Step 3: Execute Orders
  v_step := 'ef_execute_orders';
  begin
    select t.status, t.body into v_response
    from net.http_post(
      url := v_base_url || v_step,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object()
    ) as t(status int, headers jsonb, body text);
    
    v_step_result := jsonb_build_object('step', v_step, 'status', v_response.status, 'success', v_response.status between 200 and 299, 'timestamp', now());
    v_steps := v_steps || v_step_result;
    
    if v_response.status not between 200 and 299 then
      return jsonb_build_object('success', false, 'error', 'Pipeline failed at ' || v_step, 'steps', v_steps);
    end if;
  exception when others then
    v_step_result := jsonb_build_object('step', v_step, 'success', false, 'error', sqlerrm, 'timestamp', now());
    v_steps := v_steps || v_step_result;
    return jsonb_build_object('success', false, 'error', 'Pipeline failed at ' || v_step, 'exception', sqlerrm, 'steps', v_steps);
  end;
  
  perform pg_sleep(2);
  
  -- Step 4: Poll Orders (one-time trigger)
  v_step := 'ef_poll_orders';
  begin
    select t.status, t.body into v_response
    from net.http_post(
      url := v_base_url || v_step,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object()
    ) as t(status int, headers jsonb, body text);
    
    v_step_result := jsonb_build_object('step', v_step, 'status', v_response.status, 'success', v_response.status between 200 and 299, 'timestamp', now());
    v_steps := v_steps || v_step_result;
  exception when others then
    v_step_result := jsonb_build_object('step', v_step, 'success', false, 'error', sqlerrm, 'timestamp', now());
    v_steps := v_steps || v_step_result;
  end;
  
  perform pg_sleep(2);
  
  -- Step 5: Post Ledger and Balances
  v_step := 'ef_post_ledger_and_balances';
  begin
    select t.status, t.body into v_response
    from net.http_post(
      url := v_base_url || v_step,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
      body := jsonb_build_object()
    ) as t(status int, headers jsonb, body text);
    
    v_step_result := jsonb_build_object('step', v_step, 'status', v_response.status, 'success', v_response.status between 200 and 299, 'timestamp', now());
    v_steps := v_steps || v_step_result;
  exception when others then
    v_step_result := jsonb_build_object('step', v_step, 'success', false, 'error', sqlerrm, 'timestamp', now());
    v_steps := v_steps || v_step_result;
  end;
  
  -- Log success
  insert into lth_pvr.alert_events(component, severity, org_id, message, context)
  values ('resume_daily_pipeline', 'info', v_org_id, format('Pipeline resumed successfully for trade_date %s', v_trade_date),
          jsonb_build_object('trade_date', v_trade_date, 'signal_date', v_signal_date, 'steps', v_steps));
  
  return jsonb_build_object(
    'success', true,
    'message', format('Pipeline completed successfully for trade_date %s', v_trade_date),
    'trade_date', v_trade_date,
    'signal_date', v_signal_date,
    'steps', v_steps
  );
  
exception when others then
  insert into lth_pvr.alert_events(component, severity, org_id, message, context)
  values ('resume_daily_pipeline', 'error', v_org_id, 'Pipeline resume failed: ' || sqlerrm,
          jsonb_build_object('trade_date', v_trade_date, 'signal_date', v_signal_date, 'error', sqlerrm, 'steps', v_steps));
  
  return jsonb_build_object('success', false, 'error', sqlerrm, 'trade_date', v_trade_date, 'signal_date', v_signal_date, 'steps', v_steps);
end;
$$;

comment on function lth_pvr.resume_daily_pipeline is 
  'Resumes LTH_PVR daily pipeline after CI bands become available. Validates trade window expiration (current_date <= signal_date + 1) and orchestrates sequential EF execution.';

-- =====================================================================
-- 3. Enhanced guard function with optional auto-resume
-- =====================================================================

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
  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'Secret Key';
  if v_service_key is null then raise exception 'Secret Key not found in vault'; end if;
  
  -- Check if CI bands exist
  select exists (select 1 from lth_pvr.ci_bands_daily where date = v_target_date and mode = v_mode and org_id = v_org) into v_exists;

  if v_exists then
    insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
    values (false, 200, jsonb_build_object('info','row present','target_date', v_target_date));
    
    -- Auto-resume if enabled and within processing window (03:00-08:00 UTC)
    v_in_window := v_current_hour >= 3 and v_current_hour < 8;
    
    if p_auto_resume and v_in_window then
      select lth_pvr.resume_daily_pipeline() into v_resume_result;
      return jsonb_build_object('ci_bands_status', 'already_present', 'target_date', v_target_date, 
                                'auto_resume_triggered', true, 'resume_result', v_resume_result);
    end if;
    
    return jsonb_build_object('ci_bands_status', 'already_present', 'target_date', v_target_date, 'auto_resume_triggered', false);
  end if;

  -- Fetch CI bands
  v_request_id := net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_fetch_ci_bands',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
    body := jsonb_build_object('guard', true, 'org_id', v_org)
  );

  insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
  values (true, 200, jsonb_build_object('request_id', v_request_id, 'target_date', v_target_date, 'auto_resume_pending', p_auto_resume));
  
  return jsonb_build_object('ci_bands_status', 'fetch_triggered', 'target_date', v_target_date, 'request_id', v_request_id,
                            'auto_resume_pending', p_auto_resume, 'note', 'CI bands fetch initiated. Run guard again after fetch completes for auto-resume.');

exception when others then
  insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
  values (true, 599, jsonb_build_object('error', sqlstate, 'msg', sqlerrm, 'target_date', v_target_date));
  return jsonb_build_object('ci_bands_status', 'error', 'target_date', v_target_date, 'error', sqlerrm);
end;
$$;

comment on function lth_pvr.ensure_ci_bands_today_with_resume is 
  'Enhanced guard function with optional auto-resume capability. Set p_auto_resume=true to automatically trigger pipeline when CI bands become available within processing window (03:00-08:00 UTC).';
