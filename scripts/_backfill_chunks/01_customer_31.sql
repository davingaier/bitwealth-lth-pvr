WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'deposit', 'USDT', 2.0, 'VALR_C31_20260101211520_018',
          '2026-01-01T21:15:20+00:00', 'VALR_BF_VALR_C31_20260101211520_018', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-01-01', 'topup',
       0, 2.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'USDT', -2.0, 'VALR_C31_20260101215104_017',
          '2026-01-01T21:51:04+00:00', 'VALR_BF_VALR_C31_20260101215104_017', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-01-01', 'withdrawal',
       0, -2.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'deposit', 'BTC', 1e-05, 'VALR_C31_20260125114926_016',
          '2026-01-25T11:49:26+00:00', 'VALR_BF_VALR_C31_20260125114926_016', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-01-25', 'topup',
       1e-05, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'BTC', -7.83e-06, 'VALR_C31_20260126180906_015',
          '2026-01-26T18:09:06+00:00', 'VALR_BF_VALR_C31_20260126180906_015', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-01-26', 'withdrawal',
       -7.83e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'deposit', 'USDT', 5.3241669946, 'VALR_C31_20260421180152_014',
          '2026-04-21T18:01:52+00:00', 'VALR_BF_VALR_C31_20260421180152_014', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 5.3241669946, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'deposit', 'BTC', 6.224e-05, 'VALR_C31_20260421180201_013',
          '2026-04-21T18:02:01+00:00', 'VALR_BF_VALR_C31_20260421180201_013', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       6.224e-05, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 25.0005836, 'VALR_C31_20260421180425_012',
          '2026-04-21T18:04:25+00:00', 'VALR_BF_VALR_C31_20260421180425_012', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 0, 25.0005836, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 87.605309751555, '019db190-5a47-79e4-9011-26c2701b8c3f',
          '2026-04-21T19:42:00+00:00', 'VALR_BF_019db190-5a47-79e4-9011-26c2701b8c3f_CREDIT_011', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'USDT', 'conversion_from_amount', 5.2937, 'fee_amount', 0.307695518445, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 0, 87.605309751555, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'USDT', -5.2937, '019db190-5a47-79e4-9011-26c2701b8c3f',
          '2026-04-21T19:42:00+00:00', 'VALR_BF_019db190-5a47-79e4-9011-26c2701b8c3f_DEBIT_011', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 87.605309751555, 'fee_amount', 0.307695518445, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'withdrawal',
       0, -5.2937, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 12.20363960174, '019db190-5a86-77bb-a6c2-4eef7390376d',
          '2026-04-21T19:42:00+00:00', 'VALR_BF_019db190-5a86-77bb-a6c2-4eef7390376d_CREDIT_010', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'credit', 'conversion_from', 'BTC', 'conversion_from_amount', 9.82e-06, 'fee_amount', 0.04286275826, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 0, 12.20363960174, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'BTC', -9.82e-06, '019db190-5a86-77bb-a6c2-4eef7390376d',
          '2026-04-21T19:42:00+00:00', 'VALR_BF_019db190-5a86-77bb-a6c2-4eef7390376d_DEBIT_010', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 12.20363960174, 'fee_amount', 0.04286275826, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'withdrawal',
       -9.82e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 11.99994107067, '019db191-d2e0-7d09-88be-651e3e9d7e3a',
          '2026-04-21T19:43:37+00:00', 'VALR_BF_019db191-d2e0-7d09-88be-651e3e9d7e3a_CREDIT_009', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'credit', 'conversion_from', 'BTC', 'conversion_from_amount', 9.66e-06, 'fee_amount', 0.04214730933, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 0, 11.99994107067, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'BTC', -9.66e-06, '019db191-d2e0-7d09-88be-651e3e9d7e3a',
          '2026-04-21T19:43:37+00:00', 'VALR_BF_019db191-d2e0-7d09-88be-651e3e9d7e3a_DEBIT_009', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 11.99994107067, 'fee_amount', 0.04214730933, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'withdrawal',
       -9.66e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 11.922044476335, '019db193-29c4-7ad7-a8ca-054265168547',
          '2026-04-21T19:45:04+00:00', 'VALR_BF_019db193-29c4-7ad7-a8ca-054265168547_CREDIT_008', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'credit', 'conversion_from', 'BTC', 'conversion_from_amount', 9.59e-06, 'fee_amount', 0.041873713665, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 0, 11.922044476335, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'BTC', -9.59e-06, '019db193-29c4-7ad7-a8ca-054265168547',
          '2026-04-21T19:45:04+00:00', 'VALR_BF_019db193-29c4-7ad7-a8ca-054265168547_DEBIT_008', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 11.922044476335, 'fee_amount', 0.041873713665, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'withdrawal',
       -9.59e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 11.92192024268, '019db193-2a6d-7c1e-84cf-0ed90d26ede6',
          '2026-04-21T19:45:05+00:00', 'VALR_BF_019db193-2a6d-7c1e-84cf-0ed90d26ede6_CREDIT_007', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'credit', 'conversion_from', 'BTC', 'conversion_from_amount', 9.59e-06, 'fee_amount', 0.04187327732, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 0, 11.92192024268, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'BTC', -9.59e-06, '019db193-2a6d-7c1e-84cf-0ed90d26ede6',
          '2026-04-21T19:45:05+00:00', 'VALR_BF_019db193-2a6d-7c1e-84cf-0ed90d26ede6_DEBIT_007', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 11.92192024268, 'fee_amount', 0.04187327732, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'withdrawal',
       -9.59e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 11.889218929275, '019db195-9c15-797d-8f70-9826d23e5cff',
          '2026-04-21T19:47:45+00:00', 'VALR_BF_019db195-9c15-797d-8f70-9826d23e5cff_CREDIT_006', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'credit', 'conversion_from', 'BTC', 'conversion_from_amount', 9.55e-06, 'fee_amount', 0.041758420725, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 0, 11.889218929275, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'BTC', -9.55e-06, '019db195-9c15-797d-8f70-9826d23e5cff',
          '2026-04-21T19:47:45+00:00', 'VALR_BF_019db195-9c15-797d-8f70-9826d23e5cff_DEBIT_006', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 11.889218929275, 'fee_amount', 0.041758420725, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'withdrawal',
       -9.55e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 11.97666221284, '019db197-c124-7a8a-be07-78eb4cded1af',
          '2026-04-21T19:50:05+00:00', 'VALR_BF_019db197-c124-7a8a-be07-78eb4cded1af_CREDIT_005', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'credit', 'conversion_from', 'BTC', 'conversion_from_amount', 9.62e-06, 'fee_amount', 0.04206554716, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'topup',
       0, 0, 11.97666221284, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'withdrawal', 'BTC', -9.62e-06, '019db197-c124-7a8a-be07-78eb4cded1af',
          '2026-04-21T19:50:05+00:00', 'VALR_BF_019db197-c124-7a8a-be07-78eb4cded1af_DEBIT_005', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'BTCZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 11.97666221284, 'fee_amount', 0.04206554716, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-21', 'withdrawal',
       -9.62e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_withdrawal', 'ZAR', -100.0, 'VALR_C31_20260422043746_004',
          '2026-04-22T04:37:46+00:00', 'VALR_BF_VALR_C31_20260422043746_004', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Withdraw', 'fee_amount', 0.0, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-22', 'withdrawal',
       0, 0, -100.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_deposit', 'ZAR', 100.0, 'VALR_C31_20260422050200_003',
          '2026-04-22T05:02:00+00:00', 'VALR_BF_VALR_C31_20260422050200_003', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-22', 'topup',
       0, 0, 100.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'deposit', 'BTC', 3.45384e-06, '019db66e-7b95-75fd-a9ab-ced39ad875e3',
          '2026-04-22T18:23:07+00:00', 'VALR_BF_019db66e-7b95-75fd-a9ab-ced39ad875e3_CREDIT_001', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'BTCZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 4.58748225, 'fee_amount', 5.616e-08, 'fee_asset', 'BTC'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-22', 'topup',
       3.45384e-06, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'deposit', 'BTC', 1.160136e-05, '019db66e-7b95-75fd-a9ab-ced39ad875e3',
          '2026-04-22T18:23:07+00:00', 'VALR_BF_019db66e-7b95-75fd-a9ab-ced39ad875e3_CREDIT_002', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'BTCZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 15.4062288, 'fee_amount', 1.8864e-07, 'fee_asset', 'BTC'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-22', 'topup',
       1.160136e-05, 0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_withdrawal', 'ZAR', -4.58748225, '019db66e-7b95-75fd-a9ab-ced39ad875e3',
          '2026-04-22T18:23:07+00:00', 'VALR_BF_019db66e-7b95-75fd-a9ab-ced39ad875e3_DEBIT_001', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'BTCZAR', 'leg', 'debit', 'conversion_to', 'BTC', 'conversion_to_amount', 3.45384e-06, 'fee_amount', 5.616e-08, 'fee_asset', 'BTC'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-22', 'withdrawal',
       0, 0, -4.58748225, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, '734cd9c0-4e6f-4510-aaa1-a088779c16bc',
          'zar_withdrawal', 'ZAR', -15.4062288, '019db66e-7b95-75fd-a9ab-ced39ad875e3',
          '2026-04-22T18:23:07+00:00', 'VALR_BF_019db66e-7b95-75fd-a9ab-ced39ad875e3_DEBIT_002', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'BTCZAR', 'leg', 'debit', 'conversion_to', 'BTC', 'conversion_to_amount', 1.160136e-05, 'fee_amount', 1.8864e-07, 'fee_asset', 'BTC'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 31, DATE '2026-04-22', 'withdrawal',
       0, 0, -15.4062288, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
