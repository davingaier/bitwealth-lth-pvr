// _shared/valrClient.ts — Shared VALR API client for all edge functions.
//
// Supports both credential models:
//   - Subaccount model: master key from env + X-VALR-SUB-ACCOUNT-ID header
//   - API model: customer's own vault-decrypted key, no subaccount header
//
// Pass credentials from resolveCustomerCredentials() to use API-model keys.
// Omit / pass null to fall back to VALR_API_KEY / VALR_API_SECRET env vars.

export interface ValrRequestCredentials {
  apiKey: string;
  apiSecret: string;
}

const VALR_API_URL =
  Deno.env.get("VALR_API_URL") ??
  Deno.env.get("VALR_API_BASE") ??
  "https://api.valr.com";

const encoder = new TextEncoder();

// ── HMAC-SHA-512 signing ──────────────────────────────────────────────────────
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

// Normalise "BTC/USDT" → "BTCUSDT", "USDTZAR" → "USDTZAR"
export function normalisePair(pair: string): string {
  return pair.replace("/", "").replace("_", "").toUpperCase();
}

// ── Core private-API request ──────────────────────────────────────────────────
async function valrPrivateRequest(
  method: string,
  path: string,
  body: unknown,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const apiKey = credentials?.apiKey ?? Deno.env.get("VALR_API_KEY");
  const apiSecret = credentials?.apiSecret ?? Deno.env.get("VALR_API_SECRET");
  if (!apiKey || !apiSecret) {
    throw new Error("VALR_API_KEY / VALR_API_SECRET missing — not in credentials or environment");
  }

  const timestamp = Date.now().toString();
  const bodyString = body ? JSON.stringify(body) : "";
  const verb = method.toUpperCase();

  const payloadToSign = timestamp + verb + path + bodyString + (subaccountId ?? "");
  const signature = await signRequest(apiSecret, payloadToSign);

  const headers: Record<string, string> = {
    "X-VALR-API-KEY": apiKey,
    "X-VALR-SIGNATURE": signature,
    "X-VALR-TIMESTAMP": timestamp,
  };
  if (bodyString) headers["Content-Type"] = "application/json";
  if (subaccountId) headers["X-VALR-SUB-ACCOUNT-ID"] = subaccountId;

  const res = await fetch(VALR_API_URL + path, {
    method: verb,
    headers,
    body: bodyString || undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`VALR ${verb} ${path} failed: ${res.status} ${res.statusText} – ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ── Order Book (public, no auth) ──────────────────────────────────────────────
export async function getOrderBook(pair: string): Promise<{
  Asks: Array<{ price: string; quantity: string }>;
  Bids: Array<{ price: string; quantity: string }>;
}> {
  const p = normalisePair(pair);
  const res = await fetch(`${VALR_API_URL}/v1/marketdata/${p}/orderbook`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VALR GET orderbook ${p} failed: ${res.status} – ${text}`);
  }
  return await res.json();
}

// ── Market Summary (public, no auth) ─────────────────────────────────────────
export async function getMarketPrice(pair: string): Promise<number> {
  const p = normalisePair(pair);
  const res = await fetch(`${VALR_API_URL}/v1/public/${p}/marketsummary`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VALR GET marketsummary ${p} failed: ${res.status} – ${text}`);
  }
  const data = await res.json();
  const priceStr = data.lastTradedPrice ?? data.markPrice ?? data.askPrice ?? data.bidPrice;
  const price = Number(priceStr);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`VALR market summary for ${p} did not contain a usable price`);
  }
  return price;
}

// ── LIMIT order ───────────────────────────────────────────────────────────────
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
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const pair = normalisePair(payload.pair);
  return await valrPrivateRequest("POST", "/v1/orders/limit", { ...payload, pair }, subaccountId, credentials);
}

// ── MARKET order ──────────────────────────────────────────────────────────────
export async function placeMarketOrder(
  pair: string,
  side: string,
  amount: string,
  customerOrderId: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const p = normalisePair(pair);
  const body: Record<string, unknown> = { pair: p, side: side.toLowerCase(), customerOrderId, baseAmount: amount };
  return await valrPrivateRequest("POST", "/v1/orders/market", body, subaccountId, credentials);
}

// ── MARKET order — quote amount (spend ZAR/USDT) ─────────────────────────────
// Use this for BUY orders where we know the ZAR/USDT spend amount, not base BTC/USDT quantity.
export async function placeMarketOrderByQuote(
  pair: string,
  side: string,
  quoteAmount: string,
  customerOrderId: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const p = normalisePair(pair);
  const body: Record<string, unknown> = { pair: p, side: side.toLowerCase(), customerOrderId, quoteAmount };
  return await valrPrivateRequest("POST", "/v1/orders/market", body, subaccountId, credentials);
}

// ── Cancel order ──────────────────────────────────────────────────────────────
export async function cancelOrderById(
  orderId: string,
  pair: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const p = normalisePair(pair);
  return await valrPrivateRequest("DELETE", `/v1/orders/orderid/${orderId}?currencyPair=${p}`, undefined, subaccountId, credentials);
}

// ── Order summary by customerOrderId ─────────────────────────────────────────
export async function getOrderSummaryByCustomerOrderId(
  customerOrderId: string,
  pair: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const p = normalisePair(pair);
  return await valrPrivateRequest(
    "GET",
    `/v1/orders/history/summary/customerorderid/${customerOrderId}?currencyPair=${p}`,
    undefined,
    subaccountId,
    credentials,
  );
}

// ── Order summary by VALR orderId ────────────────────────────────────────────
export async function getOrderSummaryById(
  orderId: string,
  pair: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const p = normalisePair(pair);
  return await valrPrivateRequest(
    "GET",
    `/v1/orders/history/summary/orderid/${orderId}?currencyPair=${p}`,
    undefined,
    subaccountId,
    credentials,
  );
}

// ── Crypto withdrawal ─────────────────────────────────────────────────────────
export async function cryptoWithdraw(
  currency: string,
  amount: string,
  address: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const path = `/v1/wallet/crypto/${currency.toUpperCase()}/withdraw`;
  return await valrPrivateRequest("POST", path, { amount, address }, subaccountId, credentials);
}

// ── ZAR fiat withdrawal ───────────────────────────────────────────────────────
export async function zarWithdraw(
  bankAccountId: string,
  amount: string,
  fast: boolean,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const path = `/v1/wallet/fiat/ZAR/withdraw`;
  return await valrPrivateRequest(
    "POST",
    path,
    { linkedBankAccountId: bankAccountId, amount, fast },
    subaccountId,
    credentials,
  );
}
