-- 20260704_onchain_pvr_series_json.sql
-- =============================================================================
-- Row-cap-proof reader for the On-Chain Charts module.
-- PostgREST caps set-returning results at db-max-rows (1000 on this project),
-- which truncated the full 5,600+ day history to 2010-2013. A function that
-- returns a single jsonb value is ONE row, so the entire series is delivered
-- intact. The UI (On-Chain Charts module) calls this variant.
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
        'date',           d.date,
        'btc_price',      d.btc_price,
        'sth_pvr',        d.sth_pvr,
        'lth_pvr',        d.lth_pvr,
        'pvr_ratio',      d.pvr_ratio,
        'pvr_divergence', d.pvr_divergence
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
