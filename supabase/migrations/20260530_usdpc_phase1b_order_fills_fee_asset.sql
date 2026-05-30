-- USDPC Phase 1b: allow USDPC as an order_fills fee asset.
--
-- USDPC↔USDT conversion orders settle their taker fee in USDPC, but the
-- original order_fills.fee_asset CHECK only permitted BTC/USDT. Without this
-- widening, ef_poll_orders fails to record the conversion fill (constraint
-- violation), so ef_post_ledger_and_balances has nothing to book.

ALTER TABLE lth_pvr.order_fills DROP CONSTRAINT order_fills_fee_asset_check;

ALTER TABLE lth_pvr.order_fills ADD CONSTRAINT order_fills_fee_asset_check
  CHECK (fee_asset = ANY (ARRAY['BTC'::text, 'USDT'::text, 'USDPC'::text]));
