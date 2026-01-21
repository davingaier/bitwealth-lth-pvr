// Edge Function: ef_auto_convert_btc_to_usdt
// Purpose: Auto-convert BTC to USDT when insufficient USDT for fees
// Trigger: Called by ef_calculate_performance_fees or manually by Admin UI
// Flow: Create approval request → Send email → Customer approves → Execute conversion
// Deployed with: --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { signVALR } from "../_shared/valr.ts";
import { logAlert } from "../_shared/alerting.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const orgId = Deno.env.get("ORG_ID");
const valrApiKey = Deno.env.get("VALR_API_KEY");
const valrApiSecret = Deno.env.get("VALR_API_SECRET");
const websiteUrl = Deno.env.get("WEBSITE_URL") || supabaseUrl;

if (!supabaseUrl || !supabaseKey || !orgId || !valrApiKey || !valrApiSecret) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: "lth_pvr" }
});

// Generate random approval token (URL-safe)
function generateApprovalToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Place VALR LIMIT order
async function placeLimitOrder(
  subaccountId: string,
  side: "BUY" | "SELL",
  pair: string,
  quantity: number,
  price: number,
  customerOrderId: string
) {
  const timestamp = Date.now().toString();
  const method = "POST";
  const path = "/v1/orders/limit";
  const body = JSON.stringify({
    side,
    quantity: quantity.toFixed(8),
    price: price.toFixed(2),
    pair,
    postOnly: false,
    customerOrderId,
  });

  const signature = await signVALR(timestamp, method, path, body, valrApiSecret, subaccountId);

  const response = await fetch(`https://api.valr.com${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-VALR-API-KEY": valrApiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VALR LIMIT order failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// Place VALR MARKET order
async function placeMarketOrder(
  subaccountId: string,
  side: "BUY" | "SELL",
  pair: string,
  quantity: number,
  customerOrderId: string
) {
  const timestamp = Date.now().toString();
  const method = "POST";
  const path = "/v1/orders/market";
  const body = JSON.stringify({
    side,
    baseAmount: quantity.toFixed(8),
    pair,
    customerOrderId,
  });

  const signature = await signVALR(timestamp, method, path, body, valrApiSecret, subaccountId);

  const response = await fetch(`https://api.valr.com${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-VALR-API-KEY": valrApiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VALR MARKET order failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// Cancel VALR order by ID
async function cancelOrder(
  orderId: string,
  subaccountId: string
) {
  const timestamp = Date.now().toString();
  const method = "DELETE";
  const path = `/v1/orders/order`;
  const body = JSON.stringify({
    orderId,
    pair: "BTCUSDT",
  });

  const signature = await signVALR(timestamp, method, path, body, valrApiSecret, subaccountId);

  const response = await fetch(`https://api.valr.com${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-VALR-API-KEY": valrApiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VALR cancel order failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// Poll order status by customer order ID
async function getOrderStatus(
  customerOrderId: string,
  subaccountId: string
) {
  const timestamp = Date.now().toString();
  const method = "GET";
  const path = `/v1/orders/history/summary/customerorderid/${customerOrderId}?currencyPair=BTCUSDT`;

  const signature = await signVALR(timestamp, method, path, "", valrApiSecret, subaccountId);

  const response = await fetch(`https://api.valr.com${path}`, {
    method,
    headers: {
      "X-VALR-API-KEY": valrApiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId,
    },
  });

  if (!response.ok) {
    throw new Error(`VALR order status fetch failed: ${response.status}`);
  }

  return await response.json();
}

// Get BTC price from VALR
async function getBTCPrice(subaccountId: string): Promise<number> {
  const timestamp = Date.now().toString();
  const method = "GET";
  const path = "/v1/marketdata/BTCUSDT/ticker";

  const signature = await signVALR(timestamp, method, path, "", valrApiSecret, subaccountId);

  const response = await fetch(`https://api.valr.com${path}`, {
    method,
    headers: {
      "X-VALR-API-KEY": valrApiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId,
    },
  });

  if (!response.ok) {
    throw new Error(`VALR price fetch failed: ${response.status}`);
  }

  const data = await response.json();
  return Number(data.lastTradedPrice || 50000);
}

// Get best ask price from VALR order book (lowest sell price - for our LIMIT SELL order)
async function getBestAskPrice(subaccountId: string): Promise<number> {
  const timestamp = Date.now().toString();
  const method = "GET";
  const path = "/v1/marketdata/BTCUSDT/orderbook";

  const signature = await signVALR(timestamp, method, path, "", valrApiSecret, subaccountId);

  const response = await fetch(`https://api.valr.com${path}`, {
    method,
    headers: {
      "X-VALR-API-KEY": valrApiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "X-VALR-SUB-ACCOUNT-ID": subaccountId,
    },
  });

  if (!response.ok) {
    throw new Error(`VALR order book fetch failed: ${response.status}`);
  }

  const data = await response.json();
  
  // Get best ask (lowest sell price - we match or slightly undercut this)
  const bestAsk = data.Asks?.[0];
  if (!bestAsk) {
    throw new Error("No asks available in order book");
  }

  // Place slightly below best ask (0.01% lower) to be at top of sell side
  const ourPrice = Number(bestAsk.price) * 0.9999;
  return ourPrice;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const action = body.action; // "create_request" or "execute_conversion"
    
    // Action 1: Create approval request
    if (action === "create_request") {
      const customerId = body.customer_id;
      const usdtNeeded = Number(body.usdt_needed || 0);
      const feeType = body.fee_type || "performance_fee"; // "performance_fee" or "platform_fee"

      if (!customerId || !usdtNeeded) {
        return new Response(
          JSON.stringify({ error: "Missing customer_id or usdt_needed" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      console.log(`Creating BTC conversion request for customer ${customerId}: $${usdtNeeded} USDT needed`);

      // Get customer details
      const { data: customer, error: customerError } = await supabase
        .schema("public")
        .from("customer_details")
        .select("first_names, last_name, email")
        .eq("customer_id", customerId)
        .single();

      if (customerError || !customer) {
        return new Response(
          JSON.stringify({ error: "Customer not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      // Get exchange account
      const { data: exchangeAcct, error: exAcctError } = await supabase
        .schema("public")
        .from("exchange_accounts")
        .select("subaccount_id")
        .eq("customer_id", customerId)
        .eq("exchange", "VALR")
        .single();

      if (exAcctError || !exchangeAcct) {
        return new Response(
          JSON.stringify({ error: "No exchange account found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const subaccountId = exchangeAcct.subaccount_id;

      // Get current BTC price
      const btcPrice = await getBTCPrice(subaccountId);
      
      // Calculate BTC needed with 2% slippage buffer
      const btcNeeded = (usdtNeeded / btcPrice) * 1.02;

      // Generate approval token
      const approvalToken = generateApprovalToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create approval request
      const { data: approvalData, error: approvalError } = await supabase
        .from("fee_conversion_approvals")
        .insert({
          org_id: orgId,
          customer_id: customerId,
          fee_type: feeType,
          usdt_needed: usdtNeeded,
          btc_to_sell: btcNeeded,
          btc_price_estimate: btcPrice,
          approval_token: approvalToken,
          status: "pending",
          expires_at: expiresAt.toISOString(),
        })
        .select("approval_id")
        .single();

      if (approvalError) {
        throw approvalError;
      }

      const approvalId = approvalData.approval_id;
      console.log(`✓ Created approval request ${approvalId}`);

      // Send approval email
      const approvalUrl = `${websiteUrl}/approve-conversion.html?token=${approvalToken}`;
      
      try {
        await fetch(`${supabaseUrl}/functions/v1/ef_send_email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": req.headers.get("authorization") || "",
          },
          body: JSON.stringify({
            template_key: "btc_conversion_approval",
            to_email: customer.email,
            data: {
              first_name: customer.first_names,
              fee_type: feeType === "performance_fee" ? "Performance Fee" : "Platform Fee",
              usdt_needed: usdtNeeded.toFixed(2),
              btc_to_sell: btcNeeded.toFixed(8),
              btc_price: btcPrice.toFixed(2),
              approval_url: approvalUrl,
              expires_at: expiresAt.toISOString().split('T')[0] + " " + expiresAt.toISOString().split('T')[1].substring(0, 5) + " UTC",
            },
          }),
        });
        console.log(`✓ Sent approval email to ${customer.email}`);
      } catch (emailError) {
        console.error("Error sending approval email:", emailError);
        // Non-critical, continue
      }

      return new Response(
        JSON.stringify({
          success: true,
          approval_id: approvalId,
          approval_token: approvalToken,
          btc_to_sell: btcNeeded,
          btc_price: btcPrice,
          expires_at: expiresAt.toISOString(),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Action 2: Execute conversion (after customer approval)
    if (action === "execute_conversion") {
      const approvalToken = body.approval_token;

      if (!approvalToken) {
        return new Response(
          JSON.stringify({ error: "Missing approval_token" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      console.log(`Executing BTC conversion for token ${approvalToken}`);

      // Get approval request
      const { data: approval, error: approvalError } = await supabase
        .from("fee_conversion_approvals")
        .select("*")
        .eq("approval_token", approvalToken)
        .eq("status", "pending")
        .single();

      if (approvalError || !approval) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired approval token" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      // Check expiry
      const expiresAt = new Date(approval.expires_at);
      if (expiresAt < new Date()) {
        await supabase
          .from("fee_conversion_approvals")
          .update({ status: "expired" })
          .eq("approval_id", approval.approval_id);

        return new Response(
          JSON.stringify({ error: "Approval expired (24 hours elapsed)" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const customerId = approval.customer_id;
      const btcToSell = Number(approval.btc_to_sell);

      // Get exchange account
      const { data: exchangeAcct, error: exAcctError } = await supabase
        .schema("public")
        .from("exchange_accounts")
        .select("subaccount_id")
        .eq("customer_id", customerId)
        .eq("exchange", "VALR")
        .single();

      if (exAcctError || !exchangeAcct) {
        return new Response(
          JSON.stringify({ error: "No exchange account found" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const subaccountId = exchangeAcct.subaccount_id;

      // Get best ask price from order book (lowest sell price)
      const limitPrice = await getBestAskPrice(subaccountId);
      const customerOrderId = `conversion_${approval.approval_id}`;

      console.log(`Placing LIMIT order: SELL ${btcToSell.toFixed(8)} BTC @ $${limitPrice.toFixed(2)} (slightly below best ask)`);

      let finalOrderId: string;
      let executionPrice: number = limitPrice;

      try {
        // Place LIMIT order slightly below best ask
        const limitOrder = await placeLimitOrder(
          subaccountId,
          "SELL",
          "BTCUSDT",
          btcToSell,
          limitPrice,
          customerOrderId
        );

        console.log(`✓ LIMIT order placed: ${limitOrder.id}`);
        finalOrderId = limitOrder.id;

        // Monitor for 5 minutes with 10-second polling intervals
        const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
        const PRICE_MOVE_THRESHOLD = 0.0025; // 0.25%
        const POLL_INTERVAL_MS = 10 * 1000; // 10 seconds
        const startTime = Date.now();
        let orderFilled = false;

        console.log(`Monitoring LIMIT order for 5 minutes (timeout at ${new Date(startTime + MAX_AGE_MS).toISOString()})`);

        while (!orderFilled && (Date.now() - startTime) < MAX_AGE_MS) {
          // Wait 10 seconds before checking
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

          try {
            // Check order status
            const orderStatus = await getOrderStatus(customerOrderId, subaccountId);
            
            if (orderStatus && Array.isArray(orderStatus) && orderStatus.length > 0) {
              const latestOrder = orderStatus[0];
              const orderState = latestOrder.orderStatusType?.toLowerCase();
              
              if (orderState === "filled") {
                console.log(`✓ LIMIT order filled: ${latestOrder.id}`);
                orderFilled = true;
                executionPrice = Number(latestOrder.averagePrice || limitPrice);
                break;
              }
            }

            // Check if price moved >= 0.25%
            const currentPrice = await getBTCPrice(subaccountId);
            const priceMove = Math.abs(currentPrice - limitPrice) / limitPrice;

            if (priceMove >= PRICE_MOVE_THRESHOLD) {
              console.log(`⚠ Price moved ${(priceMove * 100).toFixed(2)}% (>= 0.25% threshold), cancelling LIMIT and placing MARKET order`);
              
              await logAlert(
                supabase,
                "ef_auto_convert_btc_to_usdt",
                "warn",
                `BTC conversion LIMIT order cancelled due to ${(priceMove * 100).toFixed(2)}% price movement`,
                {
                  customer_id: customerId,
                  approval_id: approval.approval_id,
                  limit_price: limitPrice,
                  current_price: currentPrice,
                  price_move_pct: (priceMove * 100).toFixed(2)
                },
                orgId,
                customerId
              );
              break; // Exit loop to place MARKET order
            }

          } catch (pollError) {
            console.error("Error polling order status:", pollError);
            // Continue loop despite polling error
          }
        }

        // If order not filled after 5 minutes or price moved, cancel and place MARKET order
        if (!orderFilled) {
          const ageMs = Date.now() - startTime;
          const reason = ageMs >= MAX_AGE_MS ? "5-minute timeout" : "price movement >= 0.25%";
          
          console.log(`⚠ LIMIT order not filled after ${reason}, placing MARKET order fallback`);

          await logAlert(
            supabase,
            "ef_auto_convert_btc_to_usdt",
            "warn",
            `BTC conversion LIMIT order timeout after ${Math.round(ageMs / 60000)} minutes, executing MARKET order`,
            {
              customer_id: customerId,
              approval_id: approval.approval_id,
              limit_order_id: limitOrder.id,
              age_minutes: Math.round(ageMs / 60000)
            },
            orgId,
            customerId
          );

          // Cancel LIMIT order
          try {
            await cancelOrder(limitOrder.id, subaccountId);
            console.log(`✓ LIMIT order cancelled: ${limitOrder.id}`);
          } catch (cancelError) {
            console.error("Failed to cancel LIMIT order:", cancelError);
            // Continue with MARKET order anyway
          }

          // Place MARKET order
          const marketOrder = await placeMarketOrder(
            subaccountId,
            "SELL",
            "BTCUSDT",
            btcToSell,
            `${customerOrderId}_market`
          );

          console.log(`✓ MARKET order placed: ${marketOrder.id}`);
          finalOrderId = marketOrder.id;
          executionPrice = await getBTCPrice(subaccountId); // Use current market price
        }

        // Estimate USDT received (will be updated when order fills)
        const usdtReceived = btcToSell * executionPrice * 0.998; // Assume 0.2% VALR fee

        // Update approval status
        await supabase
          .from("fee_conversion_approvals")
          .update({
            status: "executed",
            executed_at: new Date().toISOString(),
            actual_btc_sold: btcToSell,
            actual_usdt_received: usdtReceived,
          })
          .eq("approval_id", approval.approval_id);

        // Create ledger entry
        const today = new Date().toISOString().split('T')[0];
        const { data: ledgerData, error: ledgerError } = await supabase
          .from("ledger_lines")
          .insert({
            org_id: orgId,
            customer_id: customerId,
            trade_date: today,
            kind: "btc_conversion",
            amount_btc: -btcToSell,
            amount_usdt: usdtReceived,
            conversion_approval_id: approval.approval_id,
            note: `BTC→USDT conversion for ${approval.fee_type}: ${btcToSell.toFixed(8)} BTC → $${usdtReceived.toFixed(2)} USDT`,
          })
          .select("ledger_id")
          .single();

        if (ledgerError) {
          console.error("Error creating ledger entry:", ledgerError);
          throw ledgerError;
        }

        console.log(`✓ Created ledger entry ${ledgerData.ledger_id}`);

        return new Response(
          JSON.stringify({
            success: true,
            approval_id: approval.approval_id,
            btc_sold: btcToSell,
            usdt_received: usdtReceived,
            ledger_id: ledgerData.ledger_id,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      } catch (orderError) {
        console.error("Error executing conversion:", orderError);

        // Update approval status
        await supabase
          .from("fee_conversion_approvals")
          .update({ 
            status: "failed",
            executed_at: new Date().toISOString(),
          })
          .eq("approval_id", approval.approval_id);

        await logAlert(
          supabase,
          "ef_auto_convert_btc_to_usdt",
          "error",
          `BTC conversion failed for customer ${customerId}: ${orderError.message}`,
          {
            customer_id: customerId,
            approval_id: approval.approval_id,
            btc_to_sell: btcToSell,
            error: orderError.message,
          },
          orgId,
          customerId
        );

        return new Response(
          JSON.stringify({ error: `Conversion failed: ${orderError.message}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Invalid action (use 'create_request' or 'execute_conversion')" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in ef_auto_convert_btc_to_usdt:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
