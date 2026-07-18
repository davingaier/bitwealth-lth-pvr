-- ============================================================================
-- LTH PVR Option 4A scarcity/adoption overlay
-- Date: 2026-07-18
--
-- Extends lth_pvr.forecast_lth_pvr_option4 with an optional scarcity-aware
-- adoption overlay. Overlay weight defaults to 0, preserving Option 4 outputs
-- unless explicitly enabled by callers.
-- ============================================================================

DROP FUNCTION IF EXISTS lth_pvr.forecast_lth_pvr_option4(numeric, numeric, integer, uuid, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION lth_pvr.forecast_lth_pvr_option4(
  p_upfront_usdt numeric,
  p_monthly_usdt numeric,
  p_years integer DEFAULT 5,
  p_org_id uuid DEFAULT NULL,
  p_management_fee_rate numeric DEFAULT 0.01,
  p_performance_fee_rate numeric DEFAULT 0.10,
  p_exchange_conversion_fee_rate numeric DEFAULT 0.0018,
  p_exchange_trade_fee_rate numeric DEFAULT 0.0008,
  p_scarcity_overlay_weight numeric DEFAULT 0,
  p_effective_btc_supply numeric DEFAULT 19800000,
  p_target_market_size_usd numeric DEFAULT 100000000000000,
  p_scarcity_adoption_share_conservative numeric DEFAULT 0.02,
  p_scarcity_adoption_share_base numeric DEFAULT 0.05,
  p_scarcity_adoption_share_optimistic numeric DEFAULT 0.10,
  p_adoption_curve_steepness numeric DEFAULT 6
)
RETURNS TABLE(
  forecast_year integer,
  forecast_date date,
  scenario text,
  nav_usd numeric,
  roi_pct numeric,
  cagr_pct numeric,
  total_invested_usd numeric,
  btc_price_usd numeric,
  btc_balance numeric,
  total_fees_usd numeric,
  model_details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'lth_pvr', 'public'
AS $function$
DECLARE
  v_start_date date := CURRENT_DATE;
  v_start_price numeric;
  v_latest_price_date date;
  v_scenario record;
  v_year int;
  v_month int;
  v_cycle_number numeric;
  v_month_in_cycle int;
  v_progress numeric;
  v_cycle_start_price numeric;
  v_option4_price numeric;
  v_scarcity_price numeric;
  v_price numeric;
  v_btc numeric;
  v_nav numeric;
  v_total_invested numeric;
  v_total_fees numeric;
  v_contribution numeric;
  v_net_contribution numeric;
  v_btc_bought numeric;
  v_mgmt_fee numeric;
  v_perf_fee numeric;
  v_gain_before_perf numeric;
  v_gain_after_perf numeric;
  v_hwm_gain numeric;
  v_cycle_return_pct numeric;
  v_cycle_multiple numeric;
  v_log_slope numeric;
  v_log_intercept numeric;
  v_months int;
  v_prev_cycle_return numeric;
  v_overlay_weight numeric;
  v_adoption_final_share numeric;
  v_adoption_raw numeric;
  v_adoption_start numeric;
  v_adoption_end numeric;
  v_adoption_progress numeric;
  v_adoption_share numeric;
BEGIN
  IF p_upfront_usdt IS NULL OR p_upfront_usdt < 0 THEN
    RAISE EXCEPTION 'p_upfront_usdt must be greater than or equal to 0';
  END IF;
  IF p_monthly_usdt IS NULL OR p_monthly_usdt < 0 THEN
    RAISE EXCEPTION 'p_monthly_usdt must be greater than or equal to 0';
  END IF;
  IF p_years IS NULL OR p_years < 1 OR p_years > 30 THEN
    RAISE EXCEPTION 'p_years must be between 1 and 30';
  END IF;
  IF p_management_fee_rate IS NULL OR p_management_fee_rate < 0 OR p_management_fee_rate > 1 THEN
    RAISE EXCEPTION 'p_management_fee_rate must be between 0 and 1';
  END IF;
  IF p_performance_fee_rate IS NULL OR p_performance_fee_rate < 0 OR p_performance_fee_rate > 1 THEN
    RAISE EXCEPTION 'p_performance_fee_rate must be between 0 and 1';
  END IF;
  IF p_exchange_conversion_fee_rate IS NULL OR p_exchange_conversion_fee_rate < 0 OR p_exchange_conversion_fee_rate > 1 THEN
    RAISE EXCEPTION 'p_exchange_conversion_fee_rate must be between 0 and 1';
  END IF;
  IF p_exchange_trade_fee_rate IS NULL OR p_exchange_trade_fee_rate < 0 OR p_exchange_trade_fee_rate > 1 THEN
    RAISE EXCEPTION 'p_exchange_trade_fee_rate must be between 0 and 1';
  END IF;
  IF p_scarcity_overlay_weight IS NULL OR p_scarcity_overlay_weight < 0 OR p_scarcity_overlay_weight > 1 THEN
    RAISE EXCEPTION 'p_scarcity_overlay_weight must be between 0 and 1';
  END IF;
  IF p_effective_btc_supply IS NULL OR p_effective_btc_supply <= 0 OR p_effective_btc_supply > 21000000 THEN
    RAISE EXCEPTION 'p_effective_btc_supply must be greater than 0 and less than or equal to 21,000,000';
  END IF;
  IF p_target_market_size_usd IS NULL OR p_target_market_size_usd <= 0 THEN
    RAISE EXCEPTION 'p_target_market_size_usd must be greater than 0';
  END IF;
  IF p_scarcity_adoption_share_conservative IS NULL OR p_scarcity_adoption_share_conservative < 0 OR p_scarcity_adoption_share_conservative > 1 THEN
    RAISE EXCEPTION 'p_scarcity_adoption_share_conservative must be between 0 and 1';
  END IF;
  IF p_scarcity_adoption_share_base IS NULL OR p_scarcity_adoption_share_base < 0 OR p_scarcity_adoption_share_base > 1 THEN
    RAISE EXCEPTION 'p_scarcity_adoption_share_base must be between 0 and 1';
  END IF;
  IF p_scarcity_adoption_share_optimistic IS NULL OR p_scarcity_adoption_share_optimistic < 0 OR p_scarcity_adoption_share_optimistic > 1 THEN
    RAISE EXCEPTION 'p_scarcity_adoption_share_optimistic must be between 0 and 1';
  END IF;
  IF p_adoption_curve_steepness IS NULL OR p_adoption_curve_steepness <= 0 OR p_adoption_curve_steepness > 25 THEN
    RAISE EXCEPTION 'p_adoption_curve_steepness must be greater than 0 and less than or equal to 25';
  END IF;

  v_overlay_weight := p_scarcity_overlay_weight;

  SELECT b.btc_price, b.date
    INTO v_start_price, v_latest_price_date
  FROM lth_pvr.rb_bands_daily b
  WHERE (p_org_id IS NULL OR b.org_id = p_org_id)
  ORDER BY b.date DESC
  LIMIT 1;

  IF v_start_price IS NULL THEN
    SELECT b.btc_price, b.date
      INTO v_start_price, v_latest_price_date
    FROM lth_pvr.ci_bands_daily b
    WHERE (p_org_id IS NULL OR b.org_id = p_org_id)
    ORDER BY b.date DESC
    LIMIT 1;
  END IF;

  IF v_start_price IS NULL OR v_start_price <= 0 THEN
    RAISE EXCEPTION 'No latest BTC price was found in lth_pvr.rb_bands_daily or lth_pvr.ci_bands_daily';
  END IF;

  SELECT regr_slope(ln(return_pct), cycle_no), regr_intercept(ln(return_pct), cycle_no)
    INTO v_log_slope, v_log_intercept
  FROM (VALUES
    (2::numeric, 12124.84::numeric),
    (3::numeric, 2049.51::numeric),
    (4::numeric, 715.70::numeric)
  ) AS x(cycle_no, return_pct);

  v_adoption_start := 1 / (1 + exp(-p_adoption_curve_steepness * (-0.5)));
  v_adoption_end := 1 / (1 + exp(-p_adoption_curve_steepness * 0.5));

  FOR v_scenario IN
    SELECT * FROM (VALUES
      ('Conservative'::text, 0.65::numeric, p_scarcity_adoption_share_conservative),
      ('Base'::text, 1.00::numeric, p_scarcity_adoption_share_base),
      ('Optimistic'::text, 1.35::numeric, p_scarcity_adoption_share_optimistic)
    ) AS s(name, factor, adoption_share)
  LOOP
    v_btc := 0;
    v_nav := 0;
    v_total_invested := 0;
    v_total_fees := 0;
    v_hwm_gain := 0;
    v_cycle_start_price := v_start_price;
    v_prev_cycle_return := 715.70;
    v_months := p_years * 12;
    v_adoption_final_share := v_scenario.adoption_share;

    FOR v_month IN 0..v_months LOOP
      v_cycle_number := 5 + floor(GREATEST(v_month - 1, 0) / 48.0);
      v_month_in_cycle := CASE WHEN v_month = 0 THEN 0 ELSE ((v_month - 1) % 48) + 1 END;
      v_progress := v_month_in_cycle / 48.0;

      IF v_month > 1 AND v_month_in_cycle = 1 THEN
        v_cycle_start_price := v_option4_price;
        v_prev_cycle_return := v_cycle_return_pct;
      END IF;

      v_cycle_return_pct := exp(v_log_intercept + v_log_slope * v_cycle_number) * v_scenario.factor;
      v_cycle_return_pct := LEAST(v_cycle_return_pct, v_prev_cycle_return * 0.92);
      v_cycle_return_pct := GREATEST(v_cycle_return_pct, 1);
      v_cycle_multiple := 1 + (v_cycle_return_pct / 100.0);
      v_option4_price := v_cycle_start_price * power(v_cycle_multiple, v_progress);

      v_adoption_raw := 1 / (1 + exp(-p_adoption_curve_steepness * ((v_month::numeric / GREATEST(v_months, 1)) - 0.5)));
      v_adoption_progress := CASE
        WHEN v_adoption_end = v_adoption_start THEN 0
        ELSE GREATEST(0, LEAST(1, (v_adoption_raw - v_adoption_start) / (v_adoption_end - v_adoption_start)))
      END;
      v_adoption_share := v_adoption_final_share * v_adoption_progress;
      v_scarcity_price := (p_target_market_size_usd * v_adoption_share) / p_effective_btc_supply;
      v_scarcity_price := GREATEST(v_option4_price, COALESCE(v_scarcity_price, 0));

      v_price := CASE
        WHEN v_overlay_weight = 0 THEN v_option4_price
        ELSE exp((1 - v_overlay_weight) * ln(v_option4_price) + v_overlay_weight * ln(v_scarcity_price))
      END;

      v_contribution := CASE
        WHEN v_month = 0 THEN p_upfront_usdt
        ELSE p_monthly_usdt
      END;

      IF v_contribution > 0 THEN
        v_total_invested := v_total_invested + v_contribution;
        v_total_fees := v_total_fees + (v_contribution * p_exchange_conversion_fee_rate);
        v_net_contribution := v_contribution * (1 - p_exchange_conversion_fee_rate);
        v_total_fees := v_total_fees + (v_net_contribution * p_exchange_trade_fee_rate);
        v_btc_bought := (v_net_contribution * (1 - p_exchange_trade_fee_rate)) / v_price;
        v_btc := v_btc + v_btc_bought;
      END IF;

      v_nav := v_btc * v_price;

      IF v_month > 0 AND v_nav > 0 THEN
        v_mgmt_fee := v_nav * (p_management_fee_rate / 12.0);
        v_mgmt_fee := LEAST(v_mgmt_fee, v_nav);
        IF v_mgmt_fee > 0 THEN
          v_btc := GREATEST(v_btc - (v_mgmt_fee / v_price), 0);
          v_total_fees := v_total_fees + v_mgmt_fee;
          v_nav := v_btc * v_price;
        END IF;

        v_gain_before_perf := v_nav - v_total_invested;
        IF v_gain_before_perf > v_hwm_gain THEN
          v_perf_fee := (v_gain_before_perf - v_hwm_gain) * p_performance_fee_rate;
          v_perf_fee := LEAST(v_perf_fee, v_nav);
          IF v_perf_fee > 0 THEN
            v_btc := GREATEST(v_btc - (v_perf_fee / v_price), 0);
            v_total_fees := v_total_fees + v_perf_fee;
            v_nav := v_btc * v_price;
          END IF;
          v_gain_after_perf := v_nav - v_total_invested;
          v_hwm_gain := GREATEST(v_hwm_gain, v_gain_after_perf);
        END IF;
      END IF;

      IF v_month > 0 AND v_month % 12 = 0 THEN
        v_year := v_month / 12;
        forecast_year := v_year;
        forecast_date := (v_start_date + make_interval(years => v_year))::date;
        scenario := v_scenario.name;
        nav_usd := round(v_nav, 2);
        roi_pct := CASE WHEN v_total_invested > 0 THEN round(((v_nav - v_total_invested) / v_total_invested) * 100, 2) ELSE 0 END;
        cagr_pct := CASE WHEN v_total_invested > 0 AND v_nav > 0 THEN round((power(v_nav / v_total_invested, 1.0 / v_year) - 1) * 100, 2) ELSE 0 END;
        total_invested_usd := round(v_total_invested, 2);
        btc_price_usd := round(v_price, 2);
        btc_balance := round(v_btc, 12);
        total_fees_usd := round(v_total_fees, 2);
        model_details := jsonb_build_object(
          'model', CASE WHEN v_overlay_weight > 0 THEN 'option4a_scarcity_adjusted' ELSE 'option4_hybrid_recent_cycle_log_linear' END,
          'scenario_factor', v_scenario.factor,
          'start_date', v_start_date,
          'latest_price_date', v_latest_price_date,
          'start_btc_price_usd', round(v_start_price, 2),
          'cycle_return_pct_at_snapshot', round(v_cycle_return_pct, 4),
          'option4_price_usd', round(v_option4_price, 2),
          'scarcity_price_usd', round(v_scarcity_price, 2),
          'scarcity_overlay_weight', v_overlay_weight,
          'scarcity_adoption_share_at_snapshot', round(v_adoption_share, 8),
          'scarcity_adoption_final_share', v_adoption_final_share,
          'effective_btc_supply', p_effective_btc_supply,
          'target_market_size_usd', p_target_market_size_usd,
          'adoption_curve_steepness', p_adoption_curve_steepness,
          'fees', jsonb_build_object(
            'management_fee_rate', p_management_fee_rate,
            'performance_fee_rate', p_performance_fee_rate,
            'exchange_conversion_fee_rate', p_exchange_conversion_fee_rate,
            'exchange_trade_fee_rate', p_exchange_trade_fee_rate
          )
        );
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION lth_pvr.forecast_lth_pvr_option4(numeric, numeric, integer, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
IS 'Reusable illustrative Option 4/4A BTC diminishing-return forecast. Overlay weight 0 preserves Option 4; overlay weight >0 blends in scarcity/adoption upside from fixed BTC supply and target-market adoption assumptions.';

GRANT EXECUTE ON FUNCTION lth_pvr.forecast_lth_pvr_option4(numeric, numeric, integer, uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO anon, authenticated, service_role;