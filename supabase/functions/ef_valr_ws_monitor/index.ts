// ef_valr_ws_monitor/index.ts
// Real-time WebSocket monitor for VALR order updates
// This Edge Function establishes a WebSocket connection to VALR for real-time order updates
// reducing the need for frequent polling. It processes order events and updates the database.
//
// NOTE: Edge Functions have runtime limits. For long-running WebSocket connections,
// consider using a dedicated service or server. This implementation is designed for
// targeted monitoring of active orders with automatic reconnection.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Inline alerting module (to avoid deployment bundling issues)
interface SupabaseClient {
  from(table: string): any;
}

type AlertSeverity = "info" | "warn" | "error" | "critical";

interface AlertContext {
  [key: string]: unknown;
  subaccount_id?: string;
  order_count?: number;
  error?: string;
  fallback?: string;
  close_code?: number;
  close_reason?: string;
  order_id?: string;
}

async function logAlert(
  sb: SupabaseClient,
  component: string,
  severity: AlertSeverity,
  message: string,
  context: AlertContext = {},
  orgId?: string | null,
  customerId?: number | null,
  portfolioId?: string | null,
): Promise<void> {
  try {
    const payload: any = {
      component,
      severity,
      message,
      context,
    };
    if (orgId) payload.org_id = orgId;
    if (customerId) payload.customer_id = customerId;
    if (portfolioId) payload.portfolio_id = portfolioId;

    await sb.from("alert_events").insert(payload);
  } catch (e) {
    console.error(`${component}: alert_events insert failed`, e);
  }
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SECRET_KEY");
const org_id = Deno.env.get("ORG_ID");

const VALR_WS_URL = Deno.env.get("VALR_WS_URL") ?? "wss://api.valr.com/ws/trade";
const VALR_API_KEY = Deno.env.get("VALR_API_KEY");
const VALR_API_SECRET = Deno.env.get("VALR_API_SECRET");

interface OrderUpdateMessage {
  type: "ORDER_PROCESSED" | "ORDER_STATUS_UPDATE" | "ORDER_FILLED";
  data: {
    orderId: string;
    customerOrderId?: string;
    currencyPair: string;
    side: "buy" | "sell";
    status: "Placed" | "Filled" | "Partially Filled" | "Cancelled" | "Failed";
    originalPrice?: string;
    remainingQuantity?: string;
    fills?: Array<{
      price: string;
      quantity: string;
      currencyPair: string;
      tradedAt: string;
      takerSide: string;
      feeAmount?: string;
      feeCurrency?: string;
    }>;
  };
}

const encoder = new TextEncoder();

// HMAC signing for WebSocket authentication
async function signRequest(apiSecret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(apiSecret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { order_ids, subaccount_id } = await req.json();

  if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
    return new Response(
      JSON.stringify({ error: "order_ids array required" }),
      { status: 400 },
    );
  }

  const supabase = createClient(supabaseUrl!, supabaseKey!, {
    db: { schema: "lth_pvr" },
  });

  console.log(
    `ef_valr_ws_monitor: Monitoring ${order_ids.length} orders via WebSocket`,
  );

  try {
    // WebSocket authentication headers (sent during handshake)
    const timestamp = Date.now().toString();
    const path = "/ws/trade";
    const payloadToSign = timestamp + "GET" + path + (subaccount_id ?? "");
    const signature = await signRequest(VALR_API_SECRET!, payloadToSign);

    const wsUrl = new URL(VALR_WS_URL);
    wsUrl.searchParams.set("X-VALR-API-KEY", VALR_API_KEY!);
    wsUrl.searchParams.set("X-VALR-SIGNATURE", signature);
    wsUrl.searchParams.set("X-VALR-TIMESTAMP", timestamp);
    if (subaccount_id) {
      wsUrl.searchParams.set("X-VALR-SUB-ACCOUNT-ID", subaccount_id);
    }

    // Establish WebSocket connection
    const ws = new WebSocket(wsUrl.toString());
    const monitoredOrders = new Set(order_ids);
    let updateCount = 0;

    // No timeout - WebSocket stays open until all orders complete
    // Polling (ef_poll_orders) provides MARKET fallback logic
    console.log("ef_valr_ws_monitor: WebSocket established, monitoring until all orders complete");

    ws.onopen = () => {
      console.log("ef_valr_ws_monitor: WebSocket connected");
      
      // Subscribe to account order updates
      ws.send(
        JSON.stringify({
          type: "SUBSCRIBE",
          subscriptions: [
            { event: "ACCOUNT_ORDER_UPDATE" }
          ],
        }),
      );
    };

    ws.onmessage = async (event) => {
      try {
        const msg: OrderUpdateMessage = JSON.parse(event.data);

        // Filter for our monitored orders
        const customerOrderId = msg.data?.customerOrderId;
        const valrOrderId = msg.data?.orderId;

        if (!monitoredOrders.has(customerOrderId ?? "") && 
            !monitoredOrders.has(valrOrderId ?? "")) {
          return; // Not one of our orders
        }

        console.log(
          `ef_valr_ws_monitor: Received update for order ${customerOrderId ?? valrOrderId}`,
          msg.data.status,
        );

        // Update exchange_orders table
        const { error: updateErr } = await supabase
          .from("exchange_orders")
          .update({
            status: mapValrStatus(msg.data.status),
            raw: msg.data,
            updated_at: new Date().toISOString(),
          })
          .or(`ext_order_id.eq.${valrOrderId},intent_id.eq.${customerOrderId}`);

        if (updateErr) {
          console.error(
            "ef_valr_ws_monitor: Failed to update order",
            updateErr,
          );
          await logAlert(
            supabase,
            "ef_valr_ws_monitor",
            "error",
            `Failed to update order ${customerOrderId ?? valrOrderId}`,
            { error: updateErr.message, order_id: valrOrderId },
            org_id,
          );
          return;
        }

        // Process fills if present
        if (msg.data.fills && msg.data.fills.length > 0) {
          // Get exchange_order_id from database to link fills
          const { data: orderData } = await supabase
            .from("exchange_orders")
            .select("exchange_order_id")
            .or(`ext_order_id.eq.${valrOrderId},intent_id.eq.${customerOrderId}`)
            .single();

          if (orderData) {
            for (const fill of msg.data.fills) {
              const { error: fillErr } = await supabase
                .from("order_fills")
                .insert({
                  org_id,
                  exchange_order_id: orderData.exchange_order_id,
                  trade_ts: new Date(fill.tradedAt).toISOString(),
                  price: fill.price,
                  qty: fill.quantity,
                  fee_asset: fill.feeCurrency ?? "BTC",
                  fee_qty: fill.feeAmount ?? "0",
                  raw: fill,
                });

              if (fillErr) {
                console.error("ef_valr_ws_monitor: Failed to insert fill", fillErr);
                await logAlert(
                  supabase,
                  "ef_valr_ws_monitor",
                  "warn",
                  `Failed to insert fill for order ${customerOrderId ?? valrOrderId}`,
                  { error: fillErr.message, order_id: valrOrderId },
                  org_id,
                );
              } else {
                console.log(`ef_valr_ws_monitor: Inserted fill for order ${customerOrderId ?? valrOrderId}`);
              }
            }
          }
        }

        updateCount++;

        // If order is filled or cancelled, remove from monitoring
        if (["Filled", "Cancelled", "Failed"].includes(msg.data.status)) {
          monitoredOrders.delete(customerOrderId ?? "");
          monitoredOrders.delete(valrOrderId ?? "");
          
          console.log(
            `ef_valr_ws_monitor: Order ${customerOrderId ?? valrOrderId} complete (${msg.data.status}), ${monitoredOrders.size} remaining`,
          );

          // If no more orders to monitor, close connection
          if (monitoredOrders.size === 0) {
            console.log("ef_valr_ws_monitor: All orders complete, closing WebSocket");
            ws.close();
          }
        }
      } catch (err) {
        console.error("ef_valr_ws_monitor: Error processing message", err);
      }
    };

    ws.onerror = async (error) => {
      console.error("ef_valr_ws_monitor: WebSocket error", error);
      
      // Log alert for WebSocket connection error
      await logAlert(
        supabase,
        "ef_valr_ws_monitor",
        "error",
        "WebSocket connection error occurred",
        {
          subaccount_id,
          order_count: order_ids.length,
          error: String(error),
          fallback: "polling will handle order monitoring"
        },
        org_id,
      );
    };

    ws.onclose = async (event) => {
      console.log(`ef_valr_ws_monitor: WebSocket closed (code: ${event.code}), processed ${updateCount} updates`);
      
      // Log alert if closed prematurely without processing any updates
      if (updateCount === 0 && monitoredOrders.size > 0) {
        await logAlert(
          supabase,
          "ef_valr_ws_monitor",
          "warn",
          "WebSocket closed without processing any order updates",
          {
            subaccount_id,
            order_count: order_ids.length,
            close_code: event.code,
            close_reason: event.reason || "No reason provided",
            fallback: "polling will handle order monitoring"
          },
          org_id,
        );
      }
    };

    // Wait for WebSocket to close or timeout
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (ws.readyState === WebSocket.CLOSED) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });

    return new Response(
      JSON.stringify({
        processed: updateCount,
        monitored_orders: order_ids.length,
        remaining: monitoredOrders.size,
      }),
      { status: 200 },
    );
  } catch (err) {
    console.error("ef_valr_ws_monitor: Error", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    await logAlert(
      supabase,
      "ef_valr_ws_monitor",
      "error",
      `WebSocket monitor failed: ${errorMessage}`,
      { error: errorMessage },
      org_id,
    );
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500 },
    );
  }
});

// Map VALR status to our internal status
function mapValrStatus(valrStatus: string): string {
  switch (valrStatus) {
    case "Placed":
      return "submitted";
    case "Filled":
      return "filled";
    case "Partially Filled":
      return "submitted"; // Keep as submitted until fully filled
    case "Cancelled":
      return "cancelled";
    case "Failed":
      return "failed";
    default:
      return "submitted";
  }
}
