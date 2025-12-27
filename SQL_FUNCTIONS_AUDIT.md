# SQL Functions Secret Migration Audit

**Date**: December 28, 2024  
**Scope**: All PostgreSQL functions in `public` and `lth_pvr` schemas

## Executive Summary

Found **1 SQL function** requiring secret migration:
- `lth_pvr.ensure_ci_bands_today` - Uses old `service_role_key` vault secret

## Functions Requiring Updates

### 1. lth_pvr.ensure_ci_bands_today
**Location**: `supabase/functions/lth_pvr.ensure_ci_bands_today.fn.sql`  
**Issue**: References `service_role_key` from vault (line 22)  
**Required Change**: Update vault query to use `Secret Key` instead

**Current Code** (line 19-26):
```sql
-- Get service role key from vault
select decrypted_secret into v_service_key 
from vault.decrypted_secrets 
where name = 'service_role_key';

if v_service_key is null then
  raise exception 'service_role_key not found in vault';
end if;
```

**Updated Code**:
```sql
-- Get service role key from vault
select decrypted_secret into v_service_key 
from vault.decrypted_secrets 
where name = 'Secret Key';

if v_service_key is null then
  raise exception 'Secret Key not found in vault';
end if;
```

## Functions NOT Requiring Updates

The following SQL functions were analyzed and **do NOT** use API keys:

### lth_pvr Schema Functions (11 total)
1. ✅ `lth_pvr.alert_ack` - No secrets (JWT email extraction)
2. ✅ `lth_pvr.call_edge` - Uses `lth_pvr.settings` table (not vault)
3. ⚠️ `lth_pvr.ensure_ci_bands_today` - **NEEDS UPDATE** (uses vault)
4. ✅ `lth_pvr.fn_carry_add` - No secrets (ledger logic)
5. ✅ `lth_pvr.fn_carry_consume` - No secrets (ledger logic)
6. ✅ `lth_pvr.fn_carry_peek` - No secrets (ledger logic)
7. ✅ `lth_pvr.fn_next_invoice_number` - No secrets (sequence generator)
8. ✅ `lth_pvr.fn_round_financial` - No secrets (trigger function)
9. ✅ `lth_pvr.fn_round_or_null` - No secrets (math utility)
10. ✅ `lth_pvr.fn_usdt_available_for_trading` - No secrets (balance calc)
11. ✅ `lth_pvr.raise_alert` - No secrets (insert only)
12. ✅ `lth_pvr.recompute_bear_pause` - No secrets (signal processing)
13. ✅ `lth_pvr.upsert_ci_bands` - No secrets (UPSERT logic)
14. ✅ `lth_pvr.upsert_cron` - No secrets (cron management)

### public Schema Functions (59 total)
All functions in the `public` schema were reviewed:
- HTTP extension functions (`http_get`, `http_post`, etc.) - Utility functions, no secret storage
- SAB/DCA calculation functions - Pure business logic
- Authorization functions (`is_org_role`, `my_orgs`) - Uses auth.uid()
- Trigger functions - Data transformation only
- Security definer functions - Use table-based config, not hardcoded secrets

**Notable Functions**:
- `public.run_valr_balance_finalizer` - Reads from `app.config` table (not vault)
- `public.get_secret` - Reads from `private.app_secrets` table (not vault)
- `public.list_lth_alert_events` - Security definer, no secrets
- `public.resolve_lth_alert_event` - Security definer, no secrets

## Deployment Strategy

### Step 1: Verify Vault Secret Name
Confirm that Supabase Vault contains `Secret Key` secret (not `service_role_key`).

### Step 2: Update SQL Function
Deploy updated `lth_pvr.ensure_ci_bands_today` function using migration:

