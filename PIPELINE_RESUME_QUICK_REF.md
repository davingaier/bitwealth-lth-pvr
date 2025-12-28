# LTH_PVR Pipeline Resume - Quick Reference

## 🎯 Quick Actions

### Check Status
```sql
SELECT lth_pvr.get_pipeline_status();
```

### Manual Resume
**Via UI:**
1. Go to Administration → Pipeline Control
2. Click "Resume Pipeline"

**Via SQL:**
```sql
SELECT lth_pvr.resume_daily_pipeline();
```

**Via REST:**
```bash
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline \
  -H "Authorization: Bearer [key]" \
  -H "Content-Type: application/json"
```

### Enable Auto-Resume
```sql
-- Update cron to use enhanced guard with auto-resume
SELECT cron.schedule(
  'lth_pvr_ci_bands_guard_autoresume',
  '*/30 * * * *',
  $$SELECT lth_pvr.ensure_ci_bands_today_with_resume(true)$$
);
```

## 📋 Status Indicators

| CI Bands | Window | Can Resume? | UI Status |
|----------|--------|-------------|-----------|
| ✅ | ✅ | ✅ | ⚠️ Pipeline paused - ready to resume |
| ❌ | ✅ | ❌ | ⏳ Waiting for CI bands data |
| ✅ | ❌ | ❌ | ❌ Trade window expired |
| ✅ | ✅ | ❌ (done) | ✅ Pipeline already executed |

## 🔍 Diagnostic Queries

### Recent Resume Attempts
```sql
SELECT created_at, message, 
       context->>'trade_date' as trade_date,
       context->>'error' as error
FROM lth_pvr.alert_events
WHERE component = 'resume_daily_pipeline'
ORDER BY created_at DESC LIMIT 5;
```

### Guard Activity
```sql
SELECT run_at, did_call, status,
       details->>'target_date' as target,
       details->>'auto_resume_pending' as auto_resume
FROM lth_pvr.ci_bands_guard_log
ORDER BY run_at DESC LIMIT 10;
```

### Check Specific Date
```sql
SELECT lth_pvr.get_pipeline_status('2025-12-28'::date);
```

## ⚠️ Trade Window Rules

```
Signal Date (CI bands): Dec 26
Trade Date:             Dec 27
Valid Until:            Dec 27 23:59:59 UTC

Dec 27 → ✅ CAN RESUME
Dec 28+ → ❌ EXPIRED (prevents stale trades)
```

## 🚨 Common Issues

**Button Disabled?**
- Check CI bands: `SELECT * FROM lth_pvr.ci_bands_daily WHERE date = CURRENT_DATE - 1`
- Check window: Current date must be <= signal_date + 1

**Auto-Resume Not Working?**
- Verify cron uses `ensure_ci_bands_today_with_resume(true)`
- Check time is 03:00-08:00 UTC
- Query guard_log for errors

**Step Failed?**
- Check UI Execution Log
- Query alert_events for component = 'resume_daily_pipeline'
- Check individual EF logs in Supabase dashboard

## 📞 Support Commands

```sql
-- Force check pipeline status
SELECT lth_pvr.get_pipeline_status();

-- Test guard function (no auto-resume)
SELECT lth_pvr.ensure_ci_bands_today_with_resume(false);

-- List all open alerts
SELECT * FROM lth_pvr.alert_events 
WHERE resolved_at IS NULL 
ORDER BY created_at DESC;

-- Check what's scheduled in cron
SELECT * FROM cron.job 
WHERE jobname LIKE '%lth_pvr%';
```

## 📦 Files Created

```
supabase/
├── functions/
│   ├── lth_pvr.get_pipeline_status.fn.sql
│   ├── lth_pvr.resume_daily_pipeline.fn.sql
│   ├── lth_pvr.ensure_ci_bands_today_with_resume.fn.sql
│   └── ef_resume_pipeline/
│       ├── index.ts
│       └── client.ts
└── sql/migrations/
    └── 20251228_add_pipeline_resume_capability.sql

ui/
└── Advanced BTC DCA Strategy.html (modified)

docs/
├── PIPELINE_RESUME_DEPLOYMENT.md
└── PIPELINE_RESUME_QUICK_REF.md (this file)
```

## 🎓 Key Concepts

**Trade Window:** 24-hour period where trades based on signal_date CI bands are valid

**Signal Date:** Yesterday's date (CI bands reference date)

**Trade Date:** Today's date (when orders execute)

**Expiration Logic:** `CURRENT_DATE <= (signal_date + 1)` prevents retroactive trades

**Auto-Resume Window:** 03:00-08:00 UTC (normal pipeline processing hours)

---
Last Updated: 2025-12-28
