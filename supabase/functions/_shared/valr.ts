/**
 * Shared VALR API utilities
 * Provides HMAC signature generation for VALR API authentication
 */

/**
 * Generate HMAC SHA-512 signature for VALR API requests
 * 
 * @param timestamp - Unix timestamp (milliseconds as string)
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - API endpoint path (e.g., "/v1/account/balances")
 * @param body - Request body (empty string if no body)
 * @param apiSecret - VALR API secret key
 * @param subaccountId - Optional subaccount ID for subaccount requests
 * @returns Hex-encoded HMAC signature
 */
export async function signVALR(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  apiSecret: string,
  subaccountId: string = ""
): Promise<string> {
  const message = timestamp + method.toUpperCase() + path + body + subaccountId;
  
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
