-- Migration: Update admin view to show partial conversions
-- Date: 2026-02-12
-- Purpose: Show partially converted ZAR deposits in admin UI, not just unconverted ones
-- Bug Fix: #5 - Admin UI View Filter

-- Replace the view to include partial conversions
CREATE OR REPLACE VIEW lth_pvr.v_pending_zar_conversions AS
SELECT 
  pzc.id,
  pzc.org_id,
  pzc.customer_id,
  cd.first_names,
  cd.last_name,
  cd.email,
  pzc.zar_amount AS original_zar_amount,
  COALESCE(pzc.converted_amount, 0) AS converted_amount,
  COALESCE(pzc.remaining_amount, pzc.zar_amount) AS remaining_amount,
  pzc.occurred_at,
  EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - pzc.occurred_at)) / 3600 AS hours_pending,
  bd.balance AS current_usdt_balance,
  pzc.funding_id,
  pzc.converted_at,
  pzc.conversion_funding_id,
  pzc.notes,
  -- Add status indicator for UI
  CASE 
    WHEN pzc.converted_at IS NOT NULL THEN 'completed'
    WHEN COALESCE(pzc.remaining_amount, pzc.zar_amount) <= 0.01 THEN 'completed'
    WHEN pzc.converted_amount > 0 THEN 'partial'
    ELSE 'pending'
  END AS conversion_status
FROM lth_pvr.pending_zar_conversions pzc
JOIN public.customer_details cd USING (customer_id)
LEFT JOIN LATERAL (
  SELECT balance 
  FROM lth_pvr.balances_daily 
  WHERE portfolio_id IN (
    SELECT portfolio_id 
    FROM public.customer_portfolios 
    WHERE customer_id = pzc.customer_id 
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  )
  AND asset = 'USDT'
  ORDER BY date DESC 
  LIMIT 1
) bd ON true
WHERE (
  -- Show unconverted OR partially converted (with more than 0.01 ZAR remaining)
  pzc.converted_at IS NULL 
  OR COALESCE(pzc.remaining_amount, pzc.zar_amount) > 0.01
)
ORDER BY pzc.occurred_at;

COMMENT ON VIEW lth_pvr.v_pending_zar_conversions IS 
'Admin dashboard view showing pending and partially converted ZAR deposits. Includes conversion_status to distinguish between pending/partial/completed states.';
