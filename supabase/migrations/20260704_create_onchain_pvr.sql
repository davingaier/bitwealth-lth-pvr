-- 20260704_create_onchain_pvr.sql
-- =============================================================================
-- On-Chain Charts: STH/LTH Profit-to-Volatility Ratio (PVR)
-- -----------------------------------------------------------------------------
-- Recreates the Research Bitcoin "STH/LTH Profit-to-Volatility Ratio" chart.
--
-- PVR for a holder cohort is unrealised profit normalised by the historical
-- (expanding-window) volatility of that cohort's market cap:
--
--     mc  = supply * price                 (market cap, USD)
--     rc  = supply * realized_price        (realised cap, USD)
--     pvr = (mc - rc) / expanding_std(mc)
--
-- This is algebraically identical to the validated LTH band formula used by
-- ef_fetch_rb_bands (price_at_X = (pvr*std + rc)/supply), applied independently
-- to both the STH (<155d) and LTH (155d+) cohorts.
--
-- Series stored:
--   sth_pvr        = STH unrealised profit / std(STH market cap)
--   lth_pvr        = LTH unrealised profit / std(LTH market cap)
--   pvr_ratio      = sth_pvr / lth_pvr
--   pvr_divergence = sth_pvr - lth_pvr
--
-- The expanding std is maintained incrementally via Welford's online algorithm;
-- the running state lives in lth_pvr.onchain_pvr_state so the daily append does
-- not have to recompute across full history.
-- =============================================================================

-- Daily computed series --------------------------------------------------------
create table if not exists lth_pvr.onchain_pvr_daily (
  org_id              uuid          not null,
  date                date          not null,
  btc_price           numeric(38,8),
  sth_supply          numeric(38,8),
  sth_realized_price  numeric(38,8),
  lth_supply          numeric(38,8),
  lth_realized_price  numeric(38,8),
  sth_pvr             numeric(20,6),
  lth_pvr             numeric(20,6),
  pvr_ratio           numeric(20,6),
  pvr_divergence      numeric(20,6),
  computed_at         timestamptz   not null default now(),
  primary key (org_id, date)
);

create index if not exists onchain_pvr_daily_date_idx
  on lth_pvr.onchain_pvr_daily (org_id, date);

-- Running Welford state for each cohort's market-cap expanding std -------------
create table if not exists lth_pvr.onchain_pvr_state (
  org_id     uuid primary key,
  sth_n      bigint            not null default 0,
  sth_mean   double precision  not null default 0,
  sth_m2     double precision  not null default 0,
  lth_n      bigint            not null default 0,
  lth_mean   double precision  not null default 0,
  lth_m2     double precision  not null default 0,
  last_date  date,
  updated_at timestamptz       not null default now()
);

-- Seed an empty state row for the live org so the daily append can UPDATE it.
insert into lth_pvr.onchain_pvr_state (org_id)
values ('b0a77009-03b9-44a1-ae1d-34f157d44a8b')
on conflict (org_id) do nothing;

-- Read RPC for the Admin UI (On-Chain Charts module) --------------------------
-- SECURITY DEFINER so the anon/authenticated UI role can read the lth_pvr data
-- without direct table grants. Org is fixed to the live org (matches the
-- convention used by lth_pvr.get_pipeline_status()).
create or replace function public.get_onchain_pvr_series(
  p_from date default null,
  p_to   date default null
)
returns table (
  date            date,
  btc_price       numeric,
  sth_pvr         numeric,
  lth_pvr         numeric,
  pvr_ratio       numeric,
  pvr_divergence  numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    d.date,
    d.btc_price,
    d.sth_pvr,
    d.lth_pvr,
    d.pvr_ratio,
    d.pvr_divergence
  from lth_pvr.onchain_pvr_daily d
  where d.org_id = 'b0a77009-03b9-44a1-ae1d-34f157d44a8b'
    and (p_from is null or d.date >= p_from)
    and (p_to   is null or d.date <= p_to)
  order by d.date asc;
$function$;

grant execute on function public.get_onchain_pvr_series(date, date) to anon, authenticated;
