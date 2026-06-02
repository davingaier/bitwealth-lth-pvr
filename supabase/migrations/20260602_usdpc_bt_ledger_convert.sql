-- USDPC Phase 5: back-tester ledger support for USDPC conversions.
-- ef_bt_execute records USDPC<->USDT conversions (idle-cash sweep & pre-buy
-- unwind) as kind='convert' rows carrying amount_usdpc / fee_usdpc, mirroring
-- the live lth_pvr.ledger_lines treatment. Add the columns and widen the kind
-- CHECK so these inserts succeed.

ALTER TABLE lth_pvr_bt.bt_ledger
  ADD COLUMN IF NOT EXISTS amount_usdpc NUMERIC(38,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_usdpc    NUMERIC(38,8) NOT NULL DEFAULT 0;

ALTER TABLE lth_pvr_bt.bt_ledger DROP CONSTRAINT IF EXISTS bt_ledger_kind_check;
ALTER TABLE lth_pvr_bt.bt_ledger
  ADD CONSTRAINT bt_ledger_kind_check
  CHECK (kind = ANY (ARRAY['contrib','buy','sell','fee','convert']));
