-- Migration: Reduce ef_poll_orders frequency from 1min to 10min
-- Date: 2025-12-27
-- Purpose: With WebSocket monitoring active, polling now serves as fallback safety net

-- Find the existing poll_orders cron job and update its schedule
DO $$
DECLARE
    job_id_var integer;
BEGIN
    -- Find the job ID for lth_pvr_poll_orders
    SELECT jobid INTO job_id_var
    FROM cron.job
    WHERE jobname LIKE '%poll_orders%' OR command LIKE '%ef_poll_orders%'
    LIMIT 1;

    IF job_id_var IS NOT NULL THEN
        -- Update schedule from '* * * * *' (every minute) to '*/10 * * * *' (every 10 minutes)
        PERFORM cron.alter_job(
            job_id_var,
            schedule := '*/10 * * * *'
        );
        
        RAISE NOTICE 'Updated cron job % to run every 10 minutes (was every 1 minute)', job_id_var;
    ELSE
        RAISE WARNING 'No poll_orders cron job found - may need manual update';
    END IF;
END $$;

-- Log the change
COMMENT ON EXTENSION pg_cron IS 'ef_poll_orders reduced from 1min to 10min intervals with WebSocket monitoring active';
