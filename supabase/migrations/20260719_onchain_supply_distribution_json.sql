-- 20260719_onchain_supply_distribution_json.sql
-- =============================================================================
-- Expose STH/LTH supply fields through the On-Chain Charts JSON RPC.
-- The data is already stored by ef_fetch_onchain_pvr; this migration only adds
-- the fields to the browser-facing SECURITY DEFINER JSON payload.
-- =============================================================================
create or replace function public.get_onchain_pvr_series_json(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date',                          d.date,
        'btc_price',                     d.btc_price,
        'sth_supply',                    d.sth_supply,
        'lth_supply',                    d.lth_supply,
        'lth_realized_price',            d.lth_realized_price,
        'coinblock_value_cum_destroyed', d.coinblock_value_cum_destroyed,
        'cvdd',                          d.cvdd,
        'sth_pvr',                       d.sth_pvr,
        'lth_pvr',                       d.lth_pvr,
        'pvr_ratio',                     d.pvr_ratio,
        'pvr_divergence',                d.pvr_divergence
      )
      order by d.date
    ),
    '[]'::jsonb
  )
  from lth_pvr.onchain_pvr_daily d
  where d.org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
    and (p_from is null or d.date >= p_from)
    and (p_to   is null or d.date <= p_to);
$function$;

grant execute on function public.get_onchain_pvr_series_json(date, date) to anon, authenticated;