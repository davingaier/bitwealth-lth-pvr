# VALR Omnibus Migration Plan — Clean Slate

**Date Created:** 2026-03-03  
**Migration Type:** Clean-slate — delete all test customers and transactional data, swap VALR API key to new omnibus production account  
**Estimated Duration:** 20–30 minutes  
**Best Window:** Outside 03:00–17:00 UTC (avoid active pipeline window)

---

## Decisions Confirmed

| Item | Decision |
|---|---|
| All 22 test customers | DELETE (except Customer 49) |
| Customer 49 — Tremyne Naidoo | **KEEP** (real prospect, no transactional data) |
| `mare@gronkhvz.net` auth user | DELETE (bot/spam signup, no customer record) |
| `davin.gaier@gmail.com` auth user | **KEEP** (org owner, sole org_member) |
| `davin.gaier@bitwealth.co.za` auth user | **KEEP** (active admin user, confirmed by user) |
| CI bands data (`lth_pvr.ci_bands_daily`) | **KEEP** |
| Back-test schema (`lth_pvr_bt.*`) | **KEEP** |
| Strategy variation templates | **KEEP** (Progressive / Balanced / Conservative seeded rows) |
| Alert events, guard log, transfer log | TRUNCATE (clear contents, keep table) |
| DB update timing | DB first → then Supabase secrets |
| Rollback | Not required |

---

## What Changes on the Cron Schedule

**No cron job changes needed after migration** — all VALR calls read `VALR_API_KEY`/`VALR_API_SECRET` from edge function environment (Supabase secrets vault), not from DB or cron job commands.  
Action: temporarily disable VALR-dependent jobs during maintenance window only.

---

## PHASE 0 — Pre-Flight Checklist

- [ ] Confirm you are **outside 03:00–17:00 UTC** (or accept that pipeline will fire against empty DB — safe but noisy)
- [ ] Have the **new VALR omnibus API key and secret** ready to paste
- [ ] Have the **Supabase CLI** available (`supabase` in terminal, connected to project `wqnmxpooabmedvtackji`)
- [ ] Open the **Supabase SQL Editor** or use MCP
- [ ] Notify any team members that the system is in maintenance

---

## PHASE 1 — Disable VALR-Touching Cron Jobs

Run in Supabase SQL Editor. This prevents order polling and deposit scans from hitting VALR during the credential swap.

```sql
-- PHASE 1: Disable VALR-dependent cron jobs
SELECT cron.unschedule('lth_pvr_resume_pipeline_morning');  -- job 27
SELECT cron.unschedule('lth_pvr_resume_pipeline_guard');    -- job 28
SELECT cron.unschedule('deposit-scan-hourly');              -- job 31
SELECT cron.unschedule('poll-orders-1min');                 -- job 46
SELECT cron.unschedule('sync-valr-transactions-every-30-min'); -- job 48
SELECT cron.unschedule('lth_market_fallback_00s');          -- job 50
SELECT cron.unschedule('lth_market_fallback_10s');          -- job 51
SELECT cron.unschedule('lth_market_fallback_20s');          -- job 52
SELECT cron.unschedule('lth_market_fallback_30s');          -- job 53
SELECT cron.unschedule('lth_market_fallback_40s');          -- job 54
SELECT cron.unschedule('lth_market_fallback_50s');          -- job 55
```

**Verify:** `SELECT jobname, active FROM cron.job ORDER BY jobid;` — the above jobs should now be gone (unscheduled = removed from table).

> **NOTE:** `cron.unschedule` removes the job entirely. See Phase 6 for re-scheduling commands.

- [ ] All 11 VALR jobs unscheduled ✓

---

## PHASE 2 — Database Cleanup

Run the script below **in a single transaction** in Supabase SQL Editor. This handles FK ordering automatically via explicit delete order.

