-- Migration: Add unique constraint to order_fills to prevent duplicates
-- Date: 2026-02-01
-- Purpose: Ensure WebSocket and polling don't create duplicate fill records

-- Add unique constraint on (org_id, exchange_order_id, trade_ts)
-- This ensures each fill event can only be recorded once
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_fills_unique_fill 
ON lth_pvr.order_fills (org_id, exchange_order_id, trade_ts);

-- Add comment
COMMENT ON INDEX lth_pvr.idx_order_fills_unique_fill IS 
'Prevents duplicate fill records from WebSocket and polling mechanisms';
