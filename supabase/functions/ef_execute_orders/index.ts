import { getServiceClient } from "./client.ts";
import { placeLimitOrder } from "./valrClient.ts";
Deno.serve(async ()=>{
  const sb = getServiceClient();
  const org_id = Deno.env.get("ORG_ID");
  const todayDate = new Date().toISOString().slice(0, 10);
  if (!org_id) return new Response("ORG_ID missing", {
    status: 500
  });
  const todayStr = new Date().toISOString().slice(0, 10);
  // pending intents for today
  const { data: intents, error } = await sb.from("order_intents").select("*").eq("org_id", org_id).eq("status", "pending").eq("trade_date", todayDate);
  if (error) {
    console.error("order_intents select failed", error);
    return new Response(error.message, {
      status: 500
    });
  }
  const count = intents?.length ?? 0;
  console.log(`ef_execute_orders: found ${count} pending intents for org ${org_id} and trade_date ${todayDate}`);
  if (!intents || intents.length === 0) {
    return new Response(`no pending intents for org ${org_id} and trade_date ${todayDate}`, {
      status: 200
    });
  }
  for (const i of intents ?? []){
    // find customer's exchange_account_id
    const { data: cs } = await sb.from("customer_strategies").select("exchange_account_id").eq("org_id", org_id).eq("customer_id", i.customer_id).order("effective_from", {
      ascending: false
    }).limit(1);
    const exchange_account_id = cs?.[0]?.exchange_account_id ?? null;
    if (!exchange_account_id) {
      console.warn(`No exchange_account_id for customer ${i.customer_id}, skipping intent ${i.intent_id}`);
      continue;
    }
    // Look up VALR subaccount ID for this exchange account
    const { data: exAcc, error: exErr } = await sb.from("exchange_accounts").select("subaccount_id").eq("org_id", org_id).eq("exchange_account_id", exchange_account_id).limit(1).single();
    if (exErr) {
      console.error("exchange_accounts lookup failed", exErr);
      continue;
    }
    const subaccountId = exAcc?.subaccount_id ?? null;
    if (!subaccountId) {
      console.warn(`No subaccount_id for exchange_account_id ${exchange_account_id}, skipping intent ${i.intent_id}`);
      continue;
    }
    // --- PLACE LIMIT ORDER on VALR ---
    const side = i.side.toUpperCase() === "SELL" ? "SELL" : "BUY";
    const pair = "BTCUSDT"; // VALR pair code (vs "BTC/USDT" internal) 
    const priceStr = String(i.limit_price);
    const qtyStr = String(i.amount);
    let valrResp;
    try {
      valrResp = await placeLimitOrder({
        side,
        pair,
        price: priceStr,
        quantity: qtyStr,
        customerOrderId: i.intent_id,
        timeInForce: "GTC",
        postOnly: false
      }, subaccountId);
    } catch (e) {
      console.error("VALR place order failed", e);
      await sb.from("exchange_orders").insert({
        org_id,
        exchange_account_id,
        intent_id: i.intent_id,
        pair: "BTC/USDT",
        side,
        price: i.limit_price,
        qty: i.amount,
        status: "error",
        raw: {
          error: String(e?.message ?? e)
        }
      });
      await sb.from("order_intents").update({
        status: "error"
      }).eq("intent_id", i.intent_id);
      continue;
    }
    const extId = valrResp?.orderId ?? valrResp?.id;
    const eo = await sb.from("exchange_orders").insert({
      org_id,
      exchange_account_id,
      intent_id: i.intent_id,
      ext_order_id: extId,
      pair: "BTC/USDT",
      side,
      price: i.limit_price,
      qty: i.amount,
      status: "submitted",
      raw: {
        valr: valrResp,
        subaccountId
      }
    });
    if (eo.error) {
      console.error(eo.error);
      continue;
    }
    // Mark intent as executed (handed off to exchange)
    await sb.from("order_intents").update({
      status: "executed"
    }).eq("intent_id", i.intent_id);
  }
  return new Response("ok");
});
