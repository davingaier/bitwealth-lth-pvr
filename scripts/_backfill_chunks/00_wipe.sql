DELETE FROM lth_pvr.balances_daily       WHERE customer_id IN (31,48,999);
DELETE FROM lth_pvr.hodl_balances_daily  WHERE customer_id IN (31,48,999);
DELETE FROM lth_pvr.std_dca_balances_daily WHERE customer_id IN (31,48,999);
DELETE FROM lth_pvr.ledger_lines         WHERE customer_id IN (31,48,999) AND kind IN ('topup','withdrawal','deposit','transfer');
DELETE FROM lth_pvr.exchange_funding_events WHERE customer_id IN (31,48,999);
