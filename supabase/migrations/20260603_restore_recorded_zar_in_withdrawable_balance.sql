-- 20260603_restore_recorded_zar_in_withdrawable_balance.sql
-- Restore recorded_zar / withdrawable_zar to lth_pvr.get_withdrawable_balance.
--
-- The Phase 3d USDPC migration (20260602_usdpc_withdrawable_balance.sql) recreated
-- this function with a new RETURNS TABLE signature but accidentally dropped the
-- recorded_zar / withdrawable_zar output columns. The customer portal Cash (ZAR)
-- card reads wb.recorded_zar, so ZAR deposits silently rendered as R0.00 even
-- though balances_daily.zar_balance was correct (e.g. customer 49's R200k).
--
-- ZAR is never charged platform fees, so withdrawable_zar == recorded_zar.
-- Drop+recreate because the RETURNS TABLE signature changes.

DROP FUNCTION IF EXISTS lth_pvr.get_withdrawable_balance(BIGINT);

CREATE OR REPLACE FUNCTION lth_pvr.get_withdrawable_balance(
  p_customer_id BIGINT
)
RETURNS TABLE (
  customer_id BIGINT,
  recorded_btc NUMERIC(38,8),
  recorded_usdt NUMERIC(38,8),
  recorded_zar NUMERIC(38,8),
  accumulated_btc NUMERIC(38,8),
  accumulated_usdt NUMERIC(38,8),
  usdpc_balance NUMERIC(38,8),
  usdpc_price_usd NUMERIC(38,8),
  usdpc_value_usd NUMERIC(38,8),
  withdrawable_btc NUMERIC(38,8),
  withdrawable_usdt NUMERIC(38,8),
  withdrawable_zar NUMERIC(38,8),
  total_usd NUMERIC(38,2),
  withdrawable_usd NUMERIC(38,2)
) AS $$
DECLARE
  v_org_id UUID;
  v_btc_price NUMERIC(38,2);
  v_usdpc_fee NUMERIC := 0.001;
BEGIN
  SELECT cd.org_id INTO v_org_id
  FROM public.customer_details cd
  WHERE cd.customer_id = p_customer_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id;
  END IF;

  v_btc_price := COALESCE(
    (SELECT rb.btc_price FROM lth_pvr.rb_bands_daily rb ORDER BY rb.date DESC LIMIT 1),
    (SELECT ci.btc_price FROM lth_pvr.ci_bands_daily ci ORDER BY ci.date DESC LIMIT 1),
    100000
  );

  v_usdpc_fee := COALESCE(
    (SELECT (s.val)::numeric FROM lth_pvr.settings s WHERE s.key = 'usdpc_taker_fee_rate' LIMIT 1),
    v_usdpc_fee
  );

  RETURN QUERY
  WITH latest AS (
    SELECT
      COALESCE(bd.btc_balance, 0)                                   AS btc_bal,
      COALESCE(bd.usdt_balance, 0)                                  AS usdt_bal,
      COALESCE(bd.zar_balance, 0)                                   AS zar_bal,
      COALESCE(bd.usdpc_balance, 0)                                 AS usdpc_bal,
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
    l.btc_bal,
    l.usdt_bal,
    l.zar_bal,
    COALESCE(caf.accumulated_btc, 0),
    COALESCE(caf.accumulated_usdt, 0),
    l.usdpc_bal,
    l.usdpc_px,
    (l.usdpc_bal * l.usdpc_px * (1 - v_usdpc_fee)),
    (l.btc_bal - COALESCE(caf.accumulated_btc, 0)),
    (l.usdt_bal + (l.usdpc_bal * l.usdpc_px * (1 - v_usdpc_fee)) - COALESCE(caf.accumulated_usdt, 0)),
    l.zar_bal,
    ((l.btc_bal * v_btc_price) + l.usdt_bal + (l.usdpc_bal * l.usdpc_px))::numeric(38,2),
    (((l.btc_bal - COALESCE(caf.accumulated_btc, 0)) * v_btc_price)
      + (l.usdt_bal + (l.usdpc_bal * l.usdpc_px * (1 - v_usdpc_fee)) - COALESCE(caf.accumulated_usdt, 0)))::numeric(38,2)
  FROM latest l
  LEFT JOIN lth_pvr.customer_accumulated_fees caf
    ON caf.customer_id = p_customer_id AND caf.org_id = v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION lth_pvr.get_withdrawable_balance(BIGINT) IS
'Calculate withdrawable balance for customer (recorded balance minus accumulated fees).
Returns recorded/withdrawable BTC, USDT and ZAR plus held USDPC valued at the latest
USDPC/USDT price (net of conversion taker fee) folded into withdrawable_usdt. ZAR is
never fee-charged, so withdrawable_zar == recorded_zar.';
