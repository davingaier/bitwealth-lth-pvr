# LTH_PVR Pipeline Resume Feature - Deployment Guide

**Created:** 2025-12-28  
**Purpose:** Enable easy resumption of LTH_PVR pipeline after CI bands data issues are resolved, with trade window expiration validation

## ✅ What Was Created

### 1. **Database Functions** (3 files)

#### `lth_pvr.get_pipeline_status(p_trade_date)`
- **Location:** `supabase/functions/lth_pvr.get_pipeline_status.fn.sql`
- **Purpose:** Check current pipeline status, CI bands availability, and trade window validity
- **Returns:** JSON with status details, step completion, and resumption eligibility
- **Key Feature:** Validates trade window (current_date <= signal_date + 1)

#### `lth_pvr.resume_daily_pipeline(p_trade_date)`
- **Location:** `supabase/functions/lth_pvr.resume_daily_pipeline.fn.sql`
- **Purpose:** Orchestrates sequential execution of remaining pipeline steps
- **Executes:**
  1. `ef_generate_decisions`
  2. `ef_create_order_intents`
  3. `ef_execute_orders`
  4. `ef_poll_orders`
  5. `ef_post_ledger_and_balances`
- **Validations:**
  - CI bands must exist for signal_date (trade_date - 1)
  - Trade window must not be expired
  - Logs all steps to alert_events table

#### `lth_pvr.ensure_ci_bands_today_with_resume(p_auto_resume)`
- **Location:** `supabase/functions/lth_pvr.ensure_ci_bands_today_with_resume.fn.sql`
- **Purpose:** Enhanced guard function with optional auto-resume
- **Auto-Resume Window:** 03:00-08:00 UTC
- **Usage:**
  ```sql
  -- Manual call with auto-resume
  SELECT lth_pvr.ensure_ci_bands_today_with_resume(true);
  
  -- Check only (no auto-resume)
  SELECT lth_pvr.ensure_ci_bands_today_with_resume(false);
  ```

### 2. **Edge Function** (1 folder)

#### `ef_resume_pipeline`
- **Location:** `supabase/functions/ef_resume_pipeline/`
- **Files:**
  - `index.ts` - Main handler
  - `client.ts` - Supabase client setup
- **Endpoints:**
  - `POST /ef_resume_pipeline` - Execute pipeline resume
  - `POST /ef_resume_pipeline` with `{check_status: true}` - Check status only
- **Features:**
  - CORS-enabled for UI calls
  - Error handling with detailed responses
  - Wraps database functions for REST access

### 3. **UI Component** (1 file)

#### Pipeline Control Panel in Admin Module
- **Location:** `ui/Advanced BTC DCA Strategy.html`
- **Section:** Added before "System Alerts" card
- **Features:**
  - ✅ Real-time status display
  - ✅ Trade date & signal date info
  - ✅ CI bands availability indicator
  - ✅ Trade window countdown/status
  - ✅ Step-by-step progress (✅/⏸️ icons)
  - ✅ One-click "Resume Pipeline" button
  - ✅ Execution log with timestamps
  - ✅ Auto-refresh on authentication
  - ✅ Color-coded status messages

### 4. **Migration Script** (1 file)

#### `20251228_add_pipeline_resume_capability.sql`
- **Location:** `supabase/sql/migrations/`
- **Contains:** All three database functions in one deployable migration
- **Idempotent:** Safe to run multiple times (uses `CREATE OR REPLACE`)

## 🚀 Deployment Steps

### Step 1: Deploy Migration to Database

```powershell
# Using Supabase MCP (recommended)
mcp_supabase_apply_migration(
  name: "add_pipeline_resume_capability",
  query: [contents of 20251228_add_pipeline_resume_capability.sql]
)
```

Or manually via Supabase SQL Editor:
1. Open Supabase Dashboard → SQL Editor
2. Copy contents of `20251228_add_pipeline_resume_capability.sql`
3. Execute

