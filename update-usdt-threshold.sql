-- Update VALR USDT minimum transfer threshold to $0.06
-- Date: 2026-01-24
-- Context: Changed from $1.00 to $0.06 based on VALR API testing

UPDATE lth_pvr.system_config 
SET 
  config_value = '0.06', 
  updated_at = NOW() 
WHERE config_key = 'valr_min_transfer_usdt';

-- Verify update
SELECT 
  config_key, 
  config_value, 
  updated_at 
FROM lth_pvr.system_config 
WHERE config_key IN ('valr_min_transfer_btc', 'valr_min_transfer_usdt')
ORDER BY config_key;
