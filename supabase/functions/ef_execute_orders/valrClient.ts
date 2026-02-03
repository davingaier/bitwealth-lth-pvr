// valrClient.ts – shared VALR helper with subaccount support for VALR
// Used by both ef_execute_orders and ef_poll_orders.
//
// It is tolerant of currency pair formats:
//   - "BTCUSDT"  (VALR native)
//   - "BTC/USDT" (internal / DB format)
// In all cases we normalise to VALR's "BTCUSDT" when talking to the API.

const VALR_API_URL =
  Deno.env.get("VALR_API_URL") ??
  Deno.env.get("VALR_API_BASE") ??
  "https://api.valr.com";

const encoder = new TextEncoder();

// ---------------- HMAC signing ----------------
async function signRequest(apiSecret: string, payload: string) {
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

// Normalise a pair like "BTC/USDT" or "btc_usdt" to VALR's "BTCUSDT"
function normalisePair(pair: string): string {
  return pair.replace("/", "").replace("_", "").toUpperCase();
}

// ---------------- Core request helper ----------------
async function valrPrivateRequest(
  method: string,
  path: string,
  body: unknown,
  subaccountId?: string,
) {
  const apiKey = Deno.env.get("VALR_API_KEY");
  const apiSecret = Deno.env.get("VALR_API_SECRET");
  if (!apiKey || !apiSecret) {
    throw new Error("VALR_API_KEY / VALR_API_SECRET missing in environment");
  }

  const timestamp = Date.now().toString();
  const bodyString = body ? JSON.stringify(body) : "";
  const verb = method.toUpperCase();

  // VALR signing spec: timestamp + verb + path + body + subaccountId
  const payloadToSign = timestamp + verb + path + bodyString + (subaccountId ?? "");
  const signature = await signRequest(apiSecret, payloadToSign);

  const headers: Record<string, string> = {
    "X-VALR-API-KEY": apiKey,
    "X-VALR-SIGNATURE": signature,
    "X-VALR-TIMESTAMP": timestamp,
  };

  if (bodyString) {
    headers["Content-Type"] = "application/json";
  }
  if (subaccountId) {
    // This is where the id returned from /v1/account/subaccounts goes
    headers["X-VALR-SUB-ACCOUNT-ID"] = subaccountId;
  }

  const res = await fetch(VALR_API_URL + path, {
    method: verb,
    headers,
    body: bodyString || undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `VALR ${verb} ${path} failed: ${res.status} ${res.statusText} – ${text}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

// ---------------- Public helpers ----------------

// 0) Get order book (market data - no auth required)
export async function getOrderBook(pair: string): Promise<{
  Asks: Array<{ price: string; quantity: string }>;
  Bids: Array<{ price: string; quantity: string }>;
}> {
  const normalised = normalisePair(pair);
  const res = await fetch(`${VALR_API_URL}/v1/marketdata/${normalised}/orderbook`);
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `VALR GET /v1/marketdata/${normalised}/orderbook failed: ${res.status} ${res.statusText} – ${text}`,
    );
  }
  
  return await res.json();
}

// 1) Place LIMIT order (used by ef_execute_orders)
export async function placeLimitOrder(
  payload: {
    side: string;
    pair: string;
    price: string;
    quantity: string;
    customerOrderId?: string;
    timeInForce?: string;
    postOnly?: boolean;
  },
  subaccountId?: string,
) {
  const pair = normalisePair(payload.pair);
  const body = { ...payload, pair };
  return await valrPrivateRequest("POST", "/v1/orders/limit", body, subaccountId);
}

// 2) Poll order by VALR customerOrderId (we use intent_id as customerOrderId)
export async function getOrderSummaryByCustomerOrderId(
  customerOrderId: string,
  pair: string,
  subaccountId?: string,
) {
  const p = normalisePair(pair);
  const path =
    `/v1/orders/history/summary/customerorderid/${customerOrderId}?currencyPair=${p}`;
  return await valrPrivateRequest("GET", path, undefined, subaccountId);
}

// Optional: keep a direct poll by orderId in case other EFs use it
export async function getOrderSummaryById(
  orderId: string,
  pair: string,
  subaccountId?: string,
) {
  const p = normalisePair(pair);
  const path =
    `/v1/orders/history/summary/orderid/${orderId}?currencyPair=${p}`;
  return await valrPrivateRequest("GET", path, undefined, subaccountId);
}

// 3) Cancel order by VALR orderId
export async function cancelOrderById(
  orderId: string,
  pair: string,
  subaccountId?: string,
) {
  const p = normalisePair(pair);
  const path = `/v1/orders/orderid/${orderId}?currencyPair=${p}`;
  return await valrPrivateRequest("DELETE", path, undefined, subaccountId);
}

// 4) Place MARKET order for fallback logic in ef_poll_orders
// For BUY we treat amount as quote (USDT); for SELL we treat it as base (BTC).
export async function placeMarketOrder(
  pair: string,
  side: string,
  amount: string,
  customerOrderId: string,
  subaccountId?: string,
) {
  const p = normalisePair(pair);
  const sideLower = side.toLowerCase();
  const body: Record<string, unknown> = {
    pair: p,
    side: sideLower,
    customerOrderId,
    // For MARKET orders, always use baseAmount (BTC quantity)
    // VALR will use market price to determine quote amount
    baseAmount: amount,
  };

  return await valrPrivateRequest("POST", "/v1/orders/market", body, subaccountId);
}

// 5) Public market price for pair – used for fallback price checks
export async function getMarketPrice(pair: string) {
  const p = normalisePair(pair);
  const res = await fetch(`${VALR_API_URL}/v1/public/${p}/marketsummary`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `VALR GET /v1/public/${p}/marketsummary failed: ${res.status} ${res.statusText} – ${text}`,
    );
  }
  const data = await res.json();
  const priceStr =
    data.lastTradedPrice ?? data.markPrice ?? data.askPrice ?? data.bidPrice;
  const price = Number(priceStr);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(
      `VALR market summary for ${p} did not contain a usable price`,
    );
  }
  return price;
}
