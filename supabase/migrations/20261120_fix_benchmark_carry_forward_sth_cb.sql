-- 2026-11-20 — Benchmark series (Std DCA / HODL) stopped for STH_CB customers.
--
-- Root cause: lth_pvr.customer_strategies is a compatibility VIEW over public.customer_strategies that
-- filtered `strategy_code = 'LTH_PVR'`. lth_pvr.carry_forward_daily_balances() (cron 03:00 / 17:00 UTC)
-- joins that view to pick the customers whose hodl_balances_daily / std_dca_balances_daily it rebuilds,
-- so every STH_CB customer (31, 49, 65, 999) was skipped: their benchmark series only advanced on days
-- ef_post_ledger_and_balances saw ledger activity, then froze (49 → 2026-11-15, 31 → 2026-11-09).
-- Rule (copilot-instructions "Live pipeline"): every "LTH_PVR only" gate must admit STH_CB.
--
-- Also fixed in the same function: gap-fill pricing read lth_pvr.ci_bands_daily, frozen since the
-- 2026-05-19 CI→RB migration (last price 77,031) — switched to rb_bands_daily like every other reader.

-- 1) Widen the compat view to every strategy that runs on the shared execution engine.
--    One row per customer (switches are in-place), so no double counting is possible.
create or replace view lth_pvr.customer_strategies
with (security_invoker = true) as
select customer_strategy_id,
       org_id,
       customer_id,
       portfolio_id,
       strategy_version_id,
       live_enabled,
       false          as paper_enabled,
       null::numeric  as capital_target_usd,
       exchange_account_id,
       effective_from,
       effective_to,
       created_at,
       created_at     as updated_at
  from public.customer_strategies
 where strategy_code in ('LTH_PVR', 'STH_CB');

comment on view lth_pvr.customer_strategies is
  'Compatibility view over public.customer_strategies for the shared execution engine. Includes every '
  'live-engine strategy (LTH_PVR, STH_CB) — never filter this back to LTH_PVR only (2026-11-20 benchmark outage).';

-- 2) carry_forward_daily_balances: RB price source + explicit strategy gate on the base table.
CREATE OR REPLACE FUNCTION lth_pvr.carry_forward_daily_balances()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'lth_pvr', 'public', 'extensions'
AS $function$
DECLARE
  today         date := CURRENT_DATE;
  latest_price  numeric;
  carried_bd    int := 0;
  hodl_recalcs  int := 0;
  std_recalcs   int := 0;
  cust          record;
  d             date;
  px            numeric;
  first_bd_date date;
  bd_btc        numeric;
  bd_usdt       numeric;
  bd_zar        numeric;
  bd_usdpc      numeric;
  usdpc_px      numeric;
  bd_top        numeric;
  bd_wd         numeric;
  bd_cb         numeric;
  rc            int;
