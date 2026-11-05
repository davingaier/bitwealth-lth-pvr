import { signValrRequest } from "./valrSign.ts";
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
  customerId?: number;
}

const VALR_API_URL =
  Deno.env.get("VALR_API_URL") ??
  Deno.env.get("VALR_API_BASE") ??
  "https://api.valr.com";


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
  const bodyString = body ? JSON.stringify(body) : "";
  const verb = method.toUpperCase();

  // 2026-11-05: secrets stay in Vault — lth_pvr.valr_sign() signs server-side; local HMAC only as rollout fallback.
  const { headers } = await signValrRequest({
    customerId: credentials?.customerId ?? null,
    subaccountId: subaccountId ?? null,
    verb,
    path,
    body: bodyString,
    localApiKey: credentials?.apiKey ?? null,
    localApiSecret: credentials?.apiSecret ?? null,
  });

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
  const res = await fetch(`${VALR_API_URL}/v1/public/${p}/orderbook`);
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

// ── Account balances (private) ────────────────────────────────────────────────
// Returns the full balances payload from /v1/account/balances. Each entry has
// at least { currency, available, reserved, total }.
export async function getAccountBalances(
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<Array<{ currency: string; available: string; reserved?: string; total?: string }>> {
  const data = await valrPrivateRequest("GET", "/v1/account/balances", undefined, subaccountId, credentials);
  return Array.isArray(data) ? data as any[] : [];
}

// Convenience: extract `available` for a given currency (case-insensitive).
export function pickAvailable(
  balances: Array<{ currency: string; available: string }>,
  currency: string,
): number {
  const c = currency.toUpperCase();
  const row = balances.find(b => (b.currency ?? "").toUpperCase() === c);
  const n = Number(row?.available ?? 0);
  return Number.isFinite(n) ? n : 0;
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
// VALR cancel endpoint is DELETE /v1/orders/order with a JSON body identifying
// the order ({ orderId | customerOrderId, pair }). The path-style
// /v1/orders/orderid/{id} is the GET status route, NOT a cancel route — using it
// for DELETE returns 404 and silently leaves the order resting on the book.
export async function cancelOrderById(
  orderId: string,
  pair: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const p = normalisePair(pair);
  return await valrPrivateRequest("DELETE", "/v1/orders/order", { orderId, pair: p }, subaccountId, credentials);
}

// Cancel by the customerOrderId we supplied at placement time.
export async function cancelOrderByCustomerOrderId(
  customerOrderId: string,
  pair: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const p = normalisePair(pair);
  return await valrPrivateRequest("DELETE", "/v1/orders/order", { customerOrderId, pair: p }, subaccountId, credentials);
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

// ── Order status by customerOrderId (works for OPEN orders too) ─────────────
// The history/summary endpoints above only serve completed orders and return
// 400 "Invalid Order" while an order is still working. This status route
// (GET /v1/orders/:currencyPair/customerorderid/:customerOrderId) returns
// orderStatusType (Placed / Active / Partially Filled / Filled / Cancelled /
// Failed), originalQuantity and remainingQuantity for any order.
export async function getOrderStatusByCustomerOrderId(
  customerOrderId: string,
  pair: string,
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  const p = normalisePair(pair);
  return await valrPrivateRequest(
    "GET",
    `/v1/orders/${p}/customerorderid/${customerOrderId}`,
    undefined,
    subaccountId,
    credentials,
  );
}

// ── Open (working) orders ────────────────────────────────────────────────────
export async function getOpenOrders(
  subaccountId?: string | null,
  credentials?: ValrRequestCredentials | null,
): Promise<unknown> {
  return await valrPrivateRequest("GET", "/v1/orders/open", undefined, subaccountId, credentials);
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
