-- Migration: Consolidate Customer 999 Data from Old Org to New Org
-- Date: 2026-02-13
-- Purpose: Fix balance discrepancy caused by org_id split
-- Bug: Customer 999 has data split across two org_ids, causing incorrect balance reporting

-- OLD org_id: 95fdc8ca-ed20-4896-bb31-f4c6fbcced49 (historical data)
-- NEW org_id: b0a77009-03b9-44a1-ae1d-34f157d44a8b (current/active)

DO $$
DECLARE
  old_org_id UUID := '95fdc8ca-ed20-4896-bb31-f4c6fbcced49';
  new_org_id UUID := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  cust_id BIGINT := 999;
  rows_updated INT;
BEGIN
  RAISE NOTICE 'Starting org_id consolidation for customer %', cust_id;
  
  -- 1. Update exchange_funding_events
  UPDATE lth_pvr.exchange_funding_events
  SET org_id = new_org_id
  WHERE customer_id = cust_id AND org_id = old_org_id;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✓ Updated % exchange_funding_events records', rows_updated;
  
  -- 2. Update ledger_lines
  UPDATE lth_pvr.ledger_lines
  SET org_id = new_org_id
  WHERE customer_id = cust_id AND org_id = old_org_id;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✓ Updated % ledger_lines records', rows_updated;
  
  -- 3. Update balances_daily
  UPDATE lth_pvr.balances_daily
  SET org_id = new_org_id
  WHERE customer_id = cust_id AND org_id = old_org_id;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✓ Updated % balances_daily records', rows_updated;
  
  -- 4. Update customer_state_daily (if exists)
  UPDATE lth_pvr.customer_state_daily
  SET org_id = new_org_id
  WHERE customer_id = cust_id AND org_id = old_org_id;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✓ Updated % customer_state_daily records', rows_updated;
  
  -- 5. Update order_intents (if any)
  UPDATE lth_pvr.order_intents
  SET org_id = new_org_id
  WHERE customer_id = cust_id AND org_id = old_org_id;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✓ Updated % order_intents records', rows_updated;
  
  -- 6. Update exchange_orders via join (no direct customer_id column)
  UPDATE lth_pvr.exchange_orders eo
  SET org_id = new_org_id
  FROM lth_pvr.order_intents oi
  WHERE eo.intent_id = oi.intent_id 
    AND oi.customer_id = cust_id 
    AND eo.org_id = old_org_id;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✓ Updated % exchange_orders records', rows_updated;
  
  -- 7. Update order_fills via join (no direct customer_id column)
  UPDATE lth_pvr.order_fills of
  SET org_id = new_org_id
  FROM lth_pvr.exchange_orders eo
  JOIN lth_pvr.order_intents oi ON eo.intent_id = oi.intent_id
  WHERE of.exchange_order_id = eo.exchange_order_id
    AND oi.customer_id = cust_id
    AND of.org_id = old_org_id;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✓ Updated % order_fills records', rows_updated;
  
  -- 8. Update alert_events
  UPDATE lth_pvr.alert_events
  SET org_id = new_org_id
  WHERE customer_id = cust_id AND org_id = old_org_id;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE '✓ Updated % alert_events records', rows_updated;
  
  RAISE NOTICE 'Org consolidation complete!';
  RAISE NOTICE 'Next step: Run ef_post_ledger_and_balances to recalculate balances';
END $$;

-- Verify consolidation
SELECT 
  org_id,
  COUNT(*) as record_count,
  SUM(amount::numeric) FILTER (WHERE kind IN ('deposit', 'zar_deposit')) as total_deposits,
  SUM(amount::numeric) FILTER (WHERE kind IN ('withdrawal', 'zar_withdrawal')) as total_withdrawals
FROM lth_pvr.exchange_funding_events
WHERE customer_id = 999
GROUP BY org_id;
