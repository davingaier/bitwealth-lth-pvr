-- 20260704_enable_rls_onchain_pvr.sql
-- =============================================================================
-- Harden the On-Chain PVR tables: enable RLS with no policies.
-- Direct PostgREST access by anon/authenticated is denied; the UI reads only
-- via public.get_onchain_pvr_series_json() (SECURITY DEFINER, bypasses RLS)
-- and the edge function writes via the service role (also bypasses RLS).
-- =============================================================================
alter table lth_pvr.onchain_pvr_daily enable row level security;
alter table lth_pvr.onchain_pvr_state enable row level security;
