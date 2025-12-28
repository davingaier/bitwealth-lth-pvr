# 🚨 CI BANDS FAILURE - QUICK FIX GUIDE

**Created:** 2025-12-28  
**Status:** ✅ Ready to Use

---

## When CI Bands Fetch Fails → Do This:

### 1️⃣ Check If You Can Resume (5 sec)
**Open SQL Editor or pg_admin and run:**
```sql
SELECT lth_pvr.get_pipeline_status();
```

**Look for:**
- ✅ `window_valid: true` → You have time!
- ❌ `window_valid: false` → Too late (next day)

---

### 2️⃣ Fix the CI Bands Problem
- Resolve whatever caused the failure
- Check data arrived: `SELECT * FROM lth_pvr.ci_bands_daily WHERE date = CURRENT_DATE - 1;`

---

### 3️⃣ Resume the Pipeline (30 sec)
```sql
SELECT lth_pvr.resume_daily_pipeline();
```

**This automatically runs:**
1. ef_generate_decisions
2. ef_create_order_intents
3. ef_execute_orders
4. ef_poll_orders
5. ef_post_ledger_and_balances

---

### 4️⃣ Verify Success (10 sec)
```sql
-- Check logs
SELECT * FROM lth_pvr.alert_events 
WHERE component = 'resume_pipeline' 
ORDER BY created_at DESC LIMIT 5;

-- Verify completion
SELECT lth_pvr.get_pipeline_status();
```

**Success = `ledger_posted: true`**

---

## ⏰ TIME WINDOW RULE

**You MUST resume before:** `Signal Date + 1 Day`

**Example:**
- Signal Date: Dec 27
- ✅ Can resume on: Dec 27, Dec 28
- ❌ Cannot resume on: Dec 29+ (expired)

**Why?** Prevents stale price signals from executing trades.

---

## 📋 Common Scenarios

| Situation | Can Resume? | Action |
|-----------|------------|--------|
| CI bands late (same day) | ✅ Yes | Resume immediately |
| Realized next morning | ❌ No | Too late - skip day |
| Decisions ran but intents failed | ✅ Yes | Resume picks up where stopped |
| Already completed today | ❌ No | Nothing to resume |

---

## 🔍 Quick Checks

**Is window still open?**
```sql
SELECT 
  CURRENT_DATE <= (signal_date + interval '1 day')::date as can_resume
FROM (
  SELECT date as signal_date 
  FROM lth_pvr.ci_bands_daily 
  ORDER BY date DESC LIMIT 1
) s;
```

**What's completed?**
```json
{
  "steps": {
    "ci_bands": true,       // ✅ Got signal data
    "decisions": false,     // ❌ Need to run
    "order_intents": false, // ❌ Need to run
    "execute_orders": false,// ❌ Need to run
    "poll_orders": false,   // ❌ Need to run
    "ledger_posted": false  // ❌ Need to run
  }
}
```

---

## 🛑 Error Messages

| Error | Fix |
|-------|-----|
| "Trade window expired" | Can't resume - too late |
| "CI bands not available" | Fix CI bands fetch first |
| "Already completed" | Pipeline already ran today |

---

## 💡 Remember

1. **Check status FIRST** - Know if you can resume
2. **Fix CI bands SECOND** - Make sure data exists
3. **Resume THIRD** - Let automation do the work
4. **Verify LAST** - Confirm it worked

---

## 📞 Need Help?

**Full docs:** See `DEPLOYMENT_COMPLETE.md`  
**Detailed guide:** See `PIPELINE_RESUME_DEPLOYMENT.md`

---

**TL;DR:**
```sql
-- 1. Can I resume?
SELECT lth_pvr.get_pipeline_status();

-- 2. Resume now
SELECT lth_pvr.resume_daily_pipeline();

-- 3. Check it worked
SELECT * FROM lth_pvr.alert_events WHERE component = 'resume_pipeline' ORDER BY created_at DESC LIMIT 5;
```

**THAT'S IT!** 🎉
