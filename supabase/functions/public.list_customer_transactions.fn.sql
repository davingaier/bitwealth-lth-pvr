-- public.list_customer_transactions.fn.sql
-- Purpose: List customer transaction history
-- Called by: Customer portal transactions tab
-- RLS: Customer can only see their own transactions

CREATE OR REPLACE FUNCTION public.list_customer_transactions(
  p_portfolio_id UUID,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS TABLE (
  event_date DATE,
  event_type TEXT,
  btc_delta NUMERIC,
  usdt_delta NUMERIC,
  fee_btc NUMERIC,
  fee_usdt NUMERIC,
  note TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_from_date DATE;
  v_to_date DATE;
BEGIN
  -- Default date range: last 90 days
  v_from_date := COALESCE(p_from_date, CURRENT_DATE - INTERVAL '90 days');
  v_to_date := COALESCE(p_to_date, CURRENT_DATE);

  RETURN QUERY
  SELECT 
    ll.event_date,
    ll.event_type,
    ll.btc_delta,
    ll.usdt_delta,
    ll.fee_btc,
    ll.fee_usdt,
    ll.note
  FROM lth_pvr.ledger_lines ll
  WHERE ll.portfolio_id = p_portfolio_id
    AND ll.event_date BETWEEN v_from_date AND v_to_date
  ORDER BY ll.event_date DESC, ll.created_at DESC;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.list_customer_transactions(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.list_customer_transactions IS 'Returns customer transaction history with optional date range filter (defaults to last 90 days)';
