-- Fix: bt_hodl_balances was missing the authenticated/anon SELECT grant that
-- bt_std_dca_balances has, so the admin back-tester (and public back-tester)
-- got 403 "permission denied for table bt_hodl_balances" when loading the HODL
-- benchmark line. RLS policies already permit SELECT for these roles; only the
-- table-level grant was missing.
GRANT SELECT ON lth_pvr_bt.bt_hodl_balances TO authenticated, anon;
