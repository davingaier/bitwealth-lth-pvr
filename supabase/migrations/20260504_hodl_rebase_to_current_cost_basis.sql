-- v0.6.105: HODL benchmark rebases to *current* cost basis on every recompute.
--
-- Old behaviour: each historical row used the cumulative cost basis as of THAT
-- date, divided by day-0 BTC price. That left old rows untouched when a new
-- deposit landed, producing a visible "step up" in the HODL line on each
-- top-up date instead of the smooth rebase the customer-facing tooltip
-- promises ("HODL is modelled as if your current Cost Basis had been invested
-- upfront on day 1 at that day's BTC price… historical HODL line will rebase
-- across the entire chart whenever you deposit or withdraw").
--
-- New behaviour: every row uses TODAY's net cost basis ÷ day-0 price.
-- contrib_cum_usd is set to today's cb on every row (matches what the line
-- now represents — a single rebased benchmark, not a per-day contribution
-- ledger).
CREATE OR REPLACE FUNCTION lth_pvr.recompute_hodl_balances(p_customer_id bigint, p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  today        date := CURRENT_DATE;
  first_date   date;
  cur_date     date;
  day0_price   numeric;
  cur_price    numeric;
  today_cb     numeric;
  btc_eq       numeric;
  rows_built   int := 0;
BEGIN
  -- Earliest deposit defines day-0 of the HODL benchmark.
  SELECT MIN(trade_date) INTO first_date
  FROM lth_pvr.ledger_lines
  WHERE customer_id = p_customer_id
    AND org_id      = p_org_id
    AND kind        = 'topup'
    AND amount_usdt > 0;

  IF first_date IS NULL THEN
    RETURN jsonb_build_object('status','skipped','reason','no deposits');
  END IF;

  -- Day-0 price = most recent CI close on or before first deposit date.
  SELECT btc_price INTO day0_price
  FROM lth_pvr.ci_bands_daily
  WHERE date <= first_date
  ORDER BY date DESC LIMIT 1;

  IF day0_price IS NULL OR day0_price = 0 THEN
    RETURN jsonb_build_object('status','skipped','reason','no day-0 price');
  END IF;

  -- TODAY's net cost basis = total deposits − total withdrawals (entire ledger,
  -- no date filter). One number, applied to every historical row.
  SELECT GREATEST(0,
           COALESCE(SUM(amount_usdt)      FILTER (WHERE kind = 'topup'),      0)
         - COALESCE(SUM(ABS(amount_usdt)) FILTER (WHERE kind = 'withdrawal'), 0))
  INTO today_cb
  FROM lth_pvr.ledger_lines
  WHERE customer_id = p_customer_id
    AND org_id      = p_org_id
    AND kind IN ('topup','withdrawal');

  IF today_cb <= 0 THEN
    -- Customer has fully withdrawn — leave history but value at zero.
    DELETE FROM lth_pvr.hodl_balances_daily
    WHERE customer_id = p_customer_id AND org_id = p_org_id;
    RETURN jsonb_build_object('status','ok','reason','today_cb=0','rows_built',0);
  END IF;

  btc_eq := today_cb / day0_price;

  DELETE FROM lth_pvr.hodl_balances_daily
  WHERE customer_id = p_customer_id AND org_id = p_org_id;

  cur_date := first_date;
  WHILE cur_date <= today LOOP
    SELECT btc_price INTO cur_price
    FROM lth_pvr.ci_bands_daily
    WHERE date <= cur_date
    ORDER BY date DESC LIMIT 1;

    IF cur_price IS NULL THEN cur_price := day0_price; END IF;

    INSERT INTO lth_pvr.hodl_balances_daily
      (org_id, customer_id, date, btc_balance, contrib_cum_usd, nav_usd)
    VALUES
      (p_org_id, p_customer_id, cur_date, btc_eq, today_cb, btc_eq * cur_price);

    rows_built := rows_built + 1;
    cur_date   := cur_date + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status','ok',
    'customer_id', p_customer_id,
    'first_date',  first_date,
    'day0_price',  day0_price,
    'today_cb',    today_cb,
    'btc_eq',      btc_eq,
    'rows_built',  rows_built
  );
END;
$function$;

-- Expose current HWM in the customer performance feed so the portal chart can
-- plot it as a horizontal annotation.
CREATE OR REPLACE FUNCTION lth_pvr.get_customer_performance_data(p_customer_id bigint, p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'daily', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'date'))
      FROM (
        SELECT jsonb_build_object(
          'date',           b.date,
          'nav_usd',        b.nav_usd,
          'btc_balance',    b.btc_balance,
          'usdt_balance',   b.usdt_balance,
          'cost_basis_usd', b.cost_basis_usd,
          'btc_price',      COALESCE(ci.btc_price, 0),
          'action',         d.action,
          'amount_pct',     d.amount_pct,
          'contrib_cum_usd', (
            SELECT COALESCE(SUM(amount_usdt), 0)
            FROM lth_pvr.ledger_lines ll
            WHERE ll.customer_id = p_customer_id
              AND ll.org_id      = p_org_id
              AND ll.kind        = 'topup'
              AND ll.trade_date <= b.date
          ),
          'std_dca_nav',   sd.nav_usd,
          'std_dca_btc',   sd.btc_balance,
          'std_dca_usdt',  sd.usdt_balance,
          'hodl_nav',      h.nav_usd,
          'hodl_btc',      h.btc_balance,
          'high_water_mark_usd', cs.high_water_mark_usd
        ) AS row_data
        FROM lth_pvr.balances_daily b
        LEFT JOIN LATERAL (
          SELECT cb.btc_price
          FROM lth_pvr.ci_bands_daily cb
          WHERE cb.date < b.date
          ORDER BY cb.date DESC
          LIMIT 1
        ) ci ON true
        LEFT JOIN lth_pvr.decisions_daily d
               ON d.customer_id = b.customer_id
              AND d.org_id      = b.org_id
              AND d.trade_date  = b.date
        LEFT JOIN lth_pvr.std_dca_balances_daily sd
               ON sd.customer_id = b.customer_id
              AND sd.org_id      = b.org_id
              AND sd.date        = b.date
        LEFT JOIN lth_pvr.hodl_balances_daily h
               ON h.customer_id = b.customer_id
              AND h.org_id      = b.org_id
              AND h.date        = b.date
        LEFT JOIN lth_pvr.customer_state_daily cs
               ON cs.customer_id = b.customer_id
              AND cs.org_id      = b.org_id
              AND cs.date        = b.date
        WHERE b.customer_id = p_customer_id
          AND b.org_id      = p_org_id
      ) sub
    ), '[]'::jsonb),
    'contributions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',        ll.trade_date,
        'amount_usdt', ll.amount_usdt,
        'kind',        ll.kind
      ) ORDER BY ll.trade_date)
      FROM lth_pvr.ledger_lines ll
      WHERE ll.customer_id = p_customer_id
        AND ll.org_id      = p_org_id
        AND ll.kind IN ('topup','withdrawal')
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$function$;
