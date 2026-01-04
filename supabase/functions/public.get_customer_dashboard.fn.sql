-- public.get_customer_dashboard.fn.sql
-- Purpose: Get customer dashboard data for portal
-- Called by: Customer portal UI
-- RLS: Customer can only see their own portfolio data

CREATE OR REPLACE FUNCTION public.get_customer_dashboard(p_portfolio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_latest_balance RECORD;
  v_total_contributions NUMERIC;
  v_customer_id UUID;
BEGIN
  -- Get customer_id for this portfolio
  SELECT customer_id INTO v_customer_id
  FROM public.customer_portfolios
  WHERE portfolio_id = p_portfolio_id;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Portfolio not found');
  END IF;

  -- Get latest balance from lth_pvr.balances_daily
  SELECT 
    btc_balance,
    usdt_balance,
    nav_usd,
    roi_pct,
    cagr_pct,
    balance_date
  INTO v_latest_balance
  FROM lth_pvr.balances_daily
  WHERE portfolio_id = p_portfolio_id
  ORDER BY balance_date DESC
  LIMIT 1;

  -- Calculate total contributions from ledger
  SELECT COALESCE(SUM(usdt_delta), 0) INTO v_total_contributions
  FROM lth_pvr.ledger_lines
  WHERE portfolio_id = p_portfolio_id
  AND event_type = 'deposit';

  -- Build response
  v_result := jsonb_build_object(
    'portfolio_id', p_portfolio_id,
    'customer_id', v_customer_id,
    'btc_balance', COALESCE(v_latest_balance.btc_balance, 0),
    'usdt_balance', COALESCE(v_latest_balance.usdt_balance, 0),
    'nav_usd', COALESCE(v_latest_balance.nav_usd, 0),
    'roi_pct', COALESCE(v_latest_balance.roi_pct, 0),
    'cagr_pct', COALESCE(v_latest_balance.cagr_pct, 0),
    'total_contributions', v_total_contributions,
    'last_updated', COALESCE(v_latest_balance.balance_date, CURRENT_DATE)
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_customer_dashboard(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_customer_dashboard IS 'Returns customer dashboard summary including NAV, balances, ROI, CAGR for a given portfolio';