### Step 2: Deploy Edge Function

```powershell
# Navigate to project root
cd C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr

# Deploy ef_resume_pipeline
supabase functions deploy ef_resume_pipeline --no-verify-jwt

# Verify deployment
supabase functions list
```

**Expected Output:**
```
ef_resume_pipeline (v1) - deployed [timestamp]
```

### Step 3: Set Required Secrets (if not already set)

```powershell
# These should already exist from previous deployments
supabase secrets list

# If missing, set them:
supabase secrets set ORG_ID=b0a77009-03b9-44a1-ae1d-34f157d44a8b
supabase secrets set SECRET_KEY=[your_service_role_key]
supabase secrets set SUPABASE_URL=https://wqnmxpooabmedvtackji.supabase.co
```

### Step 4: Deploy UI (Already Completed)

The UI changes are in `ui/Advanced BTC DCA Strategy.html` - no separate deployment needed if you're serving from local file or have already deployed the HTML.

**If serving from a web server:**
```powershell
# Copy updated HTML to your web server location
copy "ui\Advanced BTC DCA Strategy.html" [your_web_server_path]
```

### Step 5: Test the Feature

#### A. Test Status Check
```sql
-- Via database
SELECT lth_pvr.get_pipeline_status();

-- Expected response (example):
{
  "trade_date": "2025-12-28",
  "signal_date": "2025-12-27",
  "current_date": "2025-12-28",
  "ci_bands_available": true,
  "window_valid": true,
  "can_resume": true,
  "resume_reason": "Pipeline ready to resume",
  "steps": {
    "decisions_generated": false,
    "intents_created": false,
    "orders_executed": false,
    "ledger_posted": false
  }
}
```

#### B. Test Via UI
1. Open `Advanced BTC DCA Strategy.html`
2. Navigate to Administration module
3. Look for "LTH_PVR Pipeline Control" card (above Alerts)
4. Click "Refresh" to load status
5. If CI bands available and window valid, "Resume Pipeline" button should be enabled
6. Click "Resume Pipeline" to test execution

#### C. Test Via REST API
```powershell
# Check status
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{"check_status": true}'

# Execute resume
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_resume_pipeline `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{}'
```

## 📊 How It Works

### Trade Window Validation Logic

```
Signal Date: Dec 26 (CI bands available)
Trade Date:  Dec 27 (execute trades)
Current Date Decision:
  - Dec 27 → ✅ Window VALID (can resume)
  - Dec 28 00:00+ → ❌ Window EXPIRED (cannot resume)

Formula: current_date <= (signal_date + 1 day)
```

### Pipeline Execution Flow

```
1. User clicks "Resume Pipeline" OR auto-resume triggers
   ↓
2. Validate CI bands exist for signal_date (yesterday)
   ↓
3. Validate trade window not expired
   ↓
4. Execute ef_generate_decisions
   ↓ (2s delay)
5. Execute ef_create_order_intents
   ↓ (2s delay)
6. Execute ef_execute_orders
   ↓ (2s delay)
7. Execute ef_poll_orders
   ↓ (2s delay)
8. Execute ef_post_ledger_and_balances
   ↓
9. Log success to alert_events
   ↓