```sql
-- Migration: update_ensure_ci_bands_today_secret_reference
-- Updates vault secret reference from 'service_role_key' to 'Secret Key'

create or replace function lth_pvr.ensure_ci_bands_today()
returns void
language plpgsql
security definer
as $$
declare
  v_exists      boolean;
  v_target_date date := (now() at time zone 'UTC')::date - interval '1 day';

  v_org   uuid := 'b0a77009-03b9-44a1-ae1d-34f157d44a8b';
  v_mode  text := 'static';

  -- request_id returned by net.http_post(...)
  v_request_id bigint;
  
  -- service role key from vault
  v_service_key text;
begin
  -- Get service role key from vault (UPDATED: now uses 'Secret Key')
  select decrypted_secret into v_service_key 
  from vault.decrypted_secrets 
  where name = 'Secret Key';
  
  if v_service_key is null then
    raise exception 'Secret Key not found in vault';
  end if;
  
  --------------------------------------------------------------------
  -- 1) Check if yesterday already exists in lth_pvr.ci_bands_daily
  --------------------------------------------------------------------
  select exists (
    select 1
    from lth_pvr.ci_bands_daily
    where date   = v_target_date
      and mode   = v_mode
      and org_id = v_org
  )
  into v_exists;

  if v_exists then
    insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
    values (
      false,
      200,
      jsonb_build_object('info','row present','target_date', v_target_date)
    );
    return;
  end if;

  --------------------------------------------------------------------
  -- 2) Call ef_fetch_ci_bands ONLY if yesterday is missing
  --    Note: net.http_post is async and returns a request_id immediately
  --------------------------------------------------------------------
  v_request_id := net.http_post(
    url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_fetch_ci_bands',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object(
      'guard',  true,
      'org_id', v_org
    )
  );

  insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
  values (
    true,
    200,
    jsonb_build_object(
      'request_id',  v_request_id,
      'target_date', v_target_date
    )
  );

exception
  when others then
    insert into lth_pvr.ci_bands_guard_log(did_call, status, details)
    values (
      true,
      599,
      jsonb_build_object(
        'error',       sqlstate,
        'msg',         sqlerrm,
        'target_date', v_target_date
      )
    );
end;
$$;
```

### Step 3: Test Function
```sql
-- Test the updated function
SELECT lth_pvr.ensure_ci_bands_today();

-- Verify log entry
SELECT * FROM lth_pvr.ci_bands_guard_log ORDER BY created_at DESC LIMIT 1;
```

## Additional Notes

### Vault vs. Table-Based Config
- **Vault Secrets**: Used by `lth_pvr.ensure_ci_bands_today` for service role key
- **Table-Based Config**: Used by `lth_pvr.call_edge` (reads `lth_pvr.settings`)
- **Edge Functions**: Now use `Deno.env.get("Secret Key")` (environment variables)

### Security Considerations
1. SQL functions use vault for secrets (encrypted at rest)
2. Edge Functions use Supabase environment secrets (project settings)
3. Both approaches are secure; vault is PostgreSQL-native, env vars are Deno-native

## Completion Checklist
- [x] Verify `Secret Key` exists in Supabase Vault - **ISSUE FOUND**: vault has `service_role_key`, not `Secret Key`
- [x] Apply migration to update `lth_pvr.ensure_ci_bands_today` - **COMPLETED**
- [ ] **CRITICAL**: Update vault secret name from `service_role_key` to `Secret Key`
- [ ] Test function execution
- [ ] Monitor `ci_bands_guard_log` for errors
- [x] Update local SQL file in git repo - **COMPLETED**

## IMPORTANT: Vault Secret Migration Required

**Current State**: 
- SQL function updated to use `'Secret Key'` ✅
- Vault still contains `'service_role_key'` ❌
- **Function will fail** until vault is updated

**Required Action**:
The user must manually update the vault secret in Supabase Dashboard:

1. Go to: https://supabase.com/dashboard/project/wqnmxpooabmedvtackji/settings/vault/secrets
2. Option A: Rename existing secret:
   - Find `service_role_key` 
   - Delete it
   - Create new secret named `Secret Key` with same value
3. Option B: Create duplicate (safer):
   - Create new secret named `Secret Key` with service role key value
   - Test function
   - Delete old `service_role_key` after verification

**Note**: Vault secrets cannot be renamed via SQL or MCP tools - manual dashboard update required.

