create view lth_pvr.v_monthly_returns as
with
  d as (
    select
      balances_daily.org_id,
      balances_daily.customer_id,
      balances_daily.date,
      balances_daily.nav_usd,
      date_trunc(
        'month'::text,
        balances_daily.date::timestamp with time zone
      )::date as month_start
    from
      lth_pvr.balances_daily
  ),
  mm as (
    select
      s.org_id,
      s.customer_id,
      s.month_start,
      (s.month_start + '1 mon -1 days'::interval)::date as month_end,
      s.nav_usd as nav_start,
      e.nav_usd as nav_end
    from
      (
        select distinct
          on (d.org_id, d.customer_id, d.month_start) d.org_id,
          d.customer_id,
          d.month_start,
          d.date,
          d.nav_usd
        from
          d
        order by
          d.org_id,
          d.customer_id,
          d.month_start,
          d.date
      ) s
      join (
        select distinct
          on (d.org_id, d.customer_id, d.month_start) d.org_id,
          d.customer_id,
          d.month_start,
          d.date,
          d.nav_usd
        from
          d
        order by
          d.org_id,
          d.customer_id,
          d.month_start,
          d.date desc
      ) e on e.org_id = s.org_id
      and e.customer_id = s.customer_id
      and e.month_start = s.month_start
  ),
  flows as (
    select
      exchange_funding_events.org_id,
      exchange_funding_events.customer_id,
      date_trunc(
        'month'::text,
        exchange_funding_events.occurred_at
      )::date as month_start,
      sum(
        case
          when exchange_funding_events.kind = 'deposit'::text then exchange_funding_events.amount
          else 0::numeric
        end
      ) as usdt_deposits,
      sum(
        case
          when exchange_funding_events.kind = 'withdrawal'::text then exchange_funding_events.amount
          else 0::numeric
        end
      ) as usdt_withdrawals
    from
      lth_pvr.exchange_funding_events
    where
      exchange_funding_events.asset = 'USDT'::text
    group by
      exchange_funding_events.org_id,
      exchange_funding_events.customer_id,
      (
        date_trunc(
          'month'::text,
          exchange_funding_events.occurred_at
        )
      )
  ),
  f as (
    select
      mm.org_id,
      mm.customer_id,
      mm.month_start,
      mm.month_end,
      mm.nav_start,
      mm.nav_end,
      COALESCE(fl.usdt_deposits, 0::numeric) - COALESCE(fl.usdt_withdrawals, 0::numeric) as net_flows
    from
      mm
      left join flows fl on fl.org_id = mm.org_id
      and fl.customer_id = mm.customer_id
      and fl.month_start = mm.month_start
  )
select
  org_id,
  customer_id,
  month_start,
  month_end,
  nav_start,
  nav_end,
  net_flows,
  nav_end - nav_start - net_flows as profit,
  case
    when (nav_start + net_flows) = 0::numeric then null::numeric
    else (
      (nav_end - net_flows) / NULLIF(nav_start, 0::numeric) - 1::numeric
    ) * 100::numeric
  end as gross_return_pct
from
  f;