-- USDPC yield-stablecoin feature — Phase 3: buying-power RPC.
--
-- fn_usdt_available_for_trading now returns BUYING POWER for USDPC-enabled
-- strategies: idle USDT plus the USDT value of the USDPC holding (valued at the
-- latest USDPC/USDT price). For non-enabled strategies behaviour is unchanged
-- (idle USDT only). BUY sizing multiplies this by amount_pct; the executor then
-- converts just-enough USDPC->USDT to fund the buy.

CREATE OR REPLACE FUNCTION lth_pvr.fn_usdt_available_for_trading(p_org uuid, p_customer bigint)
RETURNS numeric
LANGUAGE plpgsql
AS $function$
declare
  v_usdt   numeric := 0;
  v_usdpc  numeric := 0;
  v_price  numeric := 1;
  v_enabled boolean := false;
begin
  -- Latest balance row (USDT + USDPC units).
  select coalesce(b.usdt_balance, 0), coalesce(b.usdpc_balance, 0)
    into v_usdt, v_usdpc
  from lth_pvr.balances_daily b
  where b.org_id = p_org and b.customer_id = p_customer
  order by b.date desc
  limit 1;

  -- Is USDPC sweeping enabled for this customer's LTH PVR strategy?
  select coalesce(cs.usdpc_enabled, false)
    into v_enabled
  from public.customer_strategies cs
  where cs.org_id = p_org
    and cs.customer_id = p_customer
    and cs.strategy_code = 'LTH_PVR'
  order by cs.effective_from desc nulls last
  limit 1;

  if not coalesce(v_enabled, false) or coalesce(v_usdpc, 0) <= 0 then
    return coalesce(v_usdt, 0);
  end if;

  -- Latest known USDPC price (USDT per USDPC); default 1.0 if none yet.
  select price_usd into v_price
  from lth_pvr.usdpc_prices_daily
  order by date desc
  limit 1;
  v_price := coalesce(v_price, 1);

  return coalesce(v_usdt, 0) + coalesce(v_usdpc, 0) * v_price;
end;
$function$;
