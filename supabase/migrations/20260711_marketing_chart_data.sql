-- 20260711_marketing_chart_data.sql
--
-- Backs the LTH PVR product-page charts (website/lth-pvr.html) with a live,
-- self-refreshing 5-year back-test instead of a hard-coded data blob.
--
-- Pieces:
--   1. public.marketing_chart_data      — one cached payload row per chart_key.
--   2. public.get_lth_pvr_marketing_chart() — anonymous reader for the website.
--   3. pg_cron 'lth_pvr_refresh_marketing_5yr' — 1st of each month @ 03:00 UTC,
--      fires ef_refresh_marketing_charts which runs the trailing-5yr back-test
--      (USDPC enabled, one-pager fee model) and upserts the payload here.
--
-- The refresh edge function is what actually computes the numbers (it reuses the
-- same ef_bt_execute engine as the public back-tester, so the site correlates
-- with the one-pager). This migration only creates the storage, reader and cron.

-- ── 1. Cache table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_chart_data (
  chart_key     text PRIMARY KEY,
  status        text NOT NULL DEFAULT 'pending',   -- pending | running | ready | error
  bt_run_id     uuid,
  request_id    uuid,
  window_start  date,
  window_end    date,
  params        jsonb,
  payload       jsonb,
  error_message text,
  generated_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketing_chart_data IS
  'Cached back-test series for public marketing pages. One row per chart_key. '
  'Written by ef_refresh_marketing_charts; read anonymously via '
  'public.get_lth_pvr_marketing_chart().';

-- Only the SECURITY DEFINER reader function and the service role (which bypasses
-- RLS) may touch the table. Enable RLS with no anon/authenticated policies.
ALTER TABLE public.marketing_chart_data ENABLE ROW LEVEL SECURITY;

-- ── 2. Anonymous reader for the website ────────────────────────────────────────
-- Returns only the ready payload for the LTH PVR 5-year chart. SECURITY DEFINER
-- so the website's anon role can read past RLS without any table grant.
CREATE OR REPLACE FUNCTION public.get_lth_pvr_marketing_chart()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'status',       m.status,
    'generated_at', m.generated_at,
    'window_start', m.window_start,
    'window_end',   m.window_end,
    'params',       m.params,
    'payload',      m.payload
  )
  FROM public.marketing_chart_data m
  WHERE m.chart_key = 'lth_pvr_5yr'
    AND m.status = 'ready';
$$;

COMMENT ON FUNCTION public.get_lth_pvr_marketing_chart() IS
  'Public reader for the LTH PVR 5-year marketing chart payload (NAV/ROI weekly '
  'series + summary + narrative figures). Returns NULL until first refresh.';

REVOKE ALL ON FUNCTION public.get_lth_pvr_marketing_chart() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lth_pvr_marketing_chart() TO anon, authenticated;

-- ── 3. Seed row so the first refresh just updates it ───────────────────────────
INSERT INTO public.marketing_chart_data (chart_key, status)
VALUES ('lth_pvr_5yr', 'pending')
ON CONFLICT (chart_key) DO NOTHING;

-- ── 4. Monthly refresh cron (1st of month @ 03:00 UTC) ─────────────────────────
-- cron.schedule(name, ...) upserts by unique job name, so re-running this
-- migration re-points the same job. Auth uses the vault service-role secret —
-- the only pattern that works on this managed Postgres (the app.settings GUC is
-- unset; see SDD v0.5.x cron-auth incident).
SELECT cron.schedule(
  'lth_pvr_refresh_marketing_5yr',
  '0 3 1 * *',
  $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_refresh_marketing_charts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
  $$
);
