-- Fix fee_usdt rounding precision
-- Bug: fee_usdt was being rounded to 2dp, causing tiny USDT fees (< 0.01) to be zeroed out
-- Solution: Change fee_usdt rounding from 2dp to 8dp (same as fee_btc)
-- Example: SELL 0.00001396 BTC @ $77,616 = $1.08 with 0.1% fee = $0.00108352 was rounded to $0.00

CREATE OR REPLACE FUNCTION lth_pvr.fn_round_financial()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
begin
  -- BTC amounts (8dp)
  if tg_op in ('INSERT','UPDATE') then
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'amount_btc') then
      new.amount_btc := lth_pvr.fn_round_or_null(new.amount_btc, 8);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'btc_balance') then
      new.btc_balance := lth_pvr.fn_round_or_null(new.btc_balance, 8);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'btc_bought') then
      new.btc_bought := lth_pvr.fn_round_or_null(new.btc_bought, 8);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'qty') then
      new.qty := lth_pvr.fn_round_or_null(new.qty, 8);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'fee_btc') then
      new.fee_btc := lth_pvr.fn_round_or_null(new.fee_btc, 8);
    end if;
  end if;

  -- USDT amounts (2dp) and prices (2dp)
  if tg_op in ('INSERT','UPDATE') then
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'amount_usdt') then
      new.amount_usdt := lth_pvr.fn_round_or_null(new.amount_usdt, 2);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'usdt_balance') then
      new.usdt_balance := lth_pvr.fn_round_or_null(new.usdt_balance, 2);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'nav_usd') then
      new.nav_usd := lth_pvr.fn_round_or_null(new.nav_usd, 2);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'price') then
      new.price := lth_pvr.fn_round_or_null(new.price, 2);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'price_used') then
      new.price_used := lth_pvr.fn_round_or_null(new.price_used, 2);
    end if;
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'limit_price') then
      new.limit_price := lth_pvr.fn_round_or_null(new.limit_price, 2);
    end if;
    -- FIX: Changed from 2dp to 8dp to preserve tiny USDT fees
    if exists(select 1 from information_schema.columns
              where table_schema = tg_table_schema and table_name = tg_table_name and column_name = 'fee_usdt') then
      new.fee_usdt := lth_pvr.fn_round_or_null(new.fee_usdt, 8);
    end if;
  end if;

  return new;
end;
$$;
