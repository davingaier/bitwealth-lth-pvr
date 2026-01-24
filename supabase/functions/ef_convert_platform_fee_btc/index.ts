// Edge Function: ef_convert_platform_fee_btc
// Purpose: Auto-convert BitWealth's collected BTC platform fees to USDT
// Trigger: Called after successful BTC platform fee transfer to main account
// Flow: Place MARKET order on main account to sell BTC → USDT
// Deployed with: --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { signVALR } from "../_shared/valr.ts";
import { logAlert } from "../_shared/alerting.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");
const valrApiKey = Deno.env.get("VALR_API_KEY");
const valrApiSecret = Deno.env.get("VALR_API_SECRET");
const mainAccountId = Deno.env.get("VALR_MAIN_ACCOUNT_ID") || "";

if (!supabaseUrl || !supabaseKey || !orgId || !valrApiKey || !valrApiSecret) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "lth_pvr" }
});

// Place VALR MARKET order on main account
async function placeMarketOrder(
  side: "BUY" | "SELL",
  pair: string,
  baseAmount: number
): Promise<{ orderResult: any; customerOrderId: string }> {
  const timestamp = Date.now().toString();
  const method = "POST";
  const path = "/v1/orders/market";
  
  // Generate short order ID (max 50 chars): PFC_{timestamp}
  const customerOrderId = `PFC-${Date.now()}`;
  
  const body = JSON.stringify({
    side,
    baseAmount: baseAmount.toFixed(8),
    pair,
    customerOrderId,
  });

  const signature = await signVALR(timestamp, method, path, body, valrApiSecret, "");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-VALR-API-KEY": valrApiKey,
    "X-VALR-SIGNATURE": signature,
    "X-VALR-TIMESTAMP": timestamp,
  };

  // Don't send X-VALR-SUB-ACCOUNT-ID header for main account operations
  // Omitting the header means main account

  const response = await fetch(`https://api.valr.com${path}`, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VALR MARKET order failed: ${response.status} - ${errorText}`);
  }

  const orderResult = await response.json();
  return { orderResult, customerOrderId };
}

Deno.serve(async (req) => {
  // CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    console.log("[ef_convert_platform_fee_btc] Starting BTC → USDT conversion for platform fees");

    // Parse request body
    const body = await req.json();
    const btcAmount = Number(body.btc_amount);
    const customerId = body.customer_id; // Optional: for tracking purposes
    const transferId = body.transfer_id; // Optional: reference to the transfer that triggered this

    if (!btcAmount || btcAmount <= 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid BTC amount" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    console.log(`[ef_convert_platform_fee_btc] Converting ${btcAmount} BTC to USDT (customer: ${customerId || 'N/A'})`);

    // Place MARKET order to sell BTC → USDT
    const { orderResult, customerOrderId } = await placeMarketOrder("SELL", "BTCUSDT", btcAmount);

    console.log("[ef_convert_platform_fee_btc] Market order placed:", JSON.stringify(orderResult));

    // For MARKET orders on BTC/USDT, VALR fills instantly
    // We trust the order placement succeeded (we got order ID back)
    // Calculate approximate USDT value assuming current spot price
    // Actual fill price will be logged in VALR dashboard
    
    console.log(`[ef_convert_platform_fee_btc] BTC platform fee converted: ${btcAmount} BTC (order ID: ${orderResult.id})`);

    // Log for audit trail
    await logAlert(
      supabase,
      "ef_convert_platform_fee_btc",
      "info",
      `Platform fee BTC converted to USDT: ${btcAmount.toFixed(8)} BTC (order ${orderResult.id})`,
      {
        order_id: orderResult.id,
        customer_order_id: customerOrderId,
        btc_amount: btcAmount,
        customer_id: customerId,
        transfer_id: transferId,
      },
      orgId,
      customerId,
    );

    return new Response(
      JSON.stringify({
        success: true,
        btc_sold: btcAmount,
        order_id: orderResult.id,
        customer_order_id: customerOrderId,
        message: "MARKET order placed - BTC converted to USDT (check VALR dashboard for fill details)",
      }),
      {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  } catch (error) {
    console.error("[ef_convert_platform_fee_btc] Error:", error);

    await logAlert(
      supabase,
      "ef_convert_platform_fee_btc",
      "error",
      `BTC conversion failed: ${error.message}`,
      { error: error.message, stack: error.stack },
      orgId,
      null,
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  }
});
