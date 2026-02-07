-- Migration: Add crypto wallet columns to exchange_accounts
-- Date: 2026-02-07
-- Purpose: Support BTC and USDT direct deposit via VALR wallet addresses

-- Add wallet address columns
ALTER TABLE public.exchange_accounts 
ADD COLUMN IF NOT EXISTS btc_wallet_address TEXT,
ADD COLUMN IF NOT EXISTS btc_wallet_created_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS usdt_wallet_address TEXT,
ADD COLUMN IF NOT EXISTS usdt_deposit_network TEXT DEFAULT 'TRON',
ADD COLUMN IF NOT EXISTS usdt_wallet_created_at TIMESTAMPTZ;

-- Add column comments for documentation
COMMENT ON COLUMN public.exchange_accounts.btc_wallet_address IS 'Bitcoin deposit address from VALR (manually entered by admin after creating wallet in VALR portal)';
COMMENT ON COLUMN public.exchange_accounts.btc_wallet_created_at IS 'Timestamp when BTC wallet address was recorded in system';
COMMENT ON COLUMN public.exchange_accounts.usdt_wallet_address IS 'USDT deposit address from VALR (manually entered by admin, TRON network preferred for low fees)';
COMMENT ON COLUMN public.exchange_accounts.usdt_deposit_network IS 'Network for USDT deposits (default: TRON/TRC20 for lowest fees)';
COMMENT ON COLUMN public.exchange_accounts.usdt_wallet_created_at IS 'Timestamp when USDT wallet address was recorded in system';

-- Verify columns added
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'exchange_accounts' 
      AND column_name = 'btc_wallet_address'
  ) THEN
    RAISE EXCEPTION 'Migration failed: btc_wallet_address column not created';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'exchange_accounts' 
      AND column_name = 'usdt_wallet_address'
  ) THEN
    RAISE EXCEPTION 'Migration failed: usdt_wallet_address column not created';
  END IF;
  
  RAISE NOTICE 'Migration successful: Crypto wallet columns added to exchange_accounts';
END $$;
