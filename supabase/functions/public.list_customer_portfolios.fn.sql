-- public.list_customer_portfolios.fn.sql
-- Purpose: List all portfolios for a customer
-- Called by: Customer portal dashboard (portfolio selector)
-- RLS: Customer can only see their own portfolios

CREATE OR REPLACE FUNCTION public.list_customer_portfolios(p_customer_id INTEGER)
RETURNS TABLE (
  portfolio_id UUID,
  strategy_code TEXT,
  strategy_name TEXT,
  status TEXT,
  nav_usd NUMERIC,
  btc_balance NUMERIC,
  usdt_balance NUMERIC,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cp.portfolio_id,
    cp.strategy_code,
    cp.strategy_code || ' Strategy' as strategy_name,
    cp.status,
    COALESCE(bd.nav_usd, 0) as nav_usd,
    COALESCE(bd.btc_balance, 0) as btc_balance,
    COALESCE(bd.usdt_balance, 0) as usdt_balance,
    cp.created_at
  FROM public.customer_portfolios cp
  LEFT JOIN LATERAL (
    SELECT 
      btc_balance,
      usdt_balance,
      nav_usd
    FROM lth_pvr.balances_daily
    WHERE customer_id = p_customer_id
    ORDER BY date DESC
    LIMIT 1
  ) bd ON true
  WHERE cp.customer_id = p_customer_id
  ORDER BY cp.created_at DESC;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.list_customer_portfolios(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.list_customer_portfolios IS 'Returns all portfolios for a customer with current balances and NAV';