BEGIN
  -- RB bands are the live price source (ci_bands_daily is frozen historical data).
  SELECT rb.btc_price INTO latest_price
  FROM lth_pvr.rb_bands_daily rb
  WHERE rb.btc_price IS NOT NULL
  ORDER BY rb.date DESC LIMIT 1;

  IF latest_price IS NULL THEN
    RETURN jsonb_build_object('status','skipped','reason','no btc price');
  END IF;

  FOR cust IN
    SELECT DISTINCT b.org_id, b.customer_id
    FROM lth_pvr.balances_daily b
    JOIN public.customer_details cd
      ON cd.customer_id = b.customer_id
    JOIN public.customer_strategies cs
      ON cs.customer_id = b.customer_id
     AND cs.org_id      = b.org_id
     AND cs.live_enabled = true
     AND cs.strategy_code IN ('LTH_PVR','STH_CB')
    WHERE cd.registration_status = 'active'
  LOOP
    SELECT MIN(date) INTO first_bd_date
    FROM lth_pvr.balances_daily
    WHERE customer_id = cust.customer_id AND org_id = cust.org_id;

    IF first_bd_date IS NOT NULL THEN
      FOR d IN
        SELECT gs::date
        FROM generate_series(first_bd_date, today, INTERVAL '1 day') gs
        WHERE NOT EXISTS (
          SELECT 1 FROM lth_pvr.balances_daily bd
          WHERE bd.customer_id = cust.customer_id
            AND bd.org_id      = cust.org_id
            AND bd.date        = gs::date
        )
        ORDER BY gs::date
      LOOP
        px := COALESCE(
          (SELECT rb.btc_price FROM lth_pvr.rb_bands_daily rb
            WHERE rb.date <= d AND rb.btc_price IS NOT NULL ORDER BY rb.date DESC LIMIT 1),
          latest_price
        );
        -- Cumulative balances from the ledger as of day d. USDPC is included so
        -- that yield-bearing idle cash is never silently zeroed on idle days.
        SELECT COALESCE(SUM(amount_btc),  0),
               COALESCE(SUM(amount_usdt), 0),
               COALESCE(SUM(amount_zar),  0),
               COALESCE(SUM(amount_usdpc), 0) - COALESCE(SUM(fee_usdpc), 0)
          INTO bd_btc, bd_usdt, bd_zar, bd_usdpc
        FROM lth_pvr.ledger_lines
        WHERE customer_id = cust.customer_id
          AND org_id      = cust.org_id
          AND trade_date <= d;

        -- USDPC price (USDT per USDPC), last known <= d, default 1.0.
        usdpc_px := COALESCE(
          (SELECT up.price_usd FROM lth_pvr.usdpc_prices_daily up
            WHERE up.date <= d ORDER BY up.date DESC LIMIT 1),
          1
        );

        SELECT
          COALESCE(SUM(amount_usdt) FILTER (WHERE kind = 'topup'),      0),
          COALESCE(SUM(ABS(amount_usdt)) FILTER (WHERE kind = 'withdrawal'), 0)
        INTO bd_top, bd_wd
        FROM lth_pvr.ledger_lines
        WHERE customer_id = cust.customer_id
          AND org_id      = cust.org_id
          AND trade_date <= d
          AND kind IN ('topup','withdrawal');

        bd_cb := GREATEST(0, bd_top - bd_wd);

        INSERT INTO lth_pvr.balances_daily
          (org_id, customer_id, date, btc_balance, usdt_balance, zar_balance,
           usdpc_balance, usdpc_price_usd, nav_usd, cost_basis_usd)
        VALUES
          (cust.org_id, cust.customer_id, d, bd_btc, bd_usdt, bd_zar,
           bd_usdpc, usdpc_px, bd_btc * px + bd_usdt + bd_usdpc * usdpc_px, bd_cb)
        ON CONFLICT (org_id, customer_id, date) DO NOTHING;
        GET DIAGNOSTICS rc = ROW_COUNT;
        carried_bd := carried_bd + rc;
      END LOOP;
    END IF;

    -- Refresh cost_basis_usd on any rows that pre-date this column or were inserted elsewhere.
    UPDATE lth_pvr.balances_daily b
       SET cost_basis_usd = sub.cb
      FROM (
        SELECT
          bd.date,
          GREATEST(0,
            COALESCE(SUM(ll.amount_usdt) FILTER (WHERE ll.kind = 'topup'),      0)
          - COALESCE(SUM(ABS(ll.amount_usdt)) FILTER (WHERE ll.kind = 'withdrawal'), 0)
          ) AS cb
        FROM lth_pvr.balances_daily bd
        LEFT JOIN lth_pvr.ledger_lines ll
          ON ll.customer_id = bd.customer_id
         AND ll.org_id      = bd.org_id
         AND ll.trade_date <= bd.date
         AND ll.kind IN ('topup','withdrawal')
        WHERE bd.customer_id = cust.customer_id
          AND bd.org_id      = cust.org_id
        GROUP BY bd.date
      ) sub
      WHERE b.customer_id = cust.customer_id
        AND b.org_id      = cust.org_id
        AND b.date        = sub.date
        AND b.cost_basis_usd IS DISTINCT FROM sub.cb;

    -- HODL: recompute under new semantics every run.
    PERFORM lth_pvr.recompute_hodl_balances(cust.customer_id, cust.org_id);
    hodl_recalcs := hodl_recalcs + 1;

    PERFORM lth_pvr.recompute_std_dca_balances(cust.customer_id, cust.org_id);
    std_recalcs := std_recalcs + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status','ok',
    'date', today,
    'btc_price_used', latest_price,
    'gap_filled', jsonb_build_object('balances_daily', carried_bd),
    'hodl_recomputed',     hodl_recalcs,
    'std_dca_recomputed',  std_recalcs
  );
END;
$function$;

revoke execute on function lth_pvr.carry_forward_daily_balances() from public, anon, authenticated;