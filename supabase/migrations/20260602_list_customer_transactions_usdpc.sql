-- Migration: 20260602_list_customer_transactions_usdpc.sql
--
-- Phase 6 (USDPC): extend list_customer_transactions to surface USDPC amounts so
-- the customer portal can render USDPC<->USDT conversions (kind='convert') and any
-- USDPC legs. Adds amount_usdpc / fee_usdpc to the result set. The conversion
-- grouping logic is unchanged (USDPC sweeps are single 'convert' legs that pass
-- through as-is). Signature changes, so DROP first.

DROP FUNCTION IF EXISTS public.list_customer_transactions(bigint, integer);

CREATE OR REPLACE FUNCTION public.list_customer_transactions(
  p_customer_id bigint,
  p_limit       integer DEFAULT 100
)
RETURNS TABLE (
  trade_date          date,
  kind                text,
  amount_btc          numeric,
  amount_usdt         numeric,
  amount_zar          numeric,
  amount_usdpc        numeric,
  fee_btc             numeric,
  fee_usdt            numeric,
  fee_usdpc           numeric,
  platform_fee_btc    numeric,
  platform_fee_usdt   numeric,
  note                text,
  conversion_metadata jsonb,
  ext_ref             text,
  created_at          timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      ll.ledger_id,
      ll.trade_date,
      ll.kind,
      ll.amount_btc,
      ll.amount_usdt,
      ll.amount_zar,
      ll.amount_usdpc,
      ll.fee_btc,
      ll.fee_usdt,
      ll.fee_usdpc,
      ll.platform_fee_btc,
      ll.platform_fee_usdt,
      ll.note,
      ll.conversion_metadata,
      fe.ext_ref,
      ll.created_at,
      COALESCE(
        NULLIF(ll.conversion_metadata->>'original_transaction_id',''),
        ll.conversion_approval_id::text
      ) AS conv_key
    FROM lth_pvr.ledger_lines ll
    LEFT JOIN lth_pvr.exchange_funding_events fe
      ON ll.note = 'funding:' || fe.funding_id::text
    WHERE ll.customer_id = p_customer_id
  ),
  conv_groups AS (
    SELECT conv_key
    FROM base
    WHERE conv_key IS NOT NULL
    GROUP BY conv_key
    HAVING count(*) > 1
  ),
  flagged AS (
    SELECT b.*, (cg.conv_key IS NOT NULL) AS is_conv_group
    FROM base b
    LEFT JOIN conv_groups cg ON cg.conv_key = b.conv_key
  ),
  merged AS (
    SELECT
      max(f.trade_date)                          AS trade_date,
      'conversion'::text                         AS kind,
      sum(f.amount_btc)                          AS amount_btc,
      sum(f.amount_usdt)                         AS amount_usdt,
      sum(f.amount_zar)                          AS amount_zar,
      sum(f.amount_usdpc)                        AS amount_usdpc,
      sum(f.fee_btc)                             AS fee_btc,
      sum(f.fee_usdt)                            AS fee_usdt,
      sum(f.fee_usdpc)                           AS fee_usdpc,
      sum(f.platform_fee_btc)                    AS platform_fee_btc,
      sum(f.platform_fee_usdt)                   AS platform_fee_usdt,
      string_agg(DISTINCT f.note, ' | ')         AS note,
      COALESCE(
        (SELECT f2.conversion_metadata FROM flagged f2
         WHERE f2.conv_key = f.conv_key
           AND (f2.conversion_metadata ? 'conversion_to'
                OR f2.conversion_metadata ? 'conversion_from')
         LIMIT 1),
        (SELECT f2.conversion_metadata FROM flagged f2
         WHERE f2.conv_key = f.conv_key
           AND f2.conversion_metadata <> '{}'::jsonb
         LIMIT 1),
        '{}'::jsonb
      )                                          AS conversion_metadata,
      max(f.ext_ref)                             AS ext_ref,
      max(f.created_at)                          AS created_at
    FROM flagged f
    WHERE f.is_conv_group
    GROUP BY f.conv_key
  ),
  passthru AS (
    SELECT
      f.trade_date, f.kind, f.amount_btc, f.amount_usdt, f.amount_zar, f.amount_usdpc,
      f.fee_btc, f.fee_usdt, f.fee_usdpc, f.platform_fee_btc, f.platform_fee_usdt,
      f.note, f.conversion_metadata, f.ext_ref, f.created_at
    FROM flagged f
    WHERE NOT f.is_conv_group
  )
  SELECT * FROM (
    SELECT * FROM merged
    UNION ALL
    SELECT * FROM passthru
  ) u
  ORDER BY u.trade_date DESC, u.created_at DESC
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_customer_transactions(bigint, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_customer_transactions(bigint, integer) TO anon;

COMMENT ON FUNCTION public.list_customer_transactions IS 'Customer transaction history from lth_pvr.ledger_lines with merged conversions. Updated 2026-06-02 to surface USDPC amounts (amount_usdpc/fee_usdpc).';