```sql
-- =============================================================
-- VALR OMNIBUS MIGRATION — DATABASE CLEANUP
-- Run: 2026-03-03  Project: wqnmxpooabmedvtackji
-- KEEP: ci_bands_daily, lth_pvr_bt.*, strategy_variation_templates
-- KEEP: customer_id = 49 (Tremyne Naidoo), auth users x2
-- =============================================================

BEGIN;

-- ---------------------------------------------------------------
-- 2A. Clear operational logs (keep table structure)
-- ---------------------------------------------------------------
TRUNCATE lth_pvr.alert_events;
TRUNCATE lth_pvr.ci_bands_guard_log;
TRUNCATE lth_pvr.valr_transfer_log;

-- ---------------------------------------------------------------
-- 2B. Delete lth_pvr transactional data (FK order)
-- ---------------------------------------------------------------

-- Order execution chain (leaf → root)
DELETE FROM lth_pvr.order_fills;
DELETE FROM lth_pvr.exchange_orders;
DELETE FROM lth_pvr.order_intents;
DELETE FROM lth_pvr.decisions_daily;

-- Accounting
DELETE FROM lth_pvr.ledger_lines;
DELETE FROM lth_pvr.balances_daily;
DELETE FROM lth_pvr.customer_state_daily;

-- Funding & conversions
DELETE FROM lth_pvr.exchange_funding_events;
DELETE FROM lth_pvr.pending_zar_conversions;
DELETE FROM lth_pvr.carry_buckets;

-- Fees
DELETE FROM lth_pvr.customer_accumulated_fees;
DELETE FROM lth_pvr.fee_conversion_approvals;
DELETE FROM lth_pvr.fees_monthly;
DELETE FROM lth_pvr.fee_invoices;
DELETE FROM lth_pvr.withdrawal_fee_snapshots;

-- STD DCA
DELETE FROM lth_pvr.std_dca_balances_daily;
DELETE FROM lth_pvr.std_dca_ledger;

-- ---------------------------------------------------------------
-- 2C. Delete public schema customer data
--     EXCLUDE customer_id = 49 (Tremyne Naidoo — real prospect)
-- ---------------------------------------------------------------

-- Agreements (keep C49's agreement rows if any)
DELETE FROM public.customer_agreements WHERE customer_id <> 49;

-- Withdrawal requests
DELETE FROM public.withdrawal_requests;

-- Customer strategies (keep C49 if any exist)
DELETE FROM public.customer_strategies WHERE customer_id <> 49;

-- Exchange accounts — all org-scoped, no customer_id, DELETE ALL
-- (C49 has no exchange account — still at KYC stage)
DELETE FROM public.exchange_accounts
WHERE org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';

-- Customer details — delete all except C49
DELETE FROM public.customer_details WHERE customer_id <> 49;

-- ---------------------------------------------------------------
-- 2D. Public tables that may have test data (handle if-exists)
-- ---------------------------------------------------------------

-- ADV DCA (may or may not exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema='public' AND table_name='adv_dca_customer_transactions') THEN
    DELETE FROM public.adv_dca_customer_transactions;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema='public' AND table_name='std_dca_customer_transactions') THEN
    DELETE FROM public.std_dca_customer_transactions;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema='public' AND table_name='adv_dca_buy_sell_rules') THEN
    DELETE FROM public.adv_dca_buy_sell_rules;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema='public' AND table_name='exchange_daily_balances') THEN
    DELETE FROM public.exchange_daily_balances;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema='public' AND table_name='exchange_order_intents') THEN
    DELETE FROM public.exchange_order_intents;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables 
             WHERE table_schema='public' AND table_name='real_exchange_txs') THEN
    DELETE FROM public.real_exchange_txs;
  END IF;
END $$;

COMMIT;
```

- [ ] Script ran without errors ✓

---

## PHASE 2E — Verify Row Counts

Run after the script to confirm cleanup:

