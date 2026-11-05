-- supabase/sql/incident_20261105_rotate_keys.sql
-- ===========================================================================
-- 2026-11-05 incident: the legacy JWT `service_role` key was stolen (used from a Linux/Chrome host to read
-- vault-backed VALR credentials via get_customer_valr_credentials and to insert a withdrawal_requests row).
-- Legacy keys cannot be rotated — they are DISABLED in Settings → API Keys → Legacy tab, and every stored copy
-- is replaced by the new opaque `sb_secret_...` key (plus `sb_publishable_...` where the anon key was stored).
--
-- RUN THIS IN THE SUPABASE SQL EDITOR (Phase 2), replacing the two placeholders. Never commit real values.
--   __NEW_SECRET__      = the new sb_secret_... key created in Settings → API Keys
--   __NEW_PUBLISHABLE__ = the project's sb_publishable_... key
-- Order: deploy the migrated Edge Functions first (Phase 1) → run this (Phase 2) → disable legacy keys (Phase 3).
-- ===========================================================================

-- 1. pg_cron jobs that read the vault ---------------------------------------------------------------
--    service_jwt                → 14 jobs (alert digest/triage, fees, statements, partner, resume pipeline, …)
--    SUPABASE_SERVICE_ROLE_KEY  → 10 jobs (poll_orders ×6, poll_zar, fic monitors, marketing refresh)
--    ef_auth_header             → vault copy of the Bearer header
--    Secret Key                 → lth_pvr.ensure_rb_bands_today (was an older sb_secret — replaced as a precaution)
select vault.update_secret((select id from vault.secrets where name = 'service_jwt'),               '__NEW_SECRET__');
select vault.update_secret((select id from vault.secrets where name = 'SUPABASE_SERVICE_ROLE_KEY'), '__NEW_SECRET__');
select vault.update_secret((select id from vault.secrets where name = 'ef_auth_header'),            'Bearer __NEW_SECRET__');
select vault.update_secret((select id from vault.secrets where name = 'Secret Key'),                '__NEW_SECRET__');

-- 2. lth_pvr.call_edge() → 7 jobs + sth_cb.ensure_pipeline_today ------------------------------------
update lth_pvr.settings set val = 'Bearer __NEW_SECRET__' where key = 'ef_auth_header';

-- 3. public.get_secret() → real-txs-sync-valr-daily -------------------------------------------------
update private.app_secrets set value = '__NEW_SECRET__'      where key = 'service_jwt';
update private.app_secrets set value = '__NEW_PUBLISHABLE__' where key = 'anon_key';

-- 4. public.run_valr_balance_finalizer() → valr_balance_finalizer_23_55_utc ------------------------
update app.config set value = '__NEW_SECRET__' where key = 'service_role';

-- 5. (removed) annual-fee-collection / deposit-scan-hourly already read vault 'service_jwt' (covered by step 1).
--    NOTE: `ALTER DATABASE … SET` is not permitted for the postgres role on Supabase — never use DB-level GUCs
--    for secrets here. The SQL Editor runs a script as ONE transaction, so a failing statement rolls back the lot.

-- 6. Verification (no secrets printed) -------------------------------------------------------------
select name, case when decrypted_secret like 'sb_secret_%' or decrypted_secret like 'Bearer sb_secret_%' then 'sb_secret ✓'
                  when decrypted_secret like '%eyJ%' then 'LEGACY JWT ✗' else 'other' end as state
from vault.decrypted_secrets where name in ('service_jwt','SUPABASE_SERVICE_ROLE_KEY','ef_auth_header','Secret Key')
union all
select 'lth_pvr.settings.ef_auth_header', case when val like 'Bearer sb_secret_%' then 'sb_secret ✓' else 'LEGACY ✗' end from lth_pvr.settings where key='ef_auth_header'
union all
select 'private.app_secrets.'||key, case when value like 'sb_%' then 'sb_ ✓' else 'LEGACY ✗' end from private.app_secrets where key in ('service_jwt','anon_key')
union all
select 'app.config.service_role', case when value like 'sb_secret_%' then 'sb_secret ✓' else 'LEGACY ✗' end from app.config where key='service_role';

-- 7. After Phase 3/4 verification, re-enable the withdrawal queue (paused during the incident):
-- select cron.schedule('lthpvr_withdrawal_queue', '*/5 * * * *', $$select lth_pvr.call_edge('ef_process_withdrawal_queue', '{}'::jsonb);$$);
