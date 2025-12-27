# Secret Key Migration Summary

**Date:** 2025-12-27  
**Status:** ✅ Code Updated - Ready for Deployment

---

## Changes Made

### 1. Environment Variable Renames

All Edge Functions and code have been updated to use the new Supabase secret names:

| Old Name | New Name | Type | Usage |
|----------|----------|------|-------|
| `SUPABASE_SERVICE_ROLE_KEY` | `Secret Key` | Server-side | Edge Functions (backend) |
| `SB_SERVICE_ROLE_KEY` | `Secret Key` | Server-side | Edge Functions (legacy fallback) |
| `SUPABASE_ANON_KEY` | `Publishable Key` | Client-side | HTML UI (frontend) |

### 2. Files Updated (29 Edge Functions)

#### Edge Functions with client.ts Updated:
1. **ef_alert_digest** - client.ts
2. **ef_bt_execute** - client.ts
3. **ef_create_order_intents** - client.ts
4. **ef_execute_orders** - client.ts + index.ts
5. **ef_fee_invoice_email** - client.ts
6. **ef_fee_monthly_close** - client.ts
7. **ef_fetch_ci_bands** - client.ts
8. **ef_generate_decisions** - client.ts
9. **ef_post_ledger_and_balances** - client.ts
10. **ef_std_dca_roll** - client.ts
11. **ef_valr_deposit_scan** - client.ts
12. **ef_valr_ws_monitor** - client.ts + index.ts

#### Edge Functions with index.ts Only:
13. **admin-create-user** - index.ts
14. **adv-build-transactions** - index.ts
15. **chart-narrative** - index.ts
16. **create-daily-rules** - index.ts
17. **ef_poll_orders** - index.ts
18. **real-txs-allocate-deposits** - index.ts
19. **real-txs-extract** - index.ts
20. **real-txs-sync-valr** - index.ts
21. **std-build-transactions** - index.ts
22. **valr-balance-finalizer** - index.ts
23. **valr-balances** - index.ts
24. **valr-convert-zar** - index.ts
25. **valr-execute-orders** - index.ts
26. **valr-fees-harvester** - index.ts
27. **valr-poll-orders** - index.ts
28. **valr-preview-orders** - index.ts

#### No Changes Needed:
29. **ef_valr_subaccounts** - No secret key references

#### UI Files:
- **ui/Advanced BTC DCA Strategy.html** - Updated to use `PUBLISHABLE_KEY` (placeholder - needs actual key value)

### 3. Documentation Files Updated

- **docs/SDD_v0.6.md** - Updated secret references to placeholders
- **docs/WebSocket_Order_Monitoring_Implementation.md** - References in comments
- **SECURITY_REMEDIATION.md** - Updated guidance

---

## Deployment Instructions

### Step 1: Verify Supabase Secrets are Set

Make sure you've set the new secrets in Supabase Dashboard:

```bash
# Check current secrets (if possible)
supabase secrets list --project-ref wqnmxpooabmedvtackji

# Set the new secrets (if not already done)
supabase secrets set "Secret Key"="your-new-service-role-key" --project-ref wqnmxpooabmedvtackji
supabase secrets set "Publishable Key"="your-new-publishable-key" --project-ref wqnmxpooabmedvtackji
supabase secrets set RESEND_API_KEY="your-new-resend-key" --project-ref wqnmxpooabmedvtackji
```

### Step 2: Update HTML File with Actual Publishable Key

**Important:** Before deploying the UI, replace the placeholder in `ui/Advanced BTC DCA Strategy.html`:

```html
<!-- Line 2147 - Replace this: -->
const PUBLISHABLE_KEY = 'YOUR_NEW_PUBLISHABLE_KEY_HERE';

<!-- With your actual new publishable key from Supabase Dashboard -->
const PUBLISHABLE_KEY = 'sb_publishable_xxxxxxxxxxxxx';
```

### Step 3: Deploy All Edge Functions

Run the deployment script:

```powershell
cd C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr
.\redeploy-all-functions.ps1
```

**OR** deploy manually one by one:

```powershell
cd C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr

supabase functions deploy ef_execute_orders --project-ref wqnmxpooabmedvtackji
supabase functions deploy ef_poll_orders --project-ref wqnmxpooabmedvtackji
supabase functions deploy ef_valr_ws_monitor --project-ref wqnmxpooabmedvtackji
# ... repeat for all 29 functions
```

### Step 4: Verify Deployments

Check that all functions are working:

```powershell
# List all functions and verify versions increased
supabase functions list --project-ref wqnmxpooabmedvtackji

# Test a critical function
supabase functions invoke ef_generate_decisions --project-ref wqnmxpooabmedvtackji
```

### Step 5: Monitor for Errors

After deployment, check the logs for any authentication errors:

```powershell
# Check logs for errors
supabase functions logs ef_execute_orders --project-ref wqnmxpooabmedvtackji
supabase functions logs ef_poll_orders --project-ref wqnmxpooabmedvtackji
```

---

## Verification Checklist

- [ ] New `Secret Key` secret set in Supabase Dashboard
- [ ] New `Publishable Key` secret set in Supabase Dashboard
- [ ] New `RESEND_API_KEY` set in Supabase Dashboard
- [ ] Old `SUPABASE_SERVICE_ROLE_KEY` removed/disabled in Supabase
- [ ] Old `SUPABASE_ANON_KEY` disabled in Supabase
- [ ] Old `RESEND_API_KEY` revoked in Resend dashboard
- [ ] HTML file updated with actual new publishable key value
- [ ] All 29 Edge Functions redeployed successfully
- [ ] No authentication errors in function logs
- [ ] UI can connect to Supabase with new publishable key
- [ ] Test order placement works end-to-end
- [ ] WebSocket monitoring functions with new keys
- [ ] Alert digest email sending works

---

## Rollback Plan

If deployment fails:

1. **Restore old secrets temporarily:**
   ```bash
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY="old-key" --project-ref wqnmxpooabmedvtackji
   ```

2. **Revert code changes:**
   ```bash
   git checkout HEAD~1 supabase/functions/
   ```

3. **Redeploy with old code:**
   ```bash
   ./redeploy-all-functions.ps1
   ```

---

## Post-Deployment Testing

Test these critical workflows:

1. **Order Execution Flow:**
   - Generate decisions → Create intents → Execute orders → Poll orders
   - Verify WebSocket monitoring triggers

2. **Alert System:**
   - Trigger test alert
   - Verify email digest sends

3. **UI Access:**
   - Load HTML file in browser
   - Verify Supabase connection
   - Check daily data loads

4. **Background Jobs:**
   - Check cron jobs still running
   - Verify scheduled functions execute

---

## Notes

- The `Secret Key` name includes a space - ensure it's quoted in shell commands
- The `Publishable Key` is meant for client-side use (HTML UI)
- All server-side functions use `Secret Key` (service role equivalent)
- Some older functions had both `SB_SERVICE_ROLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` fallbacks - now unified to `Secret Key`

---

**Migration Completed:** 2025-12-27  
**Ready for Deployment:** ✅ YES