```sql
-- Verify: transactional tables should all be 0 (or close)
SELECT 'lth_pvr.exchange_orders'         AS tbl, COUNT(*) FROM lth_pvr.exchange_orders       UNION ALL
SELECT 'lth_pvr.order_fills'             AS tbl, COUNT(*) FROM lth_pvr.order_fills           UNION ALL
SELECT 'lth_pvr.order_intents'           AS tbl, COUNT(*) FROM lth_pvr.order_intents         UNION ALL
SELECT 'lth_pvr.decisions_daily'         AS tbl, COUNT(*) FROM lth_pvr.decisions_daily       UNION ALL
SELECT 'lth_pvr.ledger_lines'            AS tbl, COUNT(*) FROM lth_pvr.ledger_lines          UNION ALL
SELECT 'lth_pvr.balances_daily'          AS tbl, COUNT(*) FROM lth_pvr.balances_daily        UNION ALL
SELECT 'lth_pvr.exchange_funding_events' AS tbl, COUNT(*) FROM lth_pvr.exchange_funding_events UNION ALL
SELECT 'lth_pvr.pending_zar_conversions' AS tbl, COUNT(*) FROM lth_pvr.pending_zar_conversions UNION ALL
SELECT 'lth_pvr.fees_monthly'            AS tbl, COUNT(*) FROM lth_pvr.fees_monthly          UNION ALL
SELECT 'lth_pvr.alert_events'            AS tbl, COUNT(*) FROM lth_pvr.alert_events          UNION ALL
SELECT 'lth_pvr.ci_bands_guard_log'      AS tbl, COUNT(*) FROM lth_pvr.ci_bands_guard_log   UNION ALL
SELECT 'lth_pvr.valr_transfer_log'       AS tbl, COUNT(*) FROM lth_pvr.valr_transfer_log    UNION ALL
SELECT 'public.customer_details'         AS tbl, COUNT(*) FROM public.customer_details       UNION ALL
SELECT 'public.exchange_accounts'        AS tbl, COUNT(*) FROM public.exchange_accounts      UNION ALL
SELECT 'public.customer_strategies'      AS tbl, COUNT(*) FROM public.customer_strategies    UNION ALL
SELECT 'public.customer_agreements'      AS tbl, COUNT(*) FROM public.customer_agreements    UNION ALL
-- These should still have data:
SELECT 'lth_pvr.ci_bands_daily (KEEP)'            AS tbl, COUNT(*) FROM lth_pvr.ci_bands_daily           UNION ALL
SELECT 'lth_pvr.strategy_variation_templates (KEEP)' AS tbl, COUNT(*) FROM lth_pvr.strategy_variation_templates
ORDER BY tbl;
```

