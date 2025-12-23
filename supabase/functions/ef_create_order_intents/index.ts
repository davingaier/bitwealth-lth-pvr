import { getServiceClient } from "./client.ts";
Deno.serve(async ()=>{
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  if (!org_id) return new Response("ORG_ID missing", {
    status: 500
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  const minQuote = Number(Deno.env.get("MIN_QUOTE_USDT") ?? "0.52"); // VALR placeholder
  // 1) today's BUY/SELL decisions
  const { data: decs, error: decErr } = await sb.from("decisions_daily").select("*").eq("org_id", org_id).eq("trade_date", todayStr).in("action", [
    "BUY",
    "SELL"
  ]);
  if (decErr) return new Response(decErr.message, {
    status: 500
  });
  for (const d of decs ?? []){
    // 2) latest balance as of trade date
    const { data: lastBal, error: balErr } = await sb.from("balances_daily").select("*").eq("org_id", org_id).eq("customer_id", d.customer_id).lte("date", d.trade_date).order("date", {
      ascending: false
    }).limit(1);
    if (balErr) {
      console.error(balErr);
      continue;
    }
    const bal = lastBal?.[0] ?? {
      usdt_balance: 0,
      btc_balance: 0
    };
    // 3) sizing
    let side = d.action;
    let notional = 0;
    let qtyBase = 0;
    if (side === "BUY") {
      // reserve-aware available USDT + carry bucket
      const av = await sb.rpc("fn_usdt_available_for_trading", {
        p_org: org_id,
        p_customer: d.customer_id
      });
      const ck = await sb.rpc("fn_carry_peek", {
        p_org: org_id,
        p_customer: d.customer_id,
        p_asset: "USDT"
      });
      const avail = Number(av.data ?? 0) + Number(ck.data ?? 0);
      notional = +(avail * Number(d.amount_pct)).toFixed(2);
      if (notional < minQuote) {
        // accumulate carry and skip
        await sb.rpc("fn_carry_add", {
          p_org: org_id,
          p_customer: d.customer_id,
          p_amount: notional,
          p_asset: "USDT"
        });
        continue;
      }
      const price = Number(d.price_usd);
      qtyBase = +(notional / price).toFixed(8);
      const useFromCarry = Math.min(Number(ck.data ?? 0), notional);
      if (useFromCarry > 0) await sb.rpc("fn_carry_consume", {
        p_org: org_id,
        p_customer: d.customer_id,
        p_amount: useFromCarry,
        p_asset: "USDT"
      });
    } else {
      // SELL % of BTC
      qtyBase = +(Number(bal.btc_balance) * Number(d.amount_pct)).toFixed(8);
      if (qtyBase <= 0) continue;
    }
    // 4) write intent
    const idKey = crypto.randomUUID(); // can switch to hash(org,cust,date,side) if you prefer
    const ins = await sb.from("order_intents").upsert({
      org_id,
      customer_id: d.customer_id,
      trade_date: d.trade_date,
      side,
      amount: qtyBase,
      limit_price: Number(d.price_usd),
      idempotency_key: idKey,
      reason: d.rule,
      note: d.note
    }, {
      onConflict: "idempotency_key"
    });
    if (ins.error) console.error("intent error", ins.error);
  }
  return new Response("ok");
});
