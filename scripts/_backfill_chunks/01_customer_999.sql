WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 25000.0, 'VALR_C999_20250922234930_037',
          '2025-09-22T23:49:30+00:00', 'VALR_BF_VALR_C999_20250922234930_037', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-09-22', 'topup',
       0, 0, 25000.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 24.645558, '01997435-61ea-7d5d-a3fd-09d985b197d6',
          '2025-09-23T02:01:44+00:00', 'VALR_BF_01997435-61ea-7d5d-a3fd-09d985b197d6_CREDIT_036', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 432.121911, 'fee_amount', 0.044442, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-09-23', 'topup',
       0, 24.645558, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -432.121911, '01997435-61ea-7d5d-a3fd-09d985b197d6',
          '2025-09-23T02:01:44+00:00', 'VALR_BF_01997435-61ea-7d5d-a3fd-09d985b197d6_DEBIT_036', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 24.645558, 'fee_amount', 0.044442, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-09-23', 'withdrawal',
       0, 0, -432.121911, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 401.80185248, '01997435-61ea-7d5d-a3fd-09d985b197d6',
          '2025-09-23T06:26:16+00:00', 'VALR_BF_01997435-61ea-7d5d-a3fd-09d985b197d6_CREDIT_034', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 7044.97680016, 'fee_amount', 0.72454752, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-09-23', 'topup',
       0, 401.80185248, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 999.39774018, '01997435-61ea-7d5d-a3fd-09d985b197d6',
          '2025-09-23T06:26:16+00:00', 'VALR_BF_01997435-61ea-7d5d-a3fd-09d985b197d6_CREDIT_035', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 17522.90052981, 'fee_amount', 1.80215982, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-09-23', 'topup',
       0, 999.39774018, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -7044.97680016, '01997435-61ea-7d5d-a3fd-09d985b197d6',
          '2025-09-23T06:26:16+00:00', 'VALR_BF_01997435-61ea-7d5d-a3fd-09d985b197d6_DEBIT_034', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 401.80185248, 'fee_amount', 0.72454752, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-09-23', 'withdrawal',
       0, 0, -7044.97680016, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -17522.90052981, '01997435-61ea-7d5d-a3fd-09d985b197d6',
          '2025-09-23T06:26:16+00:00', 'VALR_BF_01997435-61ea-7d5d-a3fd-09d985b197d6_DEBIT_035', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 999.39774018, 'fee_amount', 1.80215982, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-09-23', 'withdrawal',
       0, 0, -17522.90052981, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -1425.84, 'VALR_C999_20250923063312_033',
          '2025-09-23T06:33:12+00:00', 'VALR_BF_VALR_C999_20250923063312_033', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Send', 'fee_amount', 4.0, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-09-23', 'withdrawal',
       0, -1425.84, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 350.0, 'VALR_C999_20251006234352_032',
          '2025-10-06T23:43:52+00:00', 'VALR_BF_VALR_C999_20251006234352_032', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-10-06', 'topup',
       0, 0, 350.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 20.16354018, '0199be48-ff02-730a-ae0f-83694763b549',
          '2025-10-07T11:04:33+00:00', 'VALR_BF_0199be48-ff02-730a-ae0f-83694763b549_CREDIT_031', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 349.99962732, 'fee_amount', 0.03635982, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-10-07', 'topup',
       0, 20.16354018, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -349.99962732, '0199be48-ff02-730a-ae0f-83694763b549',
          '2025-10-07T11:04:33+00:00', 'VALR_BF_0199be48-ff02-730a-ae0f-83694763b549_DEBIT_031', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 20.16354018, 'fee_amount', 0.03635982, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-10-07', 'withdrawal',
       0, 0, -349.99962732, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -20.16, 'VALR_C999_20251007111122_030',
          '2025-10-07T11:11:22+00:00', 'VALR_BF_VALR_C999_20251007111122_030', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Send', 'fee_amount', 4.0, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2025-10-07', 'withdrawal',
       0, -20.16, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 21000.0, 'VALR_C999_20260126235410_029',
          '2026-01-26T23:54:10+00:00', 'VALR_BF_VALR_C999_20260126235410_029', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-01-26', 'topup',
       0, 0, 21000.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 9.27667188, '019bfdef-7942-76b2-aee2-a884b5830c56',
          '2026-01-27T05:44:33+00:00', 'VALR_BF_019bfdef-7942-76b2-aee2-a884b5830c56_CREDIT_028', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 149.99919336, 'fee_amount', 0.01672812, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-01-27', 'topup',
       0, 9.27667188, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -149.99919336, '019bfdef-7942-76b2-aee2-a884b5830c56',
          '2026-01-27T05:44:33+00:00', 'VALR_BF_019bfdef-7942-76b2-aee2-a884b5830c56_DEBIT_028', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 9.27667188, 'fee_amount', 0.01672812, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-01-27', 'withdrawal',
       0, 0, -149.99919336, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -0.06957504, 'VALR_C999_20260127090650_027',
          '2026-01-27T09:06:50+00:00', 'VALR_BF_VALR_C999_20260127090650_027', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-01-27', 'withdrawal',
       0, -0.06957504, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 1300.84445764, '019c041d-4e44-7579-b81a-6661f58b36a9',
          '2026-01-28T10:22:34+00:00', 'VALR_BF_019c041d-4e44-7579-b81a-6661f58b36a9_CREDIT_026', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 20850.00064784, 'fee_amount', 2.34574236, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-01-28', 'topup',
       0, 1300.84445764, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -20850.00064784, '019c041d-4e44-7579-b81a-6661f58b36a9',
          '2026-01-28T10:22:34+00:00', 'VALR_BF_019c041d-4e44-7579-b81a-6661f58b36a9_DEBIT_026', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 1300.84445764, 'fee_amount', 2.34574236, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-01-28', 'withdrawal',
       0, 0, -20850.00064784, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -59.0, 'VALR_C999_20260201113534_025',
          '2026-02-01T11:35:34+00:00', 'VALR_BF_VALR_C999_20260201113534_025', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-01', 'withdrawal',
       0, -59.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 999.0, 'VALR_C999_20260210110431_024',
          '2026-02-10T11:04:31+00:00', 'VALR_BF_VALR_C999_20260210110431_024', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Receive'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'topup',
       0, 999.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 479.644804230886, '019c473c-5bb6-7b67-bfc0-e4540d0c2198',
          '2026-02-10T11:09:19+00:00', 'VALR_BF_019c473c-5bb6-7b67-bfc0-e4540d0c2198_CREDIT_023', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'USDT', 'conversion_from_amount', 29.9191, 'fee_amount', 0.864917499114, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'topup',
       0, 0, 479.644804230886, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -29.9191, '019c473c-5bb6-7b67-bfc0-e4540d0c2198',
          '2026-02-10T11:09:19+00:00', 'VALR_BF_019c473c-5bb6-7b67-bfc0-e4540d0c2198_DEBIT_023', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 479.644804230886, 'fee_amount', 0.864917499114, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'withdrawal',
       0, -29.9191, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 209.631921948288, '019c473e-acdd-7536-bc00-7805b1ac616a',
          '2026-02-10T11:10:49+00:00', 'VALR_BF_019c473e-acdd-7536-bc00-7805b1ac616a_CREDIT_022', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'USDT', 'conversion_from_amount', 13.0752, 'fee_amount', 0.378017891712, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'topup',
       0, 0, 209.631921948288, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -13.0752, '019c473e-acdd-7536-bc00-7805b1ac616a',
          '2026-02-10T11:10:49+00:00', 'VALR_BF_019c473e-acdd-7536-bc00-7805b1ac616a_DEBIT_022', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 209.631921948288, 'fee_amount', 0.378017891712, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'withdrawal',
       0, -13.0752, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 4990.99918062753, '019c473e-acdd-7536-bc00-7805b1ac616a',
          '2026-02-10T11:11:25+00:00', 'VALR_BF_019c473e-acdd-7536-bc00-7805b1ac616a_CREDIT_021', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'USDT', 'conversion_from_amount', 311.2995, 'fee_amount', 8.99999852247, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'topup',
       0, 0, 4990.99918062753, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -311.2995, '019c473e-acdd-7536-bc00-7805b1ac616a',
          '2026-02-10T11:11:25+00:00', 'VALR_BF_019c473e-acdd-7536-bc00-7805b1ac616a_DEBIT_021', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 4990.99918062753, 'fee_amount', 8.99999852247, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'withdrawal',
       0, -311.2995, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 5490.09990032973, '019c473e-acdd-7536-bc00-7805b1ac616a',
          '2026-02-10T11:12:02+00:00', 'VALR_BF_019c473e-acdd-7536-bc00-7805b1ac616a_CREDIT_020', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'USDT', 'conversion_from_amount', 342.4295, 'fee_amount', 9.89999982027, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'topup',
       0, 0, 5490.09990032973, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -342.4295, '019c473e-acdd-7536-bc00-7805b1ac616a',
          '2026-02-10T11:12:02+00:00', 'VALR_BF_019c473e-acdd-7536-bc00-7805b1ac616a_DEBIT_020', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 5490.09990032973, 'fee_amount', 9.89999982027, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'withdrawal',
       0, -342.4295, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 4846.338532579698, '019c473e-acdd-7536-bc00-7805b1ac616a',
          '2026-02-10T11:12:41+00:00', 'VALR_BF_019c473e-acdd-7536-bc00-7805b1ac616a_CREDIT_019', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'USDT', 'conversion_from_amount', 302.2767, 'fee_amount', 8.739139810302, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'topup',
       0, 0, 4846.338532579698, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -302.2767, '019c473e-acdd-7536-bc00-7805b1ac616a',
          '2026-02-10T11:12:41+00:00', 'VALR_BF_019c473e-acdd-7536-bc00-7805b1ac616a_DEBIT_019', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Sell', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'ZAR', 'conversion_to_amount', 4846.338532579698, 'fee_amount', 8.739139810302, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'withdrawal',
       0, -302.2767, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -16016.71, 'VALR_C999_20260210111417_018',
          '2026-02-10T11:14:17+00:00', 'VALR_BF_VALR_C999_20260210111417_018', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Withdraw', 'fee_amount', 30.0, 'fee_asset', 'ZAR'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-10', 'withdrawal',
       0, 0, -16016.71, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 100.0, 'VALR_C999_20260212171624_017',
          '2026-02-12T17:16:24+00:00', 'VALR_BF_VALR_C999_20260212171624_017', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-12', 'topup',
       0, 0, 100.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 1.5343512, '019c5374-ce24-7814-9252-b4a767211c8f',
          '2026-02-12T20:04:49+00:00', 'VALR_BF_019c5374-ce24-7814-9252-b4a767211c8f_CREDIT_016', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 24.99994504, 'fee_amount', 0.0249488, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-12', 'topup',
       0, 1.5343512, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -24.99994504, '019c5374-ce24-7814-9252-b4a767211c8f',
          '2026-02-12T20:04:49+00:00', 'VALR_BF_019c5374-ce24-7814-9252-b4a767211c8f_DEBIT_016', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 1.5343512, 'fee_amount', 0.0249488, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-12', 'withdrawal',
       0, 0, -24.99994504, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 100.0, 'VALR_C999_20260213053954_015',
          '2026-02-13T05:39:54+00:00', 'VALR_BF_VALR_C999_20260213053954_015', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-13', 'topup',
       0, 0, 100.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 1.2386495, '019c55e4-e492-7f5d-9bbf-58f2cbf49a4a',
          '2026-02-13T07:26:30+00:00', 'VALR_BF_019c55e4-e492-7f5d-9bbf-58f2cbf49a4a_CREDIT_014', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Market Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 19.99987, 'fee_amount', 0.0043505, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-13', 'topup',
       0, 1.2386495, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -19.99987, '019c55e4-e492-7f5d-9bbf-58f2cbf49a4a',
          '2026-02-13T07:26:30+00:00', 'VALR_BF_019c55e4-e492-7f5d-9bbf-58f2cbf49a4a_DEBIT_014', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Market Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 1.2386495, 'fee_amount', 0.0043505, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-13', 'withdrawal',
       0, 0, -19.99987, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 1.86433814, '019c5ac2-526f-71ec-820c-d638deda3202',
          '2026-02-14T13:20:46+00:00', 'VALR_BF_019c5ac2-526f-71ec-820c-d638deda3202_CREDIT_013', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 30.00590789, 'fee_amount', 0.00336186, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'topup',
       0, 1.86433814, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -30.00590789, '019c5ac2-526f-71ec-820c-d638deda3202',
          '2026-02-14T13:20:46+00:00', 'VALR_BF_019c5ac2-526f-71ec-820c-d638deda3202_DEBIT_013', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 1.86433814, 'fee_amount', 0.00336186, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'withdrawal',
       0, 0, -30.00590789, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 4.5946896, '019c5d12-ae59-7569-8ba4-ed94b7595c36',
          '2026-02-14T16:53:51+00:00', 'VALR_BF_019c5d12-ae59-7569-8ba4-ed94b7595c36_CREDIT_012', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 74.99896892, 'fee_amount', 0.0747104, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'topup',
       0, 4.5946896, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -74.99896892, '019c5d12-ae59-7569-8ba4-ed94b7595c36',
          '2026-02-14T16:53:51+00:00', 'VALR_BF_019c5d12-ae59-7569-8ba4-ed94b7595c36_DEBIT_012', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Simple Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 4.5946896, 'fee_amount', 0.0747104, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'withdrawal',
       0, 0, -74.99896892, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -0.07931653999999999, 'VALR_C999_20260214165432_011',
          '2026-02-14T16:54:32+00:00', 'VALR_BF_VALR_C999_20260214165432_011', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'withdrawal',
       0, -0.07931653999999999, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 40.0, 'VALR_C999_20260214182648_010',
          '2026-02-14T18:26:48+00:00', 'VALR_BF_VALR_C999_20260214182648_010', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'topup',
       0, 40.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 7.15, 'VALR_C999_20260214182802_009',
          '2026-02-14T18:28:02+00:00', 'VALR_BF_VALR_C999_20260214182802_009', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'topup',
       0, 7.15, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 2.76, 'VALR_C999_20260214182848_008',
          '2026-02-14T18:28:48+00:00', 'VALR_BF_VALR_C999_20260214182848_008', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (in)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'topup',
       0, 2.76, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 1.49475, '019c5d7e-24ac-7333-8efa-3e6adb480d61',
          '2026-02-14T18:51:13+00:00', 'VALR_BF_019c5d7e-24ac-7333-8efa-3e6adb480d61_CREDIT_007', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Market Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 24.09555, 'fee_amount', 0.00525, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'topup',
       0, 1.49475, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -24.09555, '019c5d7e-24ac-7333-8efa-3e6adb480d61',
          '2026-02-14T18:51:13+00:00', 'VALR_BF_019c5d7e-24ac-7333-8efa-3e6adb480d61_DEBIT_007', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Market Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 1.49475, 'fee_amount', 0.00525, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'withdrawal',
       0, 0, -24.09555, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 1.60839966, '019c5d88-3b48-7f20-a0f6-5f09cd113a45',
          '2026-02-14T19:03:33+00:00', 'VALR_BF_019c5d88-3b48-7f20-a0f6-5f09cd113a45_CREDIT_006', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 25.89262422, 'fee_amount', 0.00290034, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'topup',
       0, 1.60839966, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -25.89262422, '019c5d88-3b48-7f20-a0f6-5f09cd113a45',
          '2026-02-14T19:03:33+00:00', 'VALR_BF_019c5d88-3b48-7f20-a0f6-5f09cd113a45_DEBIT_006', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 1.60839966, 'fee_amount', 0.00290034, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-14', 'withdrawal',
       0, 0, -25.89262422, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -3.1, 'VALR_C999_20260216152729_005',
          '2026-02-16T15:27:29+00:00', 'VALR_BF_VALR_C999_20260216152729_005', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Transfer (out)'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-16', 'withdrawal',
       0, -3.1, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'withdrawal', 'USDT', -1005.0, 'VALR_C999_20260219132309_004',
          '2026-02-19T13:23:09+00:00', 'VALR_BF_VALR_C999_20260219132309_004', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Send', 'fee_amount', 4.0, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-02-19', 'withdrawal',
       0, -1005.0, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 4000.0, 'VALR_C999_20260325234958_003',
          '2026-03-25T23:49:58+00:00', 'VALR_BF_VALR_C999_20260325234958_003', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-03-25', 'topup',
       0, 0, 4000.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_deposit', 'ZAR', 10000.0, 'VALR_C999_20260325235115_002',
          '2026-03-25T23:51:15+00:00', 'VALR_BF_VALR_C999_20260325235115_002', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Deposit'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-03-25', 'topup',
       0, 0, 10000.0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'deposit', 'USDT', 817.44604382, '019d28d5-879e-7bbe-9603-015281c92253',
          '2026-03-26T07:40:56+00:00', 'VALR_BF_019d28d5-879e-7bbe-9603-015281c92253_CREDIT_001', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'credit', 'conversion_from', 'ZAR', 'conversion_from_amount', 13990.84044845, 'fee_amount', 1.47405618, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-03-26', 'topup',
       0, 817.44604382, 0, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