**Expected results:**
| Table | Expected Count |
|---|---|
| All transactional tables | 0 |
| `public.customer_details` | 1 (C49 Tremyne) |
| `public.exchange_accounts` | 0 |
| `public.customer_strategies` | 0 (C49 has none at KYC stage) |
| `public.customer_agreements` | ≥0 (C49's agreements if any) |
| `lth_pvr.ci_bands_daily` | ~5,708 ✓ |
| `lth_pvr.strategy_variation_templates` | 3 ✓ |

- [ ] All transactional tables show 0 rows ✓
- [ ] `customer_details` = 1 (C49 only) ✓
- [ ] `ci_bands_daily` ≈ 5,708 (untouched) ✓
- [ ] `strategy_variation_templates` = 3 (untouched) ✓

---

## PHASE 3 — Delete Test Auth Users

Run via Supabase SQL Editor (requires service role access to auth schema):

```sql
-- PHASE 3: Delete test auth users
-- KEEP: davin.gaier@gmail.com (e59f55b0-16ef-4ed4-b068-2edf34928649) — org owner
-- KEEP: davin.gaier@bitwealth.co.za (9fa37b76-a983-4672-9d2d-6de1354ff8e0)
-- DELETE: all other 8 test auth users

DELETE FROM auth.users
WHERE email NOT IN (
  'davin.gaier@gmail.com',
  'davin.gaier@bitwealth.co.za'
);
```

This deletes:
- `kyc.approved@example.com`
- `jemaicagaier@gmail.com`
- `integration.test@example.com`
- `rainerg@axxess.co.za`
- `dev.test@bitwealth.co.za`
- `mare@gronkhvz.net`
- `dev.test02@bitwealth.co.za`
- `dev.test03@bitwealth.co.za`

**Verify:**
```sql
SELECT email, created_at FROM auth.users ORDER BY created_at;
-- Should show exactly 2 rows: davin.gaier@gmail.com + davin.gaier@bitwealth.co.za
```

- [ ] 2 auth users remaining ✓

---

## PHASE 4 — Update VALR API Credentials

Run from PowerShell terminal in the workspace root:

```powershell
# PHASE 4: Update VALR credentials in Supabase secrets
# Replace the values below with the actual new omnibus API key and secret

supabase secrets set `
  VALR_API_KEY="<NEW_OMNIBUS_API_KEY>" `
  VALR_API_SECRET="<NEW_OMNIBUS_API_SECRET>" `
  --project-ref wqnmxpooabmedvtackji
```

**Then verify the key is accepted by VALR:**

```powershell
# Call ef_valr_health or ef_debug_zar_state to confirm new key works
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_debug_zar_state `
  -H "Authorization: Bearer $(supabase --project-ref wqnmxpooabmedvtackji secrets list | grep service)" `
  -H "Content-Type: application/json" `
  -d '{}'
```

Or call `ef_debug_personal_subaccount` from the Admin UI if the raw curl is tricky — it will immediately fail with 401 if the key is wrong.

> **What the new key needs on VALR:**  
> - Trade (place/cancel orders)  
> - Sub-accounts (create subaccounts, route per-customer)  
> - Wallets (get deposit addresses)  
> - Transfer (internal transfers for fee collection)  
> - Read (balances, transactions)

- [ ] `supabase secrets set` ran without errors ✓
- [ ] New API key confirmed working via VALR API test call ✓

---

## PHASE 5 — Re-Enable Cron Jobs

Re-create the 11 jobs that were unscheduled in Phase 1:

```sql
-- PHASE 5: Re-enable VALR-dependent cron jobs

-- Primary pipeline trigger (05:05 UTC daily)
SELECT cron.schedule(
  'lth_pvr_resume_pipeline_morning',
  '5 5 * * *',
  $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_jwt')
      ),
      body := jsonb_build_object()
    );
  $$
);

-- Pipeline guard (every 30 min, 03:00-16:00 UTC)
SELECT cron.schedule(
  'lth_pvr_resume_pipeline_guard',
  '*/30 3-16 * * *',
  $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_jwt')
      ),
      body := jsonb_build_object()
    );
  $$
);

-- Deposit scanner (hourly)
SELECT cron.schedule(
  'deposit-scan-hourly',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_deposit_scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Order poller (every 1 min, 03:00-16:00 UTC)
SELECT cron.schedule(
  'poll-orders-1min',
  '*/1 3-16 * * *',
  $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_poll_orders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
  $$
);

-- VALR transaction sync (every 30 min)
SELECT cron.schedule(
  'sync-valr-transactions-every-30-min',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_sync_valr_transactions',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object()
    );
  $$
);

-- Market fallback jobs (staggered, every 1 min, 03:00-16:00 UTC)
SELECT cron.schedule('lth_market_fallback_00s', '*/1 3-16 * * *', $$
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_market_fallback',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('lth_market_fallback_10s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(10);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_market_fallback',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('lth_market_fallback_20s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(20);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_market_fallback',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('lth_market_fallback_30s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(30);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_market_fallback',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('lth_market_fallback_40s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(40);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_market_fallback',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('lth_market_fallback_50s', '*/1 3-16 * * *', $$
  SELECT pg_sleep(50);
  SELECT net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_market_fallback',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb);
$$);
```

**Verify all 11 jobs are back:**
```sql
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
```

- [ ] All 11 cron jobs re-created ✓

---

## PHASE 6 — Post-Migration System Verification

### 6A. Confirm New VALR API Key Works

From Admin UI → Administration module, or via direct function call:

```powershell
# Test: list VALR subaccounts (should return empty array on new omnibus account)
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_list_valr_subaccounts `
  -H "Authorization: Bearer <SERVICE_ROLE_JWT>" `
  -H "Content-Type: application/json" `
  -d '{}'
```

Expected: `[]` or empty subaccount list (new account, no subaccounts yet)

- [ ] VALR subaccount list returns successfully with new key ✓

### 6B. Confirm CI Bands Still Flowing

```sql
SELECT trade_date, band_1_lower, band_1_upper
FROM lth_pvr.ci_bands_daily
ORDER BY trade_date DESC
LIMIT 3;
```

Expected: Recent dates visible, no gap.

- [ ] CI bands data intact ✓

### 6C. Confirm Strategy Variation Templates Intact

```sql
SELECT variation_id, name, description FROM lth_pvr.strategy_variation_templates;
```

Expected: 3 rows — Progressive, Balanced, Conservative

- [ ] 3 variation templates present ✓

### 6D. Confirm Customer 49 Preserved

```sql
SELECT customer_id, first_names, last_name, email, registration_status, created_at
FROM public.customer_details
WHERE customer_id = 49;
```

Expected: 1 row — Tremyne Naidoo, status='kyc'

- [ ] Tremyne Naidoo row exists ✓

### 6E. Confirm Admin Auth Users

```sql
SELECT email, created_at, last_sign_in_at FROM auth.users ORDER BY created_at;
```

Expected: Exactly 2 rows — `davin.gaier@gmail.com` + `davin.gaier@bitwealth.co.za`

- [ ] Exactly 2 admin auth users ✓

---

## PHASE 7 — Onboard First Real Customer

When ready (can happen days after migration):

1. **Admin UI → Customer Maintenance**
2. Follow 6-milestone workflow:
   - M1: Create customer record (name, email, agreements)
   - M2: Assign strategy + variation (Progressive/Balanced/Conservative)
   - M3: Upload KYC documents (4 docs: ID, proof of address, source of income, bank confirmation)
   - M4: Create VALR subaccount via Admin UI → `ef_create_valr_subaccount` (new subaccount on omnibus account)
   - M5: Customer deposits ZAR → pipeline detects via `ef_deposit_scan`
   - M6: Pipeline activates customer
3. Confirm new `exchange_accounts` row has:
   - New `subaccount_id` from omnibus account
   - `deposit_ref` assigned (new format from new account)
   - `is_omnibus = true` flag (should already be default)

---

## Phase 7B — Onboarding Tremyne Naidoo

Tremyne (customer 49) is already at KYC stage in the system. When her KYC is approved:

1. Skip M1 (she already exists in `customer_details`)
2. **Complete M2:** Assign strategy + variation via Admin UI
3. **Complete M3:** Confirm KYC docs uploaded (all 4: `kyc_id_url`, `kyc_proof_address_url`, `kyc_source_of_income_doc_url`, `kyc_bank_confirmation_url`)
4. **M4:** Create VALR subaccount for her on the new omnibus account
5. **M5/M6:** Normal deposit and activation flow

She will need to **create a portal account** (self-register at the portal URL) since she has no auth user yet — or invite her via Admin UI if that feature exists.

---

## Summary — What Was Deleted vs Kept

| Category | Action | Notes |
|---|---|---|
| 21 test customers | DELETED | All except C49 |
| C49 Tremyne Naidoo | KEPT | Real prospect at KYC stage |
| 10 exchange_accounts | DELETED | All old test VALR subaccounts |
| 11 customer_strategies | DELETED | All test strategies |
| 8 test auth users | DELETED | Including mare@gronkhvz.net bot |
| 2 admin auth users | KEPT | davin@gmail + davin@bitwealth.co.za |
| lth_pvr transactional tables | DELETED | 15+ tables cleared |
| alert_events | TRUNCATED | Was 15,887 rows |
| ci_bands_guard_log | TRUNCATED | Was 3,600 rows |
| valr_transfer_log | TRUNCATED | Was 66 rows |
| ci_bands_daily | KEPT | 5,708 rows intact |
| strategy_variation_templates | KEPT | 3 seeded rows intact |
| lth_pvr_bt.* | KEPT | All back-test data |
| All cron jobs | KEPT | Temporarily disabled, then re-enabled |
| Edge functions | KEPT | No changes needed |
| VALR API key | UPDATED | New omnibus production key |

---

## Notes on New Features (since Feb 17, 2026)

These are in production and **work correctly after migration** without any additional changes:

1. **Strategy Optimizer** — browser-based, uses `strategy_variation_templates` (kept), no VALR dependency
2. **4-Document KYC** — `ef_upload_kyc_documents` supports all 4 doc types; new columns on `customer_details` are schema-present and apply to C49
3. **Market Fallback** — replaces WebSocket monitoring; 6 staggered cron jobs (re-enabled in Phase 5)
4. **`ef_run_lth_pvr_simulator`** — no VALR dependency; unaffected by migration

---

*Last updated: 2026-03-03*
