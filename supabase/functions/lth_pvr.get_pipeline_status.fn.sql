-- Helper function to check pipeline status for a given trade date
-- Returns information about completed steps and what remains

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
  v_window_closes := (v_trade_date)::timestamp; -- Trade window closes at midnight on trade date
  
  -- Check CI bands existence
  select exists (
    select 1
    from lth_pvr.ci_bands_daily
    where date = v_signal_date
      and mode = 'static'
      and org_id = v_org_id
  )
  into v_ci_exists;
  
  -- Check trade window validity
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
  -- Pipeline is fully complete only if ledger is posted
  -- Can resume if: CI bands exist, window valid, and ledger NOT done
  v_can_resume := v_ci_exists and v_window_valid and not v_ledger_done;
  
  if not v_ci_exists then
    v_resume_reason := format('CI bands for %s not yet available', v_signal_date);
  elsif not v_window_valid then
    v_resume_reason := format('Trade window expired (current date: %s, window closed: %s)', 
                              v_current_date, v_window_closes);
  elsif v_ledger_done then
    v_resume_reason := 'Pipeline fully complete (ledger posted)';
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
