const enc = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Round a quantity/price DOWN to the instrument step (avoids "qty invalid" rejections). */
export function floorToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.floor(value / step + 1e-9) * step).toFixed(decimals));
}

export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}
