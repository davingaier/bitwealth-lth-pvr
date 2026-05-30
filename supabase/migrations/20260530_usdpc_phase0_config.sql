-- USDPC yield-stablecoin feature — Phase 0: configuration
-- Adds per-portfolio opt-in toggle and global tunables.
-- Additive & backward-compatible.

-- Per-strategy opt-in flag (lives alongside the fee-rate columns).
ALTER TABLE public.customer_strategies
  ADD COLUMN IF NOT EXISTS usdpc_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customer_strategies.usdpc_enabled IS
  'When true, idle USDT for this strategy is auto-swept into the yield stablecoin USDPC and converted back just-in-time to fund BTC buys / fees / withdrawals.';

-- Global tunables (key/val text table). Safe to re-run.
INSERT INTO lth_pvr.settings (key, val) VALUES
  ('usdpc_pair',          'USDPC/USDT'),
  ('usdpc_taker_fee_rate','0.001'),
  ('usdpc_min_order_usdt','5'),
  ('usdpc_default_apy',   '0.10')
ON CONFLICT (key) DO NOTHING;