WITH ins AS (
  INSERT INTO lth_pvr.exchange_funding_events
    (funding_id, org_id, customer_id, exchange_account_id, kind, asset, amount, ext_ref, occurred_at, idempotency_key, metadata)
  VALUES (gen_random_uuid(), 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, '1da38bcb-8c24-464d-81a0-7b388f84c8b3',
          'zar_withdrawal', 'ZAR', -13990.84044845, '019d28d5-879e-7bbe-9603-015281c92253',
          '2026-03-26T07:40:56+00:00', 'VALR_BF_019d28d5-879e-7bbe-9603-015281c92253_DEBIT_001', jsonb_build_object('source', 'csv_backfill', 'tx_type', 'Limit Buy', 'pair', 'USDTZAR', 'leg', 'debit', 'conversion_to', 'USDT', 'conversion_to_amount', 817.44604382, 'fee_amount', 1.47405618, 'fee_asset', 'USDT'))
  RETURNING funding_id
)
INSERT INTO lth_pvr.ledger_lines
    (org_id, customer_id, trade_date, kind, amount_btc, amount_usdt, amount_zar, fee_btc, fee_usdt, platform_fee_btc, platform_fee_usdt, note)
SELECT 'b0a77009-03b9-44a1-ae1d-34f157d44a8b', 999, DATE '2026-03-26', 'withdrawal',
       0, 0, -13990.84044845, 0, 0, 0, 0,
       'funding:' || ins.funding_id::text
FROM ins;
