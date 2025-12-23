// ef_poll_orders/valrClient.ts
// Shared VALR helpers for polling + fallback
// Try VALR_API_URL first (older env), then VALR_API_BASE, then default.
const VALR_API_URL = Deno.env.get("VALR_API_URL") ?? Deno.env.get("VALR_API_BASE") ?? "https://api.valr.com";

const encoder = new TextEncoder();

async function signRequest(apiSecret: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(apiSecret), {
    name: "HMAC",
    hash: "SHA-512"
  }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function valrPrivateRequest(
  method: string,
  path: string,
  body: unknown,
  subaccountId?: string
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
    "X-VALR-TIMESTAMP": timestamp
  };

  if (bodyString) {
    headers["Content-Type"] = "application/json";
  }
  if (subaccountId) {
    headers["X-VALR-SUB-ACCOUNT-ID"] = subaccountId;
  }

  const res = await fetch(VALR_API_URL + path, {
    method: verb,
    headers,
    body: bodyString || undefined
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`VALR ${verb} ${path} failed: ${res.status} ${res.statusText} – ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---- Poll current order status by customerOrderId ----
export async function getOrderSummaryByCustomerOrderId(
  customerOrderId: string,
  pair: string,
  subaccountId?: string
) {
  const path = `/v1/orders/history/summary/customerorderid/${customerOrderId}?currencyPair=${pair}`;
  return await valrPrivateRequest("GET", path, undefined, subaccountId);
}

// ---- Cancel order by VALR orderId ----
export async function cancelOrderById(
  orderId: string,
  pair: string,
  subaccountId?: string
) {
  const path = `/v1/orders/orderid/${orderId}?currencyPair=${pair}`;
  return await valrPrivateRequest("DELETE", path, undefined, subaccountId);
}

// ---- Place fallback market order ----
export async function placeMarketOrder(
  pair: string,
  side: string,
  amount: string,
  customerOrderId: string,
  subaccountId?: string
) {
  const body = {
    pair,
    side: side.toLowerCase(),
    amount,
    customerOrderId
  };
  return await valrPrivateRequest("POST", "/v1/orders/market", body, subaccountId);
}

// ---- Public: get latest market price for a pair ----
export async function getMarketPrice(pair: string) {

  const res = await fetch(`${VALR_API_URL}/v1/public/${pair}/marketsummary`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VALR GET /v1/public/${pair}/marketsummary failed: ${res.status} ${res.statusText} – ${text}`);
  }
  const data = await res.json();
  const priceStr = data.lastTradedPrice ?? data.markPrice ?? data.askPrice ?? data.bidPrice;
  const price = Number(priceStr);
  if (!isFinite(price) || price <= 0) {
    throw new Error(`VALR market summary for ${pair} did not contain a usable price`);
  }
  return price;
}
