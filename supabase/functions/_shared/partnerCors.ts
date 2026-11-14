// _shared/partnerCors.ts — CORS for the partner-portal edge functions.
//
// Only the public website origin hosts the partner portal, so these functions do not need the
// wildcard the Admin-UI-facing functions use. Allowed origins are echoed back; anything else gets
// no Access-Control-Allow-Origin header and the browser blocks the response. Bearer auth remains
// the real control — this is defence in depth against a hostile page driving a partner's browser.

const ALLOWED_ORIGINS = new Set<string>([
  "https://bitwealth.co.za",
  "https://www.bitwealth.co.za",
  ...(Deno.env.get("PARTNER_PORTAL_EXTRA_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

export function partnerCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
