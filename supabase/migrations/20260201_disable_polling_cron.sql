-- Disable polling cron job (manual invocation only)
-- Date: 2026-02-01
-- Purpose: Disable automatic polling since WebSocket handles real-time updates

-- Disable the cron job
UPDATE cron.job 
SET active = false 
WHERE jobname = 'lthpvr_poll_orders';
