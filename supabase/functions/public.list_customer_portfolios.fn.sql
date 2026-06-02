-- public.list_customer_portfolios.fn.sql
-- Purpose: List all portfolios for a customer with current balances and NAV
-- Called by: Customer portal dashboard (portfolio selector / tiles)
-- RLS: SECURITY DEFINER; customer scoping enforced by caller via p_customer_id
-- NOTE: canonical signature is (bigint). Do NOT add an (integer) overload —
--       it creates PostgREST candidate ambiguity for the portal RPC call.

DROP FUNCTION IF EXISTS public.list_customer_portfolios(integer);

CREATE OR REPLACE FUNCTION public.list_customer_portfolios(p_customer_id bigint)
RETURNS TABLE (
  portfolio_id UUID,
  strategy_code TEXT,
  strategy_name TEXT,
  status TEXT,
  nav_usd NUMERIC,
  btc_balance NUMERIC,
  usdt_balance NUMERIC,
  usdpc_balance NUMERIC,
  usdpc_price_usd NUMERIC,
  usdpc_value_usd NUMERIC,
  btc_price NUMERIC,
  total_contributions NUMERIC,
  has_trading_history BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.portfolio_id,
    cs.strategy_code,
    (cs.strategy_code || ' Strategy')::text as strategy_name,
    cs.status,
    coalesce(latest_balance.nav_usd, 0) as nav_usd,
    coalesce(latest_balance.btc_balance, 0) as btc_balance,
    coalesce(latest_balance.usdt_balance, 0) as usdt_balance,
    coalesce(latest_balance.usdpc_balance, 0) as usdpc_balance,
    latest_balance.usdpc_price_usd as usdpc_price_usd,
    (coalesce(latest_balance.usdpc_balance, 0) * coalesce(latest_balance.usdpc_price_usd, 1)) as usdpc_value_usd,
    coalesce(latest_price.btc_price, 0) as btc_price,
    -- Net USDT contributions: topups MINUS withdrawals. ZAR and BTC flows are
    -- excluded so the figure stays USD-denominated and comparable to NAV.
    coalesce(contrib.net_usdt, 0) as total_contributions,
    exists(
      select 1 from lth_pvr.decisions_daily dd
      where dd.customer_id = p_customer_id limit 1
    ) as has_trading_history,
    cs.created_at
  FROM public.customer_strategies cs
  LEFT JOIN LATERAL (
    SELECT bd.btc_balance, bd.usdt_balance, bd.usdpc_balance, bd.usdpc_price_usd, bd.nav_usd
    FROM lth_pvr.balances_daily bd
    WHERE bd.customer_id = p_customer_id AND bd.date <= current_date
    ORDER BY bd.date DESC LIMIT 1
  ) latest_balance ON true
  LEFT JOIN LATERAL (
    SELECT cb.btc_price
    FROM lth_pvr.ci_bands_daily cb
    WHERE cb.date <= current_date
    ORDER BY cb.date DESC LIMIT 1
  ) latest_price ON true
  LEFT JOIN LATERAL (
    SELECT
      coalesce(sum(case when kind = 'topup'      then amount_usdt else 0 end), 0)
      + coalesce(sum(case when kind = 'withdrawal' then amount_usdt else 0 end), 0) as net_usdt
    FROM lth_pvr.ledger_lines
    WHERE customer_id = p_customer_id
  ) contrib ON true
  WHERE cs.customer_id = p_customer_id
  ORDER BY cs.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_customer_portfolios(bigint) TO authenticated, anon;

COMMENT ON FUNCTION public.list_customer_portfolios(bigint) IS 'Returns all portfolios for a customer with current balances, NAV, USDPC yield holdings, and contribution totals';
