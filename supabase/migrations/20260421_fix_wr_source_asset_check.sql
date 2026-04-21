-- Allow 'BTC+USDT' as a valid source_asset for ZAR withdrawals that are funded
-- partially from USDT and partially from BTC.
-- The existing wr_source_asset_check constraint did not include the combined value,
-- which caused markConverting to silently fail (constraint violation) after orders
-- were already placed on VALR.

alter table lth_pvr.withdrawal_requests
  drop constraint if exists wr_source_asset_check;

alter table lth_pvr.withdrawal_requests
  add constraint wr_source_asset_check
  check (source_asset is null or source_asset in ('USDT','BTC','BTC+USDT','N/A'));
