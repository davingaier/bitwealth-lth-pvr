# Alert Digest Setup Documentation

## Overview
The `ef_alert_digest` Edge Function sends daily email summaries of unresolved error/critical alerts.

## Configuration

### Email Settings
- **Resend API Key**: `re_ZUoZ9aRn_LUxV8exouZvKXNW7xYk6jXYc`
- **From Address**: `alerts@bitwealth.co.za`
- **To Address**: `davin.gaier@gmail.com`

### Schedule
- **Cron Expression**: `0 5 * * *` (daily at 05:00 UTC / 07:00 SAST)
- **Cron Job ID**: 22
- **Job Name**: `lth_pvr_alert_digest_daily`
- **Next Run**: 2025-12-28 05:00:00 UTC (07:00 SAST)

## Edge Function Details
- **Function Name**: `ef_alert_digest`
- **Version**: 3
- **JWT Verification**: Disabled (for cron access)
- **Function ID**: `cd9c33dc-2c2c-4336-8006-629bf9948724`

## How It Works

1. **Cron Trigger**: pg_cron calls the function daily at 05:00 UTC
2. **Query Alerts**: Function queries `lth_pvr.alert_events` for:
   - `org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'`
   - `severity IN ('error', 'critical')`
   - `resolved_at IS NULL`
   - `notified_at IS NULL`
3. **Send Email**: Uses Resend API to send digest email
4. **Mark Notified**: Updates `notified_at` timestamp to prevent re-sending

## Current Alert Status
As of 2025-12-27 18:15 UTC, there are **4 unresolved error/critical alerts**:
- `df45498b`: ef_execute_orders (error)
- `8f72fc65`: ef_execute_orders (critical)
- `2ef6d1d1`: ef_fetch_ci_bands (error)
- `c19e3233`: ef_poll_orders (error)

These will be included in tomorrow's 07:00 SAST email digest.

## Manual Testing

To manually trigger the alert digest (for testing):

```powershell
$body = '{"org_id":"b0a77009-03b9-44a1-ae1d-34f157d44a8b"}'
Invoke-WebRequest `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_alert_digest" `
  -Method POST `
  -Headers @{"Content-Type"="application/json"} `
  -Body $body
```

**Note**: The function currently has `verify_jwt=false` so no authorization header is needed.

## Troubleshooting

### Check Cron Job Status
```sql
SELECT jobid, jobname, schedule, active, nodename
FROM cron.job
WHERE jobname = 'lth_pvr_alert_digest_daily';
```

### Check Unresolved Alerts
```sql
SELECT 
  alert_id,
  component,
  severity,
  created_at,
  message,
  notified_at
FROM lth_pvr.alert_events
WHERE org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
  AND severity IN ('error', 'critical')
  AND resolved_at IS NULL
ORDER BY created_at DESC;
```

### Check Function Logs
Use the Supabase dashboard or MCP tool:
```
mcp_supabase_get_logs(service="edge-function")
```

### Verify Secrets Are Set
```powershell
supabase secrets list
```

## Email Template

The email sent will look like:

```
Hi Dav,

There are 4 NEW open alert(s) for org_id=b0a77009-03b9-44a1-ae1d-34f157d44a8b:

• [ERROR] ef_execute_orders @ 2025-12-27T15:04:07.960549Z
    Additional test alert 1 for execute_orders

• [CRITICAL] ef_execute_orders @ 2025-12-27T15:04:07.960549Z
    Additional test alert 2 for execute_orders

• [ERROR] ef_fetch_ci_bands @ 2025-12-27T15:01:35.710211Z
    Test alert for filter test - ci bands

• [ERROR] ef_poll_orders @ 2025-12-27T14:59:49.925750Z
    Test alert 3 for badge update test

To resolve these, open the BitWealth UI and use the Alerts card.

-- ef_alert_digest
```

## Files Modified

1. **supabase/config.toml**: Added Resend API key and email configuration to `[edge_runtime.secrets]`
2. **supabase/sql/migrations/20251226_create_cron_schedule_for_ef_alert_digest.sql**: Updated schedule to 05:00 UTC
3. **supabase/functions/ef_alert_digest/index.ts**: Already correctly implemented
4. **supabase/functions/ef_alert_digest/client.ts**: Already correctly implemented

## Security Notes

- The Resend API key is stored as a Supabase secret
- The function has JWT verification disabled to allow cron access
- Only error/critical severity alerts trigger emails
- Alerts are marked with `notified_at` to prevent duplicate emails
