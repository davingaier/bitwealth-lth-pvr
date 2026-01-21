import { getServiceClient } from "./client.ts";
import { placeLimitOrder } from "./valrClient.ts";
import { logAlert } from "./alerting.ts";

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
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const i of intents ?? []){
    try {
      // find customer's exchange_account_id (from consolidated table)
      const { data: cs } = await sb.schema("public").from("customer_strategies").select("exchange_account_id").eq("org_id", org_id).eq("customer_id", i.customer_id).order("effective_from", {
        ascending: false
      }).limit(1);
      const exchange_account_id = cs?.[0]?.exchange_account_id ?? null;
      if (!exchange_account_id) {
        console.warn(`No exchange_account_id for customer ${i.customer_id}, skipping intent ${i.intent_id}`);
        await logAlert(
          sb,
          "ef_execute_orders",
          "error",
          `No exchange account configured for customer ${i.customer_id}`,
          {
            customer_id: i.customer_id,
            intent_id: i.intent_id,
            trade_date: todayDate
          },
          org_id,
          i.customer_id
        );
        errorCount++;
        continue;
      }
      // Look up VALR subaccount ID for this exchange account
      const { data: exAcc, error: exErr } = await sb.from("exchange_accounts").select("subaccount_id").eq("org_id", org_id).eq("exchange_account_id", exchange_account_id).limit(1).single();
      if (exErr) {
        console.error("exchange_accounts lookup failed", exErr);
        await logAlert(
          sb,
          "ef_execute_orders",
          "error",
          `Exchange account lookup failed: ${exErr.message}`,
          {
            customer_id: i.customer_id,
            intent_id: i.intent_id,
            exchange_account_id,
            error: exErr.message
          },
          org_id,
          i.customer_id
        );
        errorCount++;
        continue;
      }
      const subaccountId = exAcc?.subaccount_id ?? null;
      if (!subaccountId) {
        console.warn(`No subaccount_id for exchange_account_id ${exchange_account_id}, skipping intent ${i.intent_id}`);
        await logAlert(
          sb,
          "ef_execute_orders",
          "critical",
          `No VALR subaccount mapped for exchange_account_id ${exchange_account_id}`,
          {
            customer_id: i.customer_id,
            intent_id: i.intent_id,
            exchange_account_id,
            trade_date: todayDate
          },
          org_id,
          i.customer_id
        );
        errorCount++;
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
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error("VALR place order failed", e);
        
        // Check if it's a rate limit error
        const isRateLimit = errMsg.toLowerCase().includes("rate limit") || errMsg.includes("429");
        const severity = isRateLimit ? "warn" : "error";
        
        await logAlert(
          sb,
          "ef_execute_orders",
          severity,
          `VALR order placement failed: ${errMsg}`,
          {
            customer_id: i.customer_id,
            intent_id: i.intent_id,
            side,
            pair,
            price: priceStr,
            quantity: qtyStr,
            error: errMsg,
            rate_limited: isRateLimit
          },
          org_id,
          i.customer_id
        );
        
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
            error: errMsg
          }
        });
        await sb.from("order_intents").update({
          status: "error"
        }).eq("intent_id", i.intent_id);
        errorCount++;
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
        await logAlert(
          sb,
          "ef_execute_orders",
          "error",
          `Failed to insert exchange_order: ${eo.error.message}`,
          {
            customer_id: i.customer_id,
            intent_id: i.intent_id,
            ext_order_id: extId,
            error: eo.error.message
          },
          org_id,
          i.customer_id
        );
        errorCount++;
        continue;
      }
      // Mark intent as executed (handed off to exchange)
      await sb.from("order_intents").update({
        status: "executed"
      }).eq("intent_id", i.intent_id);
      successCount++;
    } catch (err) {
      console.error(`Order execution failed for intent ${i.intent_id}:`, err);
      await logAlert(
        sb,
        "ef_execute_orders",
        "error",
        `Order execution failed for intent ${i.intent_id}`,
        {
          customer_id: i.customer_id,
          intent_id: i.intent_id,
          trade_date: todayDate,
          error: err instanceof Error ? err.message : String(err)
        },
        org_id,
        i.customer_id
      );
      errorCount++;
    }
  }
  
  console.info(`ef_execute_orders: success=${successCount}, errors=${errorCount}`);
  
  // --- NEW: Initiate WebSocket monitoring for submitted orders ---
  if (successCount > 0) {
    try {
      // Get all submitted orders from today
      const { data: submittedOrders, error: ordersErr } = await sb
        .from("exchange_orders")
        .select("intent_id, exchange_account_id")
        .eq("org_id", org_id)
        .eq("status", "submitted")
        .gte("submitted_at", todayDate + "T00:00:00Z");

      if (!ordersErr && submittedOrders && submittedOrders.length > 0) {
        // Group orders by exchange_account_id to get subaccount_id
        const accountGroups = new Map<string, string[]>();
        
        for (const order of submittedOrders) {
          const accountId = order.exchange_account_id;
          if (!accountGroups.has(accountId)) {
            accountGroups.set(accountId, []);
          }
          accountGroups.get(accountId)!.push(order.intent_id);
        }

        // Launch WebSocket monitor for each subaccount
        for (const [accountId, orderIds] of accountGroups.entries()) {
          const { data: exAcc } = await sb
            .from("exchange_accounts")
            .select("subaccount_id")
            .eq("exchange_account_id", accountId)
            .single();

          const subaccountId = exAcc?.subaccount_id;

          if (subaccountId) {
            // Call WebSocket monitor Edge Function (non-blocking)
            const wsUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ef_valr_ws_monitor`;
            fetch(wsUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SECRET_KEY")}`,
              },
              body: JSON.stringify({
                order_ids: orderIds,
                subaccount_id: subaccountId,
              }),
            }).catch((err) => {
              console.warn("Failed to initiate WebSocket monitor:", err);
              // Non-critical: polling will handle as fallback
            });

            // Mark orders as WebSocket monitored
            await sb
              .from("exchange_orders")
              .update({
                ws_monitored_at: new Date().toISOString(),
                requires_polling: true, // Still require polling as safety net
              })
              .in("intent_id", orderIds);

            console.log(
              `ef_execute_orders: Initiated WebSocket monitoring for ${orderIds.length} orders (subaccount ${subaccountId.substring(0, 8)}...)`,
            );
          }
        }
      }
    } catch (wsErr) {
      console.warn("WebSocket monitor setup failed (non-critical):", wsErr);
      // Polling will handle as fallback
    }
  }
  
  return new Response("ok");
});
