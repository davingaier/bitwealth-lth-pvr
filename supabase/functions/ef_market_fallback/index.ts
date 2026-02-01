import { createClient } from "jsr:@supabase/supabase-js@2";
import { logAlert } from "../_shared/alerting.ts";

// VALR signature helper (inline to avoid import issues)
async function signVALR(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secret: string,
): Promise<string> {
  const payload = timestamp + method.toUpperCase() + path + body;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const org_id = Deno.env.get("ORG_ID");

const VALR_API_KEY = Deno.env.get("VALR_API_KEY") ?? "";
const VALR_API_SECRET = Deno.env.get("VALR_API_SECRET") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  db: { schema: "lth_pvr" },
});

// Fallback triggers:
// 1. Order age > 5 minutes
// 2. Price moved > 0.25% from order price
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const PRICE_MOVE_THRESHOLD = 0.0025; // 0.25%

Deno.serve(async (_req: Request) => {
  console.log("ef_market_fallback: Checking for stale LIMIT orders");

  // 1) Find stale LIMIT orders that need conversion to MARKET
  const { data: staleOrders, error: queryError } = await supabase
    .from("exchange_orders")
    .select(
      `
      exchange_order_id,
      org_id,
      exchange_account_id,
      intent_id,
      ext_order_id,
      pair,
      side,
      price,
      qty,
      status,
      submitted_at
    `,
    )
    .eq("status", "submitted")
    .not("ext_order_id", "is", null); // Only orders that were actually submitted to VALR

  if (queryError) {
    console.error("ef_market_fallback: Failed to query orders", queryError);
    return new Response(
      JSON.stringify({ error: "Failed to query orders" }),
      { status: 500 },
    );
  }

  if (!staleOrders || staleOrders.length === 0) {
    console.log("ef_market_fallback: No orders requiring fallback");
    return new Response(
      JSON.stringify({
        success: true,
        processed: 0,
        message: "No stale orders",
      }),
      { status: 200 },
    );
  }

  console.log(`ef_market_fallback: Checking ${staleOrders.length} submitted orders`);

  let converted = 0;
  const now = Date.now();

  for (const order of staleOrders) {
    const ageMs = now - new Date(order.submitted_at).getTime();
    const ageMinutes = Math.floor(ageMs / 60000);

    // Check if order is old enough for fallback
    if (ageMs < MAX_AGE_MS) {
      continue; // Not old enough yet
    }

    console.log(
      `ef_market_fallback: Order ${order.exchange_order_id} is ${ageMinutes} min old, triggering MARKET fallback`,
    );

    try {
      // 2) Get subaccount for this order
      const { data: exAcc, error: exErr } = await supabase
        .schema("public")
        .from("exchange_accounts")
        .select("subaccount_id")
        .eq("exchange_account_id", order.exchange_account_id)
        .limit(1)
        .single();

      if (exErr || !exAcc?.subaccount_id) {
        console.error(
          `ef_market_fallback: No subaccount for exchange_account_id=${order.exchange_account_id}`,
        );
        await logAlert(
          supabase,
          "ef_market_fallback",
          "error",
          "Missing subaccount for market fallback",
          { exchange_order_id: order.exchange_order_id },
          order.org_id,
          null,
        );
        continue;
      }

      // 3) Cancel the LIMIT order on VALR
      const cancelPath = `/v1/orders/order`;
      const cancelBody = JSON.stringify({
        orderId: order.ext_order_id,
        pair: order.pair.replace("/", ""),
      });

      const cancelTimestamp = Date.now().toString();
      const cancelSignature = await signVALR(
        cancelTimestamp,
        "DELETE",
        cancelPath,
        cancelBody,
        VALR_API_SECRET,
      );

      const cancelResponse = await fetch(`https://api.valr.com${cancelPath}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-VALR-API-KEY": VALR_API_KEY,
          "X-VALR-SIGNATURE": cancelSignature,
          "X-VALR-TIMESTAMP": cancelTimestamp,
          "X-VALR-SUB-ACCOUNT-ID": exAcc.subaccount_id,
        },
        body: cancelBody,
      });

      if (!cancelResponse.ok) {
        const cancelError = await cancelResponse.text();
        console.error(
          `ef_market_fallback: Failed to cancel order ${order.ext_order_id}: ${cancelError}`,
        );
        // Continue anyway - order might already be filled/cancelled
      } else {
        console.log(`ef_market_fallback: Cancelled LIMIT order ${order.ext_order_id}`);
      }

      // 4) Update exchange_orders status
      await supabase
        .from("exchange_orders")
        .update({
          status: "cancelled_for_market",
          requires_polling: false,
        })
        .eq("exchange_order_id", order.exchange_order_id);

      // 5) Create new MARKET order intent
      const { data: newIntent, error: intentError } = await supabase
        .from("order_intents")
        .insert({
          org_id: order.org_id,
          customer_id: null, // Will be looked up from original intent
          trade_date: new Date().toISOString().split("T")[0],
          pair: order.pair,
          side: order.side,
          amount: order.qty,
          limit_price: null, // NULL = MARKET order
          status: "pending",
          reason: "market_fallback",
          note: `Converted from LIMIT order ${order.exchange_order_id} after ${ageMinutes} minutes`,
          idempotency_key: `market_fallback_${order.exchange_order_id}_${now}`,
        })
        .select("intent_id")
        .single();

      if (intentError || !newIntent) {
        console.error(
          `ef_market_fallback: Failed to create MARKET intent for ${order.exchange_order_id}`,
          intentError,
        );
        await logAlert(
          supabase,
          "ef_market_fallback",
          "error",
          "Failed to create MARKET order intent",
          { exchange_order_id: order.exchange_order_id, error: intentError },
          order.org_id,
          null,
        );
        continue;
      }

      console.log(
        `ef_market_fallback: Created MARKET intent ${newIntent.intent_id} from ${order.exchange_order_id}`,
      );

      // 6) Trigger ef_execute_orders to place the MARKET order
      const executeUrl = `${supabaseUrl}/functions/v1/ef_execute_orders`;
      const executeResponse = await fetch(executeUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseServiceRoleKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!executeResponse.ok) {
        const executeError = await executeResponse.text();
        console.error(
          `ef_market_fallback: Failed to execute MARKET order: ${executeError}`,
        );
        await logAlert(
          supabase,
          "ef_market_fallback",
          "error",
          "Failed to execute MARKET order",
          { intent_id: newIntent.intent_id, error: executeError },
          order.org_id,
          null,
        );
        continue;
      }

      console.log(`ef_market_fallback: Successfully placed MARKET order for intent ${newIntent.intent_id}`);

      // Log successful conversion
      await logAlert(
        supabase,
        "ef_market_fallback",
        "info",
        `LIMIT order converted to MARKET after ${ageMinutes} minutes`,
        {
          original_order: order.exchange_order_id,
          new_intent: newIntent.intent_id,
          side: order.side,
          qty: order.qty,
          age_minutes: ageMinutes,
        },
        order.org_id,
        null,
      );

      converted++;
    } catch (e) {
      console.error(`ef_market_fallback: Error processing ${order.exchange_order_id}:`, e);
      await logAlert(
        supabase,
        "ef_market_fallback",
        "error",
        `Market fallback failed: ${e.message}`,
        { exchange_order_id: order.exchange_order_id },
        order.org_id,
        null,
      );
    }
  }

  console.log(`ef_market_fallback: Converted ${converted} orders to MARKET`);

  return new Response(
    JSON.stringify({
      success: true,
      checked: staleOrders.length,
      converted: converted,
      message: `Converted ${converted} stale orders to MARKET`,
    }),
    { status: 200 },
  );
});
