-- Resume LTH_PVR daily pipeline after CI bands data becomes available
-- This function orchestrates the sequential execution of pipeline edge functions
-- with trade window expiration validation

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
  v_request_id     bigint;
  v_response       record;
  
  v_result         jsonb := jsonb_build_object(
    'success', false,
    'steps', jsonb_build_array()
  );
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
  -- Trade window expires when current_date > signal_date + 1
  --------------------------------------------------------------------
  v_window_valid := v_current_date <= (v_signal_date + interval '1 day')::date;
  
  if not v_window_valid then
    return jsonb_build_object(
      'success', false,
      'error', 'Trade window expired',
      'signal_date', v_signal_date,
      'trade_date', v_trade_date,
      'current_date', v_current_date,
      'message', format('Trade window for %s (based on %s CI bands) has expired. Current date is %s.', 
                       v_trade_date, v_signal_date, v_current_date)
    );
  end if;
  
  --------------------------------------------------------------------
  -- Step 1: Generate Decisions
  --------------------------------------------------------------------
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
    ) as t;
    
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
    v_step_result := jsonb_build_object(
      'step', v_step,
      'success', false,
      'error', sqlerrm,
      'timestamp', now()
    );
    v_steps := v_steps || v_step_result;
    
    return jsonb_build_object(
      'success', false,
      'error', 'Pipeline failed at ' || v_step,
      'exception', sqlerrm,
      'steps', v_steps,
      'signal_date', v_signal_date,
      'trade_date', v_trade_date
    );
  end;
  
  -- Small delay between steps
  perform pg_sleep(2);
  
  --------------------------------------------------------------------
  -- Step 2: Create Order Intents
  --------------------------------------------------------------------
  v_step := 'ef_create_order_intents';
  
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
    ) as t;
    
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
    v_step_result := jsonb_build_object(
      'step', v_step,
      'success', false,
      'error', sqlerrm,
      'timestamp', now()
    );
    v_steps := v_steps || v_step_result;
    
    return jsonb_build_object(
      'success', false,
      'error', 'Pipeline failed at ' || v_step,
      'exception', sqlerrm,
      'steps', v_steps,
      'signal_date', v_signal_date,
      'trade_date', v_trade_date
    );
  end;
  
  -- Small delay between steps
  perform pg_sleep(2);
  
  --------------------------------------------------------------------
  -- Step 3: Execute Orders
  --------------------------------------------------------------------
  v_step := 'ef_execute_orders';
  
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
    ) as t;
    
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
    v_step_result := jsonb_build_object(
      'step', v_step,
      'success', false,
      'error', sqlerrm,
      'timestamp', now()
    );
    v_steps := v_steps || v_step_result;
    
    return jsonb_build_object(
      'success', false,
      'error', 'Pipeline failed at ' || v_step,
      'exception', sqlerrm,
      'steps', v_steps,
      'signal_date', v_signal_date,
      'trade_date', v_trade_date
    );
  end;
  
  -- Small delay between steps
  perform pg_sleep(2);
  
  --------------------------------------------------------------------
  -- Step 4: Poll Orders (one-time trigger)
  --------------------------------------------------------------------
  v_step := 'ef_poll_orders';
  
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
    ) as t;
    
    v_step_result := jsonb_build_object(
      'step', v_step,
      'status', v_response.status,
      'success', v_response.status between 200 and 299,
      'timestamp', now()
    );
    
    v_steps := v_steps || v_step_result;
    
    -- Note: poll_orders may return non-200 if no orders to poll, which is acceptable
    
  exception when others then
    v_step_result := jsonb_build_object(
      'step', v_step,
      'success', false,
      'error', sqlerrm,
      'timestamp', now()
    );
    v_steps := v_steps || v_step_result;
    -- Continue even if poll fails - cron will handle it
  end;
  
  -- Small delay between steps
  perform pg_sleep(2);
  
  --------------------------------------------------------------------
  -- Step 5: Post Ledger and Balances (optional, may run later)
  --------------------------------------------------------------------
  v_step := 'ef_post_ledger_and_balances';
  
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
    ) as t;
    
    v_step_result := jsonb_build_object(
      'step', v_step,
      'status', v_response.status,
      'success', v_response.status between 200 and 299,
      'timestamp', now()
    );
    
    v_steps := v_steps || v_step_result;
    
  exception when others then
    v_step_result := jsonb_build_object(
      'step', v_step,
      'success', false,
      'error', sqlerrm,
      'timestamp', now()
    );
    v_steps := v_steps || v_step_result;
    -- Continue even if this fails - can be run later
  end;
  
  --------------------------------------------------------------------
  -- Log success alert
  --------------------------------------------------------------------
  insert into lth_pvr.alert_events(
    component,
    severity,
    org_id,
    message,
    context
  )
  values (
    'resume_daily_pipeline',
    'info',
    v_org_id,
    format('Pipeline resumed successfully for trade_date %s', v_trade_date),
    jsonb_build_object(
      'trade_date', v_trade_date,
      'signal_date', v_signal_date,
      'steps', v_steps
    )
  );
  
  return jsonb_build_object(
    'success', true,
    'message', format('Pipeline completed successfully for trade_date %s', v_trade_date),
    'trade_date', v_trade_date,
    'signal_date', v_signal_date,
    'steps', v_steps
  );
  
exception
  when others then
    -- Log error alert
    insert into lth_pvr.alert_events(
      component,
      severity,
      org_id,
      message,
      context
    )
    values (
      'resume_daily_pipeline',
      'error',
      v_org_id,
      'Pipeline resume failed: ' || sqlerrm,
      jsonb_build_object(
        'trade_date', v_trade_date,
        'signal_date', v_signal_date,
        'error', sqlerrm,
        'steps', v_steps
      )
    );
    
    return jsonb_build_object(
      'success', false,
      'error', sqlerrm,
      'trade_date', v_trade_date,
      'signal_date', v_signal_date,
      'steps', v_steps
    );
end;
$$;

comment on function lth_pvr.resume_daily_pipeline is 
  'Resumes LTH_PVR daily pipeline after CI bands become available. Validates trade window expiration and orchestrates sequential EF execution.';
