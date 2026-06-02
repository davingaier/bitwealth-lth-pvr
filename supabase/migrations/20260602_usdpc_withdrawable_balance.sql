-- 20260602_usdpc_withdrawable_balance.sql
-- Phase 3d (USDPC): include held USDPC value in get_withdrawable_balance.
--
-- USDPC-enabled customers keep idle cash in the USDPC yield stablecoin, so their
-- spot USDT balance is ~0. The previous RPC only counted usdt_balance, which made
-- USDT/ZAR withdrawals (and the ZAR-conversion sell sizing) think the customer had
-- no spendable USDT. We now value held USDPC at its latest market price (net of the
-- conversion taker fee, so the figure is realisable) and fold it into withdrawable
-- USDT. The withdrawal queue (ef_process_withdrawal_queue) JIT-converts the needed
-- USDPC→USDT before the actual VALR outflow.
--
-- Output gains usdpc_balance / usdpc_price_usd / usdpc_value_usd for transparency.
-- Drop+recreate because the RETURNS TABLE signature changes.

DROP FUNCTION IF EXISTS lth_pvr.get_withdrawable_balance(BIGINT);

CREATE OR REPLACE FUNCTION lth_pvr.get_withdrawable_balance(
  p_customer_id BIGINT
)
RETURNS TABLE (
  customer_id BIGINT,
  recorded_btc NUMERIC(38,8),
  recorded_usdt NUMERIC(38,8),
  accumulated_btc NUMERIC(38,8),
  accumulated_usdt NUMERIC(38,8),
  usdpc_balance NUMERIC(38,8),
  usdpc_price_usd NUMERIC(38,8),
  usdpc_value_usd NUMERIC(38,8),
  withdrawable_btc NUMERIC(38,8),
  withdrawable_usdt NUMERIC(38,8),
  total_usd NUMERIC(38,2),
  withdrawable_usd NUMERIC(38,2)
) AS $$
DECLARE
  v_org_id UUID;
  v_btc_price NUMERIC(38,2);
  -- USDPC conversion taker fee (default 0.001 = 0.1%); haircut so the reported
  -- withdrawable USDT is actually realisable after the USDPC→USDT market sell.
  v_usdpc_fee NUMERIC := 0.001;
BEGIN
  -- Get org_id for customer
  SELECT cd.org_id INTO v_org_id
  FROM public.customer_details cd
  WHERE cd.customer_id = p_customer_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;

  -- Latest BTC price for USD conversion. Live band source is RB; fall back to the
  -- frozen CI series, then a static default.
  v_btc_price := COALESCE(
    (SELECT rb.btc_price FROM lth_pvr.rb_bands_daily rb ORDER BY rb.date DESC LIMIT 1),
    (SELECT ci.btc_price FROM lth_pvr.ci_bands_daily ci ORDER BY ci.date DESC LIMIT 1),
    100000
  );

  -- Prefer the configured USDPC taker fee from lth_pvr.settings, if present.
  -- (Scalar subquery yields NULL when the key is absent, so COALESCE keeps the default.)
  v_usdpc_fee := COALESCE(
    (SELECT (s.val)::numeric FROM lth_pvr.settings s WHERE s.key = 'usdpc_taker_fee_rate' LIMIT 1),
    v_usdpc_fee
  );

  RETURN QUERY
  WITH latest AS (
    SELECT
      COALESCE(bd.btc_balance, 0)                                   AS btc_bal,
      COALESCE(bd.usdt_balance, 0)                                  AS usdt_bal,
      COALESCE(bd.usdpc_balance, 0)                                 AS usdpc_bal,
      -- Value held USDPC at the day's stored price, else the latest known market
      -- price, else 1.0 (par). Net of the conversion fee so it is realisable.
      COALESCE(
        bd.usdpc_price_usd,
        (SELECT price_usd FROM lth_pvr.usdpc_prices_daily ORDER BY date DESC LIMIT 1),
        1
      )                                                             AS usdpc_px
    FROM lth_pvr.balances_daily bd
    WHERE bd.customer_id = p_customer_id
      AND bd.org_id = v_org_id
    ORDER BY bd.date DESC
    LIMIT 1
  )
  SELECT
    p_customer_id,
    l.btc_bal                                                       AS recorded_btc,
    l.usdt_bal                                                      AS recorded_usdt,
    COALESCE(caf.accumulated_btc, 0)                                AS accumulated_btc,
    COALESCE(caf.accumulated_usdt, 0)                               AS accumulated_usdt,
    l.usdpc_bal                                                     AS usdpc_balance,
    l.usdpc_px                                                      AS usdpc_price_usd,
    (l.usdpc_bal * l.usdpc_px * (1 - v_usdpc_fee))                  AS usdpc_value_usd,
    -- Withdrawable BTC unchanged: recorded BTC minus accrued BTC fees.
    (l.btc_bal - COALESCE(caf.accumulated_btc, 0))                  AS withdrawable_btc,
    -- Withdrawable USDT now folds in the realisable USDPC value (JIT-converted
    -- at withdrawal time), minus accrued USDT fees.
    (l.usdt_bal + (l.usdpc_bal * l.usdpc_px * (1 - v_usdpc_fee)) - COALESCE(caf.accumulated_usdt, 0))
                                                                    AS withdrawable_usdt,
    -- Total balance in USD (BTC + USDT + USDPC value, gross of fees).
    ((l.btc_bal * v_btc_price) + l.usdt_bal + (l.usdpc_bal * l.usdpc_px))::numeric(38,2)
                                                                    AS total_usd,
    -- Withdrawable balance in USD (net of accrued platform fees).
    (((l.btc_bal - COALESCE(caf.accumulated_btc, 0)) * v_btc_price)
      + (l.usdt_bal + (l.usdpc_bal * l.usdpc_px * (1 - v_usdpc_fee)) - COALESCE(caf.accumulated_usdt, 0)))::numeric(38,2)
                                                                    AS withdrawable_usd
  FROM latest l
  LEFT JOIN lth_pvr.customer_accumulated_fees caf
    ON caf.customer_id = p_customer_id AND caf.org_id = v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION lth_pvr.get_withdrawable_balance(BIGINT) IS
'Calculate withdrawable balance for customer (recorded balance minus accumulated fees).
USDPC-enabled customers: held USDPC is valued at the latest USDPC/USDT price, net of
the conversion taker fee, and folded into withdrawable_usdt (JIT-converted at withdrawal
time by ef_process_withdrawal_queue). Prevents customers withdrawing accrued platform fees.';
