-- public.list_customer_transactions.fn.sql
-- Purpose: List customer transaction history
-- Called by: Customer portal transactions tab
-- RLS: Customer can only see their own transactions
-- Updated: 2026-01-05 - Fixed to use customer_id and actual column names

CREATE OR REPLACE FUNCTION public.list_customer_transactions(
  p_customer_id BIGINT,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  trade_date DATE,
  kind TEXT,
  amount_btc NUMERIC,
  amount_usdt NUMERIC,
  fee_btc NUMERIC,
  fee_usdt NUMERIC,
  platform_fee_btc NUMERIC,
  platform_fee_usdt NUMERIC,
  note TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return transaction history from ledger_lines
  -- Sorted by date descending (most recent first)
  RETURN QUERY
  SELECT 
    ll.trade_date,
    ll.kind,
    ll.amount_btc,
    ll.amount_usdt,
    ll.fee_btc,
    ll.fee_usdt,
    ll.platform_fee_btc,
    ll.platform_fee_usdt,
    ll.note,
    ll.created_at
  FROM lth_pvr.ledger_lines ll
  WHERE ll.customer_id = p_customer_id
  ORDER BY ll.trade_date DESC, ll.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute to authenticated users (and anon for portal access)
GRANT EXECUTE ON FUNCTION public.list_customer_transactions(BIGINT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_customer_transactions(BIGINT, INT) TO anon;

COMMENT ON FUNCTION public.list_customer_transactions IS 'Returns customer transaction history with platform fees from lth_pvr.ledger_lines. Used by customer portal. Updated 2026-01-23 to include platform_fee_btc and platform_fee_usdt columns.';
