import { getServiceClient, yyyymmdd, getCI } from "./client.ts";
Deno.serve(async ()=>{
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", {
    status: 500
  });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const yday = new Date(today.getTime() - 86400000);
  const ystr = yyyymmdd(yday);
  // customers with std-dca config
  const { data: cfgs, error } = await sb.from("lth_pvr.std_dca_config").select("*").eq("org_id", org_id);
  if (error) return new Response(error.message, {
    status: 500
  });
  const ci = await getCI(sb, ystr);
  const price = Number(ci?.btc_price ?? 0);
  if (!price) return new Response("No price for " + ystr, {
    status: 500
  });
  for (const cfg of cfgs ?? []){
    const monthStart = new Date(Date.UTC(yday.getUTCFullYear(), yday.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(yday.getUTCFullYear(), yday.getUTCMonth() + 1, 0));
    // USDT deposits in month
    const { data: dep } = await sb.from("lth_pvr.exchange_funding_events").select("amount").eq("org_id", org_id).eq("customer_id", cfg.customer_id).eq("asset", "USDT").eq("kind", "deposit").gte("occurred_at", monthStart.toISOString()).lt("occurred_at", new Date(monthEnd.getTime() + 86400000).toISOString());
    const usdtIn = (dep ?? []).reduce((a, b)=>a + Number(b.amount ?? 0), 0);
    // trading days Mon-Fri
    const daysInMonth = monthEnd.getUTCDate();
    let tradingDays = 0;
    for(let d = 1; d <= daysInMonth; d++){
      const dt = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), d));
      const dow = dt.getUTCDay();
      if (dow !== 0 && dow !== 6) tradingDays++;
    }
    const dailyUSDT = tradingDays ? +(usdtIn / tradingDays).toFixed(2) : 0;
    if (dailyUSDT <= 0) continue;
    const makerFeeBps = Number(cfg.maker_bps_base ?? 8) / 10000;
    const grossBtc = dailyUSDT / price;
    const feeBtc = +(grossBtc * makerFeeBps).toFixed(8);
    const btc = +(grossBtc - feeBtc).toFixed(8);
    await sb.from("lth_pvr.std_dca_ledger").upsert({
      org_id,
      customer_id: cfg.customer_id,
      date: ystr,
      usdt_spent: dailyUSDT,
      btc_bought: btc,
      price_used: price,
      fee_btc: feeBtc
    }, {
      onConflict: "org_id,customer_id,date"
    });
    // roll balances
    const { data: last } = await sb.from("lth_pvr.std_dca_balances_daily").select("*").eq("org_id", org_id).eq("customer_id", cfg.customer_id).lt("date", ystr).order("date", {
      ascending: false
    }).limit(1);
    const p = last?.[0] ?? {
      btc_balance: 0,
      usdt_balance: 0
    };
    const newBtc = +(Number(p.btc_balance) + btc).toFixed(8);
    const newUsdt = +(Number(p.usdt_balance) - dailyUSDT).toFixed(2);
    const nav = +(newBtc * price + newUsdt).toFixed(2);
    await sb.from("lth_pvr.std_dca_balances_daily").upsert({
      org_id,
      customer_id: cfg.customer_id,
      date: ystr,
      btc_balance: newBtc,
      usdt_balance: newUsdt,
      nav_usd: nav
    }, {
      onConflict: "org_id,customer_id,date"
    });
  }
  return new Response("ok");
});
