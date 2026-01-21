-- Migration: Update RPC functions to query public.customer_strategies instead of customer_portfolios
-- Date: 2026-01-21
-- Purpose: Complete Phase 5 of table consolidation - update RPC functions and UI components

-- =============================================================================
-- 1. Update list_customer_portfolios() - No parameters version (for org context)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_customer_portfolios()
 RETURNS TABLE(portfolio_id uuid, org_id uuid, customer_id bigint, strategy_code text, label text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    cs.portfolio_id,        -- backwards compatibility column
    cs.org_id,
    cs.customer_id,
    cs.strategy_code,
    cs.label
  from public.customer_strategies cs
  join public.customer_details cd
    on cd.customer_id = cs.customer_id
  where cs.org_id in (select id from public.my_orgs())
    and cs.status = 'active'
$function$;

COMMENT ON FUNCTION public.list_customer_portfolios() IS 'Lists active customer strategies (portfolios) for organizations the current user belongs to. Updated 2026-01-21 to query consolidated customer_strategies table.';


-- =============================================================================
-- 2. Update list_customer_portfolios(p_customer_id) - Customer portal version
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_customer_portfolios(p_customer_id bigint)
 RETURNS TABLE(
   portfolio_id uuid, 
   strategy_code text, 
   strategy_name text, 
   status text, 
   nav_usd numeric, 
   btc_balance numeric, 
   usdt_balance numeric, 
   btc_price numeric, 
   total_contributions numeric, 
   has_trading_history boolean, 
   created_at timestamp with time zone
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    cs.portfolio_id,        -- backwards compatibility column
    cs.strategy_code,
    (cs.strategy_code || ' Strategy')::TEXT as strategy_name,
    cs.status,
    COALESCE(latest_balance.nav_usd, 0) as nav_usd,
    COALESCE(latest_balance.btc_balance, 0) as btc_balance,
    COALESCE(latest_balance.usdt_balance, 0) as usdt_balance,
    COALESCE(latest_price.btc_price, 0) as btc_price,
    COALESCE(contrib.total, 0) as total_contributions,
    EXISTS(
      SELECT 1 
      FROM lth_pvr.decisions_daily dd
      WHERE dd.customer_id = p_customer_id
      LIMIT 1
    ) as has_trading_history,
    cs.created_at
  FROM public.customer_strategies cs
  LEFT JOIN LATERAL (
    SELECT 
      bd.btc_balance,
      bd.usdt_balance,
      bd.nav_usd
    FROM lth_pvr.balances_daily bd
    WHERE bd.customer_id = p_customer_id
    ORDER BY bd.date DESC
    LIMIT 1
  ) latest_balance ON true
  LEFT JOIN LATERAL (
    SELECT 
      cb.btc_price
    FROM lth_pvr.ci_bands_daily cb
    ORDER BY cb.date DESC
    LIMIT 1
  ) latest_price ON true
  LEFT JOIN LATERAL (
    SELECT 
      SUM(amount_usdt) as total
    FROM lth_pvr.ledger_lines
    WHERE customer_id = p_customer_id
    AND kind = 'deposit'
  ) contrib ON true
  WHERE cs.customer_id = p_customer_id
  ORDER BY cs.created_at DESC;
END;
$function$;

COMMENT ON FUNCTION public.list_customer_portfolios(bigint) IS 'Lists all portfolios (strategies) for a specific customer with balance and trading history. Used by customer portal. Updated 2026-01-21 to query consolidated customer_strategies table.';


-- =============================================================================
-- 3. Update get_customer_dashboard(p_portfolio_id) - Dashboard stats
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_customer_dashboard(p_portfolio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_result JSONB;
  v_latest_balance RECORD;
  v_total_contributions NUMERIC;
  v_customer_id INTEGER;
  v_roi_pct NUMERIC;
  v_cagr_pct NUMERIC;
BEGIN
  -- Lookup customer_id from consolidated table
  SELECT customer_id INTO v_customer_id
  FROM public.customer_strategies
  WHERE portfolio_id = p_portfolio_id;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Portfolio not found');
  END IF;

  -- Get latest balance (balances_daily uses customer_id, not portfolio_id)
  SELECT btc_balance, usdt_balance, nav_usd, date
  INTO v_latest_balance
  FROM lth_pvr.balances_daily
  WHERE customer_id = v_customer_id
  ORDER BY date DESC
  LIMIT 1;

  -- Calculate total contributions from ledger
  SELECT COALESCE(SUM(usdt_delta), 0) INTO v_total_contributions
  FROM lth_pvr.ledger_lines
  WHERE portfolio_id = p_portfolio_id AND event_type = 'deposit';

  -- Calculate ROI% if we have data
  IF v_latest_balance.nav_usd IS NOT NULL AND v_total_contributions > 0 THEN
    v_roi_pct := ((v_latest_balance.nav_usd - v_total_contributions) / v_total_contributions) * 100;
  ELSE
    v_roi_pct := 0;
  END IF;

  -- CAGR calculation would require first balance date - simplified for now
  v_cagr_pct := 0;

  v_result := jsonb_build_object(
    'portfolio_id', p_portfolio_id,
    'customer_id', v_customer_id,
    'btc_balance', COALESCE(v_latest_balance.btc_balance, 0),
    'usdt_balance', COALESCE(v_latest_balance.usdt_balance, 0),
    'nav_usd', COALESCE(v_latest_balance.nav_usd, 0),
    'roi_pct', ROUND(v_roi_pct, 2),
    'cagr_pct', ROUND(v_cagr_pct, 2),
    'total_contributions', v_total_contributions,
    'last_updated', COALESCE(v_latest_balance.date, CURRENT_DATE)
  );

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_customer_dashboard(uuid) IS 'Returns dashboard statistics for a customer portfolio including balances, ROI, and contributions. Updated 2026-01-21 to query consolidated customer_strategies table.';


-- =============================================================================
-- 4. Verification: Check functions updated correctly
-- =============================================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Verify list_customer_portfolios() no-param version references customer_strategies
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  WHERE p.proname = 'list_customer_portfolios'
    AND p.pronargs = 0
    AND pg_get_functiondef(p.oid) LIKE '%public.customer_strategies%';
  
  IF v_count = 0 THEN
    RAISE WARNING 'list_customer_portfolios() may not be updated correctly';
  ELSE
    RAISE NOTICE '✓ list_customer_portfolios() updated to use customer_strategies';
  END IF;

  -- Verify list_customer_portfolios(bigint) version references customer_strategies
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  WHERE p.proname = 'list_customer_portfolios'
    AND p.pronargs = 1
    AND pg_get_functiondef(p.oid) LIKE '%public.customer_strategies%';
  
  IF v_count = 0 THEN
    RAISE WARNING 'list_customer_portfolios(bigint) may not be updated correctly';
  ELSE
    RAISE NOTICE '✓ list_customer_portfolios(bigint) updated to use customer_strategies';
  END IF;

  -- Verify get_customer_dashboard references customer_strategies
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  WHERE p.proname = 'get_customer_dashboard'
    AND pg_get_functiondef(p.oid) LIKE '%public.customer_strategies%';
  
  IF v_count = 0 THEN
    RAISE WARNING 'get_customer_dashboard may not be updated correctly';
  ELSE
    RAISE NOTICE '✓ get_customer_dashboard updated to use customer_strategies';
  END IF;
END $$;
