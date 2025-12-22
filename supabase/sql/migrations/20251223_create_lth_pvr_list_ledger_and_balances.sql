-- Creates RPC used by LTH PVR – Ledger & Balances UI card
create or replace function public.lth_pvr_list_ledger_and_balances(
  from_date    date,
  portfolio_id uuid,
  to_date      date default null
)
returns table (
  event_date  date,
  event_type  text,
  btc_delta   numeric,
  usdt_delta  numeric,
  note        text
)
language sql
as $$
  with p as (
    select org_id, customer_id
    from public.customer_portfolios
    where portfolio_id = $2
  )
  select
    l.trade_date::date as event_date,
    l.kind             as event_type,
    l.amount_btc       as btc_delta,
    l.amount_usdt      as usdt_delta,
    l.note
  from lth_pvr.ledger_lines l
  join p
    on p.org_id      = l.org_id
   and p.customer_id = l.customer_id
  where ($1 is null or l.trade_date >= $1)
    and ($3 is null or l.trade_date <= $3)
  order by l.trade_date, l.created_at;
$$;
