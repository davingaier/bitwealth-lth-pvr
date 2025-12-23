// valrClient.ts – shared VALR helper with subaccount support
const API_BASE = Deno.env.get("VALR_API_BASE") ?? "https://api.valr.com";
async function hmacSha512Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {
    name: "HMAC",
    hash: "SHA-512"
  }, false, [
    "sign"
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  return Array.from(bytes).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
async function valrPrivateRequest(method, path, body, subaccountId) {
  const apiKey = Deno.env.get("VALR_API_KEY");
  const apiSecret = Deno.env.get("VALR_API_SECRET");
  if (!apiKey || !apiSecret) {
    throw new Error("VALR_API_KEY or VALR_API_SECRET is not set in environment");
  }
  const timestamp = Date.now().toString();
  const jsonBody = body ? JSON.stringify(body) : "";

  // VALR signing rule when using subaccounts:
  // timestamp + HTTP_VERB(UPPERCASE) + path + bodyJson + subaccountId (if present)
  const verb = method.toUpperCase();
  const payloadToSign =
    timestamp + verb + path + jsonBody + (subaccountId ?? "");

  const signature = await hmacSha512Hex(apiSecret, payloadToSign);

  const headers = {
    "X-VALR-API-KEY": apiKey,
    "X-VALR-SIGNATURE": signature,
    "X-VALR-TIMESTAMP": timestamp
  };
  if (jsonBody) {
    headers["Content-Type"] = "application/json";
  }
  // Subaccount impersonation – this is where the id from /v1/account/subaccounts goes
  if (subaccountId) {
    headers["X-VALR-SUB-ACCOUNT-ID"] = subaccountId;
  }
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: jsonBody || undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VALR ${method} ${path} failed: ${res.status} ${res.statusText} – ${text}`);
  }
  if (res.status === 204) {
    return null;
  }
  return await res.json();
}
// ---------- Public helpers used by your EFs ----------
export async function placeLimitOrder(payload, subaccountId) {
  return await valrPrivateRequest("POST", "/v1/orders/limit", payload, subaccountId);
}
export async function getOrderSummaryById(orderId, pair, subaccountId) {
  const path = `/v1/orders/history/summary/orderid/${orderId}?currencyPair=${pair}`;
  return await valrPrivateRequest("GET", path, undefined, subaccountId);
}
export async function cancelOrder(orderId, pair, subaccountId) {
  const path = `/v1/orders/${orderId}?currencyPair=${pair}`;
  return await valrPrivateRequest("DELETE", path, undefined, subaccountId);
}
