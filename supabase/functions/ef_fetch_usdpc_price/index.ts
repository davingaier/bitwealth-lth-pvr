// ef_fetch_usdpc_price — daily USDPC/USDT market-price snapshot.
//
// Fetches the current USDPC/USDT price from VALR's public market summary and
// upserts it into lth_pvr.usdpc_prices_daily for today's date. This price is the
// source of truth for valuing USDPC holdings in NAV (ef_post_ledger_and_balances).
//
// Resilience: if the live fetch fails, we DO NOT block — we fall back to the most
// recent known price (carrying it forward to today) and raise a warn alert. The
// trading pipeline must never stall on a missing stablecoin price.
//
// Cron: daily, early (before the trading window). Deploy with --no-verify-jwt.

import { getServiceClient, yyyymmdd } from "./client.ts";
import { getMarketPrice } from "../_shared/valrClient.ts";
import { loadUsdpcConfig } from "../_shared/usdpc.ts";
import { logAlert } from "../_shared/alerting.ts";

Deno.serve(async () => {
  const sb = getServiceClient();
  const today = yyyymmdd(new Date());

  const cfg = await loadUsdpcConfig(sb);

  let price: number | null = null;
  let source = "valr";

  try {
    price = await getMarketPrice(cfg.pair);
  } catch (e) {
    // Live fetch failed — carry forward the last known price.
    const { data: last } = await sb
      .schema("lth_pvr")
      .from("usdpc_prices_daily")
      .select("date, price_usd")
      .order("date", { ascending: false })
      .limit(1);

    const lastPrice = Number(last?.[0]?.price_usd);
    if (Number.isFinite(lastPrice) && lastPrice > 0) {
      price = lastPrice;
      source = "carry_forward";
      await logAlert(
        sb,
        "ef_fetch_usdpc_price",
        "warn",
        `USDPC price fetch failed; carried forward last-known price ${lastPrice}`,
        { pair: cfg.pair, last_known: lastPrice, last_date: last?.[0]?.date, error: String((e as Error)?.message ?? e) },
      );
    } else {
      // No live price and no history — cannot value USDPC. Alert and stop.
      await logAlert(
        sb,
        "ef_fetch_usdpc_price",
        "error",
        `USDPC price fetch failed and no prior price exists`,
        { pair: cfg.pair, error: String((e as Error)?.message ?? e) },
      );
      return new Response(
        JSON.stringify({ ok: false, error: "no price available" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const { error: upErr } = await sb
    .schema("lth_pvr")
    .from("usdpc_prices_daily")
    .upsert(
      { date: today, price_usd: price, source, fetched_at: new Date().toISOString() },
      { onConflict: "date" },
    );

  if (upErr) {
    await logAlert(
      sb,
      "ef_fetch_usdpc_price",
      "error",
      `Failed to upsert USDPC price`,
      { date: today, price, source, error: upErr.message },
    );
    return new Response(
      JSON.stringify({ ok: false, error: upErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, date: today, price_usd: price, source }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
