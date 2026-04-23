WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'deposit', 'BTC', 9.05e-06, 'VALR_C48_20260207195349_014',
          '2026-02-07T19:53:49+00:00', 'VALR_BF_VALR_C48_20260207195349_014', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Off-chain blockchain deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-07', 'topup',
       9.05e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'deposit', 'USDT', 1.0, 'VALR_C48_20260207204318_013',
          '2026-02-07T20:43:18+00:00', 'VALR_BF_VALR_C48_20260207204318_013', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Off-chain blockchain deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-07', 'topup',
       0, 1.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'deposit', 'USDT', 10.0, 'VALR_C48_20260208165621_012',
          '2026-02-08T16:56:21+00:00', 'VALR_BF_VALR_C48_20260208165621_012', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-08', 'topup',
       0, 10.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'withdrawal', 'USDT', -0.075, 'VALR_C48_20260208170005_011',
          '2026-02-08T17:00:05+00:00', 'VALR_BF_VALR_C48_20260208170005_011', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-08', 'withdrawal',
       0, -0.075, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'withdrawal', 'USDT', -0.08249999999999999, 'VALR_C48_20260208173414_010',
          '2026-02-08T17:34:14+00:00', 'VALR_BF_VALR_C48_20260208173414_010', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-08', 'withdrawal',
       0, -0.08249999999999999, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'withdrawal', 'USDT', -10.8425, 'VALR_C48_20260208174503_009',
          '2026-02-08T17:45:03+00:00', 'VALR_BF_VALR_C48_20260208174503_009', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-08', 'withdrawal',
       0, -10.8425, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'deposit', 'USDT', 2.0, 'VALR_C48_20260208185336_008',
          '2026-02-08T18:53:36+00:00', 'VALR_BF_VALR_C48_20260208185336_008', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-08', 'topup',
       0, 2.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'deposit', 'USDT', 10.0, 'VALR_C48_20260208185718_007',
          '2026-02-08T18:57:18+00:00', 'VALR_BF_VALR_C48_20260208185718_007', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-08', 'topup',
       0, 10.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'withdrawal', 'USDT', -0.09, 'VALR_C48_20260208190008_006',
          '2026-02-08T19:00:08+00:00', 'VALR_BF_VALR_C48_20260208190008_006', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-08', 'withdrawal',
       0, -0.09, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'withdrawal', 'USDT', -11.91, 'VALR_C48_20260208190421_005',
          '2026-02-08T19:04:21+00:00', 'VALR_BF_VALR_C48_20260208190421_005', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-08', 'withdrawal',
       0, -11.91, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'zar_deposit', 'ZAR', 50.0, 'VALR_C48_20260217001314_004',
          '2026-02-17T00:13:14+00:00', 'VALR_BF_VALR_C48_20260217001314_004', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-17', 'topup',
       0, 0, 50.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'zar_deposit', 'ZAR', 75.0, 'VALR_C48_20260217001341_003',
          '2026-02-17T00:13:41+00:00', 'VALR_BF_VALR_C48_20260217001341_003', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-17', 'topup',
       0, 0, 75.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'deposit', 'USDT', 6.114576, '019c6a5f-02c9-77e1-8116-b981a344e336',
          '2026-02-17T06:52:17+00:00', 'VALR_BF_019c6a5f-02c9-77e1-8116-b981a344e336_CREDIT_002', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 99.9994164, 'fee_amount', 0.099424, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-17', 'topup',
       0, 6.114576, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'zar_withdrawal', 'ZAR', -99.9994164, '019c6a5f-02c9-77e1-8116-b981a344e336',
          '2026-02-17T06:52:17+00:00', 'VALR_BF_019c6a5f-02c9-77e1-8116-b981a344e336_DEBIT_002', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 6.114576, 'fee_amount', 0.099424, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-02-17', 'withdrawal',
       0, 0, -99.9994164, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, '2e78019d-0101-4584-9e14-95bbf72de8c9',
          'zar_withdrawal', 'ZAR', -25.0005836, 'VALR_C48_20260421180425_001',
          '2026-04-21T18:04:25+00:00', 'VALR_BF_VALR_C48_20260421180425_001', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 48, DATE '2026-04-21', 'withdrawal',
       0, 0, -25.0005836, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
