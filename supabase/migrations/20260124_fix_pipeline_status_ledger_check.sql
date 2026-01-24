-- Migration: Fix pipeline status to only mark "Ledger Posted" complete for trading activity
-- Date: 2026-01-24
-- Purpose: Critical bug fix - Ledger Posted should only be true when buy/sell entries exist
--          Previously marked complete for any ledger_lines entries (including fee-related)
--          Caused false positives when testing fee accumulation without actual trading

-- Drop existing function
DROP FUNCTION IF EXISTS lth_pvr.get_pipeline_status(date);

-- Recreate with fix
CREATE OR REPLACE FUNCTION lth_pvr.get_pipeline_status(
  p_trade_date date default null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
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
BEGIN
  -- Determine dates
  v_trade_date := coalesce(p_trade_date, (now() at time zone 'UTC')::date);
  v_signal_date := v_trade_date - interval '1 day';
  v_current_date := (now() at time zone 'UTC')::date;
  v_window_closes := (v_trade_date + interval '1 day')::timestamp;
  
  -- Check CI bands existence
  SELECT EXISTS (
    SELECT 1
    FROM lth_pvr.ci_bands_daily
    WHERE date = v_signal_date
      AND mode = 'static'
      AND org_id = v_org_id
  )
  INTO v_ci_exists;
  
  -- Check trade window validity
  v_window_valid := v_current_date <= (v_signal_date + interval '1 day')::date;
  
  -- Check completed steps
  SELECT EXISTS (
    SELECT 1
    FROM lth_pvr.decisions_daily
    WHERE trade_date = v_trade_date
      AND org_id = v_org_id
  )
  INTO v_decisions_done;
  
  SELECT EXISTS (
    SELECT 1
    FROM lth_pvr.order_intents
    WHERE trade_date = v_trade_date
      AND org_id = v_org_id
  )
  INTO v_intents_done;
  
  SELECT EXISTS (
    SELECT 1
    FROM lth_pvr.exchange_orders
    WHERE created_at::date = v_trade_date
      AND org_id = v_org_id
  )
  INTO v_orders_done;
  
  -- FIX: Only count buy/sell ledger entries, not fee-related entries
  SELECT EXISTS (
    SELECT 1
    FROM lth_pvr.ledger_lines
    WHERE line_date = v_trade_date
      AND org_id = v_org_id
      AND kind IN ('buy', 'sell')  -- Only count actual trading activity
  )
  INTO v_ledger_done;
  
  -- Determine if pipeline can be resumed
  v_can_resume := v_ci_exists AND v_window_valid AND NOT v_ledger_done;
  
  IF NOT v_ci_exists THEN
    v_resume_reason := format('CI bands for %s not yet available', v_signal_date);
  ELSIF NOT v_window_valid THEN
    v_resume_reason := format('Trade window expired (current date: %s, window closed: %s)', 
                              v_current_date, v_window_closes);
  ELSIF v_ledger_done THEN
    v_resume_reason := 'Pipeline fully complete (ledger posted)';
  ELSE
    v_resume_reason := 'Pipeline ready to resume';
  END IF;
  
  RETURN jsonb_build_object(
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
END;
$$;

COMMENT ON FUNCTION lth_pvr.get_pipeline_status IS 
  'Returns pipeline execution status for a trade date, including CI bands availability and trade window validity. ledger_posted only returns true when buy/sell ledger entries exist (excludes fee-related entries like deposits, withdrawals, platform fees, performance fees, etc.).';