10. Return results to UI
```

### Auto-Resume Feature

**Enable auto-resume in pg_cron:**
```sql
-- Update existing cron job to use enhanced version
SELECT cron.schedule(
  'lth_pvr_ci_bands_guard_with_autoresume',
  '*/30 * * * *',  -- Every 30 minutes
  $$SELECT lth_pvr.ensure_ci_bands_today_with_resume(true)$$
);
```

**Disable auto-resume (keep manual control):**
- Keep existing `lth_pvr.ensure_ci_bands_today()` cron job
- Use UI button for manual resume only

## 🎯 Usage Scenarios

### Scenario 1: CI Bands Fetch Failed Overnight
**Problem:** 03:00 UTC - `ef_fetch_ci_bands` failed due to API timeout  
**Detection:** Alert email at 05:00 UTC shows "CI bands unavailable"  
**Resolution:**
1. Check Pipeline Control panel shows: "⏳ Waiting for CI bands data"
2. Manually trigger: `SELECT lth_pvr.ensure_ci_bands_today_with_resume(false);`
3. Once CI bands arrive, click "Resume Pipeline" in UI
4. Pipeline completes normally

### Scenario 2: Late CI Bands Arrival (Auto-Resume)
**Problem:** CI bands arrived at 07:30 UTC instead of 03:00 UTC  
**Detection:** Pipeline Control shows "⚠️ Pipeline paused"  
**Resolution (automatic):**
1. 08:00 UTC cron run detects CI bands now available
2. Auto-resume triggers (if enabled)
3. Pipeline executes automatically
4. User receives completion alert at 05:00 UTC next day

### Scenario 3: Trade Window Expired
**Problem:** CI bands for Dec 26 only arrived on Dec 28  
**Detection:** Pipeline Control shows "❌ Trade window expired"  
**Resolution:** 
- Cannot resume - trade opportunity lost
- Resume button disabled
- Must wait for Dec 27 CI bands to execute Dec 28 trades
- System prevents stale/retroactive trading

## 🔧 Troubleshooting

### Issue: "Resume Pipeline" button disabled
**Check:**
1. CI bands available? (should show ✅)
2. Trade window valid? (should not show ❌ Expired)
3. Already executed? (check step icons - should show ⏸️ not ✅)

### Issue: Pipeline fails at specific step
**Check:**
1. View Execution Log in UI for specific error
2. Query alert_events table:
   ```sql
   SELECT * FROM lth_pvr.alert_events 
   WHERE component = 'resume_daily_pipeline' 
   ORDER BY created_at DESC LIMIT 5;
   ```
3. Check individual EF logs in Supabase dashboard

### Issue: Auto-resume not triggering
**Check:**
1. Cron job uses `ensure_ci_bands_today_with_resume(true)`
2. Current time is between 03:00-08:00 UTC
3. CI bands became available during that window
4. Check guard_log table:
   ```sql
   SELECT * FROM lth_pvr.ci_bands_guard_log 
   ORDER BY run_at DESC LIMIT 10;
   ```

## 📝 Monitoring & Alerts

**Key Queries:**

```sql
-- Check recent pipeline resumes
SELECT 
  created_at,
  message,
  context->>'trade_date' as trade_date,
  (context->'steps')::jsonb as steps
FROM lth_pvr.alert_events
WHERE component = 'resume_daily_pipeline'
ORDER BY created_at DESC LIMIT 10;

-- Check CI bands guard activity
SELECT 
  run_at,
  did_call,
  status,
  details->>'target_date' as target_date,
  details->>'auto_resume_pending' as auto_resume
FROM lth_pvr.ci_bands_guard_log
ORDER BY run_at DESC LIMIT 20;

-- Check pipeline status for any date
SELECT lth_pvr.get_pipeline_status('2025-12-28'::date);
```

## 🎉 Success Criteria

- ✅ Migration deploys without errors
- ✅ Edge function accessible via REST API
- ✅ UI panel loads and shows current status
- ✅ "Resume Pipeline" button enables when conditions met
- ✅ Manual resume executes all steps successfully
- ✅ Trade window expiration correctly prevents stale trades
- ✅ Auto-resume triggers within 03:00-08:00 UTC window (if enabled)
- ✅ Alert events logged for audit trail

## 📚 Related Documentation

- Original Issue: CI bands fetch failures blocking pipeline
- Solution Design: Option C (Full automation + manual control + UI)
- Key Feature: Trade window expiration validation
- Files Modified: 1 HTML, 4 SQL functions, 1 Edge Function
- Migration: `20251228_add_pipeline_resume_capability.sql`

---

**Questions or Issues?** Check the execution log in the UI or query `lth_pvr.alert_events` table for detailed error messages.
