-- 20260719_onchain_pvr_json_lth_realized_price.sql
-- =============================================================================
-- Extend the row-cap-proof On-Chain Charts reader with LTH realized price.
-- The LTH MVRV Z-Score chart uses the existing lth_pvr series as its Z-score
-- and plots BTC price + LTH realized price on the right log axis.
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
        'date',               d.date,
        'btc_price',          d.btc_price,
        'lth_realized_price', d.lth_realized_price,
        'sth_pvr',            d.sth_pvr,
        'lth_pvr',            d.lth_pvr,
        'pvr_ratio',          d.pvr_ratio,
        'pvr_divergence',     d.pvr_divergence
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