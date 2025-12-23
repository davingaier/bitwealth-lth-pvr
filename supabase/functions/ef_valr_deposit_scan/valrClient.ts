// valrClient.ts
const API_BASE = Deno.env.get("VALR_API_BASE") ?? "https://api.valr.com";
// WebCrypto HMAC-SHA512 helper
async function hmacSha512Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {
    name: "HMAC",
    hash: "SHA-512"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
export async function valrPrivateRequest(method, path, body) {
  const apiKey = Deno.env.get("VALR_API_KEY");
  const apiSecret = Deno.env.get("VALR_API_SECRET");
  if (!apiKey || !apiSecret) {
    throw new Error("VALR_API_KEY or VALR_API_SECRET missing");
  }
  const timestamp = Date.now().toString();
  const json = body ? JSON.stringify(body) : "";
  const payloadToSign = timestamp + method.toUpperCase() + path + json;
  const signature = await hmacSha512Hex(apiSecret, payloadToSign);
  const resp = await fetch(API_BASE + path, {
    method,
    headers: {
      "X-VALR-API-KEY": apiKey,
      "X-VALR-SIGNATURE": signature,
      "X-VALR-TIMESTAMP": timestamp,
      "Content-Type": "application/json"
    },
    body: json || undefined
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`VALR ${method} ${path} failed: ${resp.status} ${resp.statusText} – ${text}`);
  }
  if (resp.status === 204) {
    // No content
    return undefined;
  }
  return await resp.json();
}
export async function placeLimitOrder(payload) {
  return await valrPrivateRequest("POST", "/v1/orders/limit", payload);
}
export async function getOrderSummaryById(orderId, currencyPair) {
  const path = `/v1/orders/history/summary/orderid/${orderId}?currencyPair=${currencyPair}`;
  return await valrPrivateRequest("GET", path);
}
export async function cancelOrder(orderId, currencyPair) {
  const path = `/v1/orders/${orderId}?currencyPair=${currencyPair}`;
  await valrPrivateRequest("DELETE", path);
}
export async function getCryptoDepositHistory() {
  // Optionally add ?skip=...&limit=... if needed
  return await valrPrivateRequest("GET", "/v1/wallet/crypto/deposit/history");
}
export async function getCryptoWithdrawHistory() {
  return await valrPrivateRequest("GET", "/v1/wallet/crypto/withdraw/history");
}
