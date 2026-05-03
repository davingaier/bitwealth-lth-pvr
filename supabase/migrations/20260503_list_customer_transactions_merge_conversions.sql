-- 20260503_list_customer_transactions_merge_conversions.sql
--
-- Back-port of the v0.6.102 / Part F live patch. The function body was
-- rewritten via MCP on 2026-05-03 so that ZAR<->USDT (and any future)
-- multi-leg conversions render as a single row in the customer-portal
-- Transactions tab instead of two adjacent legs (one ZAR withdrawal,
-- one USDT topup) keyed off the same VALR fill.
--
-- Grouping rule: legs share a conv_key derived from
--   COALESCE(NULLIF(conversion_metadata->>'original_transaction_id',''),
--            conversion_approval_id::text)
-- and the conv_groups CTE only collapses keys with count(*) > 1, so
-- single-leg conversion-tagged rows pass through unchanged.
--
-- See docs/SDD_v0.6.md §0 v0.6.102 Part F for context.

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
  fee_btc             numeric,
  fee_usdt            numeric,
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
      ll.fee_btc,
      ll.fee_usdt,
      ll.platform_fee_btc,
      ll.platform_fee_usdt,
      ll.note,
      ll.conversion_metadata,
      fe.ext_ref,
      ll.created_at,
      -- Conversion grouping key: prefer original_transaction_id from metadata,
      -- fall back to conversion_approval_id, otherwise NULL (=> not a conversion).
      COALESCE(
        NULLIF(ll.conversion_metadata->>'original_transaction_id',''),
        ll.conversion_approval_id::text
      ) AS conv_key
    FROM lth_pvr.ledger_lines ll
    LEFT JOIN lth_pvr.exchange_funding_events fe
      ON ll.note = 'funding:' || fe.funding_id::text
    WHERE ll.customer_id = p_customer_id
  ),
  -- Determine which conv_keys actually have multiple legs (true conversions).
  -- A single-row "conversion" (e.g. fee-only adjustment) is left as-is.
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
    -- Merged conversion rows
    SELECT
      max(f.trade_date)                          AS trade_date,
      'conversion'::text                         AS kind,
      sum(f.amount_btc)                          AS amount_btc,
      sum(f.amount_usdt)                         AS amount_usdt,
      sum(f.amount_zar)                          AS amount_zar,
      sum(f.fee_btc)                             AS fee_btc,
      sum(f.fee_usdt)                            AS fee_usdt,
      sum(f.platform_fee_btc)                    AS platform_fee_btc,
      sum(f.platform_fee_usdt)                   AS platform_fee_usdt,
      string_agg(DISTINCT f.note, ' | ')         AS note,
      -- Build a single metadata object: prefer the leg that carries
      -- conversion_to / conversion_from descriptors, else the first
      -- non-empty metadata leg.
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
      f.trade_date, f.kind, f.amount_btc, f.amount_usdt, f.amount_zar,
      f.fee_btc, f.fee_usdt, f.platform_fee_btc, f.platform_fee_usdt,
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
