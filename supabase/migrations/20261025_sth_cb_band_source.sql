-- ============================================================================
-- band_source = 'sth_cb' for the LTH PVR engine
-- ----------------------------------------------------------------------------
-- Mean band = STH cost basis (RB realized_price_sth); ±kσ bands computed by
-- _shared/sth_cb_bands.ts (mode sth_pvr | ratio_sigma). Rows are (re)computed
-- from lth_pvr.onchain_pvr_daily by _shared/sth_cb_bands_db.ts, chained from
-- ef_fetch_onchain_pvr daily and via { "sth_cb_bands": "backfill" }.
--
-- The active σ definition lives in lth_pvr.sth_cb_band_params (one row per org)
-- so switching definition = UPDATE + backfill, no code change.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lth_pvr.sth_cb_band_params (
  org_id      uuid PRIMARY KEY,
  mode        text NOT NULL DEFAULT 'sth_pvr' CHECK (mode IN ('sth_pvr', 'ratio_sigma')),
  window_days integer NOT NULL DEFAULT 0,          -- ratio_sigma only; 0 = expanding
  scale       text NOT NULL DEFAULT 'auto',        -- number as text, or 'auto' (sth_pvr only)
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO lth_pvr.sth_cb_band_params (org_id, note)
VALUES ('b0a77009-03b9-44a1-ae1d-34f157d44a8b', 'default until the optimiser picks a winner')
ON CONFLICT (org_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS lth_pvr.sth_cb_bands_daily (
  org_id            uuid NOT NULL,
  date              date NOT NULL,
  btc_price         numeric(38,8),
  sth_cost_basis    numeric(38,8),
  sigma_unit_usd    numeric(38,8),
  sth_pvr           numeric(20,6),
  band_mode         text,
  band_window_days  integer,
  band_scale        text,
  price_at_m150     numeric(38,8),
  price_at_m125     numeric(38,8),
  price_at_m100     numeric(38,8),
  price_at_m075     numeric(38,8),
  price_at_m050     numeric(38,8),
  price_at_m025     numeric(38,8),
  price_at_mean     numeric(38,8),
  price_at_p025     numeric(38,8),
  price_at_p050     numeric(38,8),
  price_at_p075     numeric(38,8),
  price_at_p100     numeric(38,8),
  price_at_p125     numeric(38,8),
  price_at_p150     numeric(38,8),
  price_at_p175     numeric(38,8),
  price_at_p200     numeric(38,8),
  price_at_p250     numeric(38,8),
  price_at_p300     numeric(38,8),
  price_at_p400     numeric(38,8),
  price_at_p900     numeric(38,8),
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, date)
);
CREATE INDEX IF NOT EXISTS sth_cb_bands_daily_date_idx ON lth_pvr.sth_cb_bands_daily (org_id, date);

ALTER TABLE lth_pvr.sth_cb_band_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE lth_pvr.sth_cb_bands_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lth_pvr.sth_cb_band_params, lth_pvr.sth_cb_bands_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON lth_pvr.sth_cb_band_params, lth_pvr.sth_cb_bands_daily TO service_role;

-- Back-tester view: identical column list to lth_pvr_bt.v_backtest_prices_rb
-- (+ the extra sigma columns, which decideTrade reads by name when configured).
CREATE OR REPLACE VIEW lth_pvr_bt.v_backtest_prices_sth_cb AS
SELECT b.org_id,
       b.date                 AS close_date,
       (b.date + 1)           AS trade_date,
       b.btc_price            AS btc_price_usd,
       b.price_at_mean,
       b.price_at_m025, b.price_at_m050, b.price_at_m075, b.price_at_m100, b.price_at_m125, b.price_at_m150,
       b.price_at_p025, b.price_at_p050, b.price_at_p075, b.price_at_p100, b.price_at_p125, b.price_at_p150,
       b.price_at_p175, b.price_at_p200, b.price_at_p250, b.price_at_p300, b.price_at_p400, b.price_at_p900,
       NULL::boolean          AS bear_pause,
       b.sth_cost_basis, b.sigma_unit_usd, b.sth_pvr, b.band_mode, b.band_window_days, b.band_scale
FROM lth_pvr.sth_cb_bands_daily b
WHERE b.price_at_mean IS NOT NULL;

GRANT SELECT ON lth_pvr_bt.v_backtest_prices_sth_cb TO service_role, authenticated;

-- Widen every CHECK constraint that pins band_source to ('ci','rb') so 'sth_cb' is accepted.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype = 'c'
      AND n.nspname IN ('lth_pvr', 'lth_pvr_bt', 'public')
      AND pg_get_constraintdef(con.oid) ILIKE '%band_source%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%sth_cb%'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (band_source IS NULL OR band_source IN (''ci'',''rb'',''sth_cb''))',
                   r.schema_name, r.table_name, r.conname);
    RAISE NOTICE 'widened % on %.%', r.conname, r.schema_name, r.table_name;
  END LOOP;
END $$;

-- Read RPC for the Admin UI (band chart) — org fixed to the live org, same convention as get_onchain_pvr_series
CREATE OR REPLACE FUNCTION public.get_sth_cb_bands_series(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  date date, btc_price numeric, sth_cost_basis numeric, sth_pvr numeric,
  price_at_m100 numeric, price_at_m050 numeric, price_at_mean numeric, price_at_p050 numeric,
  price_at_p100 numeric, price_at_p150 numeric, price_at_p200 numeric, price_at_p250 numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT b.date, b.btc_price, b.sth_cost_basis, b.sth_pvr,
         b.price_at_m100, b.price_at_m050, b.price_at_mean, b.price_at_p050,
         b.price_at_p100, b.price_at_p150, b.price_at_p200, b.price_at_p250
  FROM lth_pvr.sth_cb_bands_daily b
  WHERE b.org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
    AND (p_from IS NULL OR b.date >= p_from)
    AND (p_to   IS NULL OR b.date <= p_to)
  ORDER BY b.date;
$$;
GRANT EXECUTE ON FUNCTION public.get_sth_cb_bands_series(date, date) TO authenticated;

COMMENT ON TABLE lth_pvr.sth_cb_bands_daily IS 'band_source=sth_cb for the LTH PVR engine: mean = STH cost basis, ±σ per lth_pvr.sth_cb_band_params. Recomputed by _shared/sth_cb_bands_db.ts.';
