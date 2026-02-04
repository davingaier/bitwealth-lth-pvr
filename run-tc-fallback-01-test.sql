-- TC-FALLBACK-01 Re-test: 20% BUY order at $60,000 for customer 47
-- Date: 2026-02-04
-- Objective: Verify 5-minute timeout MARKET fallback

-- STEP 1: Check current balance
SELECT 
  'Current Balance' as step,
  date, 
  btc_balance, 
  usdt_balance, 
  nav_usd,
  (usdt_balance * 0.20) as order_amount_20pct
FROM lth_pvr.balances_daily
WHERE customer_id = 47 
  AND date = CURRENT_DATE;

-- STEP 2: Insert BUY decision (20% of balance)
INSERT INTO lth_pvr.decisions_daily (
  org_id, 
  customer_id, 
  signal_date, 
  trade_date, 
  price_usd,
  band_bucket, 
  action, 
  amount_pct, 
  rule, 
  note, 
  strategy_version_id
) VALUES (
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 
  47,
  '2026-02-03'::date,  -- signal_date = yesterday
  '2026-02-04'::date,  -- trade_date = today
  75716.57,            -- Current CI bands price
  'm025_mean',         -- Assuming BUY zone
  'BUY', 
  0.20,                -- 20% of balance
  'test_timeout_fallback_retest',
  'TC-FALLBACK-01 RE-TEST: 20% BUY at $60,000 to test 5-minute fallback',
  (SELECT strategy_version_id FROM public.customer_strategies WHERE customer_id = 47)
)
RETURNING decision_id, action, amount_pct, note;

-- STEP 3: Manually create order intent with STALE price ($60,000)
INSERT INTO lth_pvr.order_intents (
  org_id, 
  customer_id, 
  strategy_version_id, 
  intent_date,
  side, 
  pair, 
  quote_asset, 
  amount, 
  limit_price, 
  status
)
SELECT
  'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 
  47,
  strategy_version_id,
  CURRENT_DATE,
  'BUY', 
  'BTC/USDT', 
  'USDT', 
  (SELECT usdt_balance * 0.20 FROM lth_pvr.balances_daily WHERE customer_id = 47 AND date = CURRENT_DATE),  -- 20% of USDT balance
  60000.00,  -- FAR below market (~$75,716) - will NOT fill
  'pending'
FROM public.customer_strategies 
WHERE customer_id = 47
RETURNING intent_id, side, amount, limit_price, status;

-- STEP 4: Get intent details for monitoring
SELECT 
  'Intent Created' as step,
  intent_id, 
  side,
  amount, 
  limit_price,
  status,
  created_at
FROM lth_pvr.order_intents
WHERE customer_id = 47 
  AND intent_date = CURRENT_DATE
ORDER BY created_at DESC 
LIMIT 1;
