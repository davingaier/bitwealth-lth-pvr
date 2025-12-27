-- Migration: Add WebSocket monitoring columns to exchange_orders
-- Date: 2025-12-27
-- Purpose: Track WebSocket monitoring state to enable hybrid polling/WebSocket strategy

ALTER TABLE lth_pvr.exchange_orders 
ADD COLUMN IF NOT EXISTS ws_monitored_at timestamptz,
ADD COLUMN IF NOT EXISTS last_polled_at timestamptz,
ADD COLUMN IF NOT EXISTS poll_count int DEFAULT 0,
ADD COLUMN IF NOT EXISTS requires_polling boolean DEFAULT true;

COMMENT ON COLUMN lth_pvr.exchange_orders.ws_monitored_at IS 'Timestamp when WebSocket monitoring was initiated for this order';
COMMENT ON COLUMN lth_pvr.exchange_orders.last_polled_at IS 'Timestamp of last REST API poll';
COMMENT ON COLUMN lth_pvr.exchange_orders.poll_count IS 'Number of times this order has been polled';
COMMENT ON COLUMN lth_pvr.exchange_orders.requires_polling IS 'Whether this order still needs polling (false once filled/cancelled)';

-- Index for finding orders that need polling (fallback safety net)
CREATE INDEX IF NOT EXISTS idx_exchange_orders_requires_polling 
ON lth_pvr.exchange_orders (requires_polling, last_polled_at) 
WHERE status = 'submitted';

-- Update existing submitted orders to require polling
UPDATE lth_pvr.exchange_orders 
SET requires_polling = true 
WHERE status = 'submitted' AND requires_polling IS NULL;
