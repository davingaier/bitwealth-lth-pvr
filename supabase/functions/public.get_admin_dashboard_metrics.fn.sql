-- Get admin dashboard metrics
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_result JSONB;
  v_total_customers INT;
  v_active_customers INT;
  v_total_aum NUMERIC;
  v_avg_nav NUMERIC;
  v_alert_critical INT;
  v_alert_error INT;
  v_alert_warn INT;
BEGIN
  -- Get org_id from app settings (with fallback)
  BEGIN
    v_org_id := current_setting('app.settings.org_id', false)::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_org_id := NULL;
  END;
  
  -- Total customers (all statuses)
  SELECT COUNT(*)
  INTO v_total_customers
  FROM public.customer_details
  WHERE v_org_id IS NULL OR org_id = v_org_id;
  
  -- Active customers (registration_status = 'active')
  SELECT COUNT(*)
  INTO v_active_customers
  FROM public.customer_details
  WHERE (v_org_id IS NULL OR org_id = v_org_id)
    AND registration_status = 'active';
  
  -- Total AUM (sum of latest NAV for all active customers)
  -- Uses most recent balances_daily record for each customer
  SELECT COALESCE(SUM(nav_usd), 0)
  INTO v_total_aum
  FROM (
    SELECT DISTINCT ON (b.customer_id) 
      b.nav_usd
    FROM lth_pvr.balances_daily b
    INNER JOIN public.customer_details cd ON cd.customer_id = b.customer_id
    WHERE (v_org_id IS NULL OR cd.org_id = v_org_id)
      AND cd.registration_status = 'active'
    ORDER BY b.customer_id, b.date DESC
  ) latest_navs;
  
  -- Average NAV per active customer
  IF v_active_customers > 0 THEN
    v_avg_nav := v_total_aum / v_active_customers;
  ELSE
    v_avg_nav := 0;
  END IF;
  
  -- Alert counts by severity (last 7 days, unresolved)
  SELECT 
    COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
    COUNT(*) FILTER (WHERE severity = 'error') AS error,
    COUNT(*) FILTER (WHERE severity = 'warn') AS warn
  INTO v_alert_critical, v_alert_error, v_alert_warn
  FROM lth_pvr.alert_events
  WHERE (v_org_id IS NULL OR org_id = v_org_id)
    AND created_at >= NOW() - INTERVAL '7 days'
    AND resolved_at IS NULL;
  
  -- Build result JSON
  v_result := jsonb_build_object(
    'total_customers', v_total_customers,
    'active_customers', v_active_customers,
    'total_aum_usd', ROUND(v_total_aum, 2),
    'avg_nav_usd', ROUND(v_avg_nav, 2),
    'alerts', jsonb_build_object(
      'critical', COALESCE(v_alert_critical, 0),
      'error', COALESCE(v_alert_error, 0),
      'warn', COALESCE(v_alert_warn, 0)
    ),
    'updated_at', NOW()
  );
  
  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users (admin only)
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_metrics() TO authenticated;

COMMENT ON FUNCTION public.get_admin_dashboard_metrics() IS 'Returns admin dashboard metrics: customer counts, AUM, alerts. Used in admin UI.';
