-- Migration: Add test data for Customer 31 (January 2026)
-- Purpose: Generate realistic transaction history and balances for statement testing
-- Date: 2026-01-14

-- Set search path to include both schemas
SET search_path TO public, lth_pvr;

-- Store org_id for filtering
DO $$
DECLARE
  v_org_id UUID := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  v_customer_id INT := 31;
  v_btc_price_dec31 NUMERIC := 93500.00;
  v_btc_price_jan31 NUMERIC := 101200.00;
BEGIN

-- Delete existing January 2026 test data for Customer 31
DELETE FROM lth_pvr.ledger_lines 
WHERE customer_id = v_customer_id 
  AND trade_date BETWEEN '2026-01-01' AND '2026-01-31';

DELETE FROM lth_pvr.balances_daily 
WHERE customer_id = v_customer_id 
  AND date BETWEEN '2026-01-01' AND '2026-01-31';

DELETE FROM lth_pvr.std_dca_balances_daily 
WHERE customer_id = v_customer_id 
  AND date BETWEEN '2026-01-01' AND '2026-01-31';

-- Ensure December 2025 opening balances exist
INSERT INTO lth_pvr.balances_daily (
  org_id, customer_id, date,
  btc_balance, usdt_balance, btc_price, nav_usd,
  contrib_gross_cum, contrib_net_cum, fees_platform_cum, fees_exchange_cum
) VALUES (
  v_org_id, v_customer_id, '2025-12-31',
  0.00000000, 0.00, v_btc_price_dec0.00,
  0.00, 0.00, 0.00, 0.00
) ON CONFLICT (org_id, customer_id, date) DO NOTHING;

-- Insert realistic transaction data for January 2026
-- Transaction 1: Initial deposit (Jan 1)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, NULL, '2026-01-01', 'deposit',
  0.00000000, 1000.00, 0.00000000, 0.00, v_btc_price_dec31
);

-- Transaction 2: BTC buy (Jan 2)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, 10001, '2026-01-02', 'buy',
  0.00535475, -500.50, 0.00000964, 0.90, 93500.00
);

-- Transaction 3: Monthly contribution (Jan 5)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, NULL, '2026-01-05', 'topup',
  0.00000000, 500.00, 0.00000000, 0.00, 94200.00
);

-- Transaction 4: BTC buy (Jan 6)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, 10002, '2026-01-06', 'buy',
  0.00263698, -248.50, 0.00000475, 0.45, 94200.00
);

-- Transaction 5: Small BTC buy (Jan 10)
INSERT INTO lth_pvr.ledger_lines (
  org_id, v_customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, 10003, '2026-01-10', 'buy',
  0.00105263, -100.25, 0.00000189, 0.18, 95200.00
);

-- Transaction 6: BTC sell (Jan 15)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, 10004, '2026-01-15', 'sell',
  -0.00104167, 100.00, 0.00000188, 0.18, 96000.00
);

-- Transaction 7: BTC buy (Jan 20)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, 10005, '2026-01-20', 'buy',
  0.00206185, -200.40, 0.00000371, 0.36, 97200.00
);

-- Transaction 8: Small withdrawal (Jan 25)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, NULL, '2026-01-25', 'withdrawal',
  0.00000000, -50.00, 0.00000000, 2.00, 99500.00
);

-- Transaction 9: BTC buy (Jan 28)
INSERT INTO lth_pvr.ledger_lines (
  org_id, customer_id, intent_id, trade_date, kind,
  amount_btc, amount_usdt, fee_btc, fee_usdt, btc_price
) VALUES (
  v_org_id, v_customer_id, 10006, '2026-01-28', 'buy',
  0.00149254, -150.60, 0.00000269, 0.27, 100800.00
);

-- Insert balances for January 2026 (end of month)
-- Calculate cumulative balances
INSERT INTO lth_pvr.balances_daily (
  org_id, customer_id, date,
  btc_balance, usdt_balance, btc_price, nav_usd,
  contrib_gross_cum, contrib_net_cum, fees_platform_cum, fees_exchange_cum
) VALUES (
  v_org_id, v_customer_id, '2026-01-31',
  0.01155708, -- Sum of BTC transactions
  349.35, -- Sum of USDT transactions (1000 + 500 - 500.50 - 248.50 - 100.25 + 100 - 200.40 - 50 - 150.60)
  v_btc_price_jan31,
  1518.63, -- NAV = (0.01155708 * 101200) + 349.35 = 1169.28 + 349.35
  1500.00, -- Total deposits (1000 + 500)
  1495.00, -- Net contributions after withdrawal (1500 - 50 + withdrawal fee -2)
  11.25, -- Platform fees (0.75% of total traded ~$1500)
  4.62 -- Exchange fees (sum of all fee_usdt)
) ON CONFLICT (org_id, customer_id, date) DO UPDATE SET
  btc_balance = EXCLUDED.btc_balance,
  usdt_balance = EXCLUDED.usdt_balance,
  nav_usd = EXCLUDED.nav_usd,
  contrib_gross_cum = EXCLUDED.contrib_gross_cum,
  contrib_net_cum = EXCLUDED.contrib_net_cum,
  fees_platform_cum = EXCLUDED.fees_platform_cum,
  fees_exchange_cum = EXCLUDED.fees_exchange_cum;

-- Insert Standard DCA benchmark data for December 2025
INSERT INTO lth_pvr.std_dca_balances_daily (
  org_id, customer_id, date,
  btc_balance, usdt_balance, btc_price, nav_usd,
  contrib_gross_cum, contrib_net_cum
) VALUES (
  v_org_id, v_customer_id, '2025-12-31',
  0.00000000, 0.00, v_btc_price_dec0.00,
  0.00, 0.00
) ON CONFLICT (org_id, customer_id, date) DO NOTHING;

-- Insert Standard DCA benchmark data for January 2026
-- Standard DCA buys immediately on deposit (no timing strategy)
INSERT INTO lth_pvr.std_dca_balances_daily (
  org_id, customer_id, date,
  btc_balance, usdt_balance, btc_price, nav_usd,
  contrib_gross_cum, contrib_net_cum
) VALUES (
  v_org_id, v_customer_id, '2026-01-31',
  0.01485149, -- Bought more BTC (worse timing than LTH PVR)
  0.00, -- All USDT invested immediately
  v_btc_price_jan31,
  1503.17, -- NAV = 0.01485149 * 101200 = 1503.17 (slightly worse than LTH PVR)
  1500.00, -- Same total deposits
  1495.00 -- Same net contributions
) ON CONFLICT (org_id, customer_id, date) DO UPDATE SET
  btc_balance = EXCLUDED.btc_balance,
  usdt_balance = EXCLUDED.usdt_balance,
  nav_usd = EXCLUDED.nav_usd;

END $$;

-- Verify data inserted
SELECT 'Ledger Lines' AS table_name, COUNT(*) AS row_count
FROM lth_pvr.ledger_lines
WHERE customer_id = 31 AND trade_date BETWEEN '2026-01-01' AND '2026-01-31'
UNION ALL
SELECT 'Balances Daily', COUNT(*)
FROM lth_pvr.balances_daily
WHERE customer_id = 31 AND date BETWEEN '2025-12-31' AND '2026-01-31'
UNION ALL
SELECT 'Std DCA Balances', COUNT(*)
FROM lth_pvr.std_dca_balances_daily
WHERE customer_id = 31 AND date BETWEEN '2025-12-31' AND '2026-01-31';
