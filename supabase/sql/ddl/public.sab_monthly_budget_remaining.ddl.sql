create view public.sab_monthly_budget_remaining as
with
  m as (
    select
      d.customer_id,
      d.exchange,
      d.month_yyyymm,
      to_date(d.month_yyyymm || '-01'::text, 'YYYY-MM-DD'::text) as month_date,
      COALESCE(d.usdt_in, 0::numeric) as usdt_in,
      COALESCE(d.usdt_out, 0::numeric) as usdt_out,
      COALESCE(d.usdt_in, 0::numeric) - COALESCE(d.usdt_out, 0::numeric) as monthly_remaining
    from
      sab_monthly_budgets_derived d
  ),
  x as (
    select
      m.customer_id,
      m.exchange,
      m.month_yyyymm,
      m.month_date,
      m.usdt_in,
      m.usdt_out,
      m.monthly_remaining,
      lag(m.monthly_remaining) over (
        partition by
          m.customer_id,
          m.exchange
        order by
          m.month_date
      ) as prev_monthly_remaining
    from
      m
  ),
  bounds as (
    select
      date_trunc('month'::text, (now() AT TIME ZONE 'UTC'::text))::date as curr_month_utc
  )
select
  x.customer_id,
  x.exchange,
  x.month_yyyymm,
  x.monthly_remaining + case
    when x.month_date <= b.curr_month_utc then GREATEST(
      0::numeric,
      COALESCE(x.prev_monthly_remaining, 0::numeric)
    )
    else 0::numeric
  end as remaining_usdt
from
  x
  cross join bounds b;