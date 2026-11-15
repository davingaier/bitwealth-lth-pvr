// _shared/publicFormGuard.ts — abuse controls for the public, unauthenticated submission endpoints
// (prospect form, customer self-registration, contact form).
//
// 1. reCAPTCHA v2 verification against Google's siteverify endpoint (secret in RECAPTCHA_SECRET_KEY).
// 2. A small in-memory per-IP sliding-window rate limit. Edge isolates are short-lived, so this is a best-effort
//    brake on bursts from one source rather than a durable quota — the CAPTCHA is the primary control.
//
// Usage:
//   const guard = await guardPublicForm(req, body.captcha_token);
//   if (!guard.ok) return new Response(JSON.stringify({ error: guard.error }), { status: guard.status, headers: CORS });

const RECAPTCHA_SECRET_KEY = Deno.env.get("RECAPTCHA_SECRET_KEY");
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = Number(Deno.env.get("PUBLIC_FORM_MAX_PER_10MIN") ?? 8);
const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  return (xff.split(",")[0] || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown").trim();
}

export function rateLimited(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // bound memory in a long-lived isolate
  return recent.length > MAX_PER_WINDOW;
}

export async function verifyCaptcha(token: string | undefined | null): Promise<boolean> {
  if (!token || !RECAPTCHA_SECRET_KEY) return false;
  try {
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${encodeURIComponent(RECAPTCHA_SECRET_KEY)}&response=${encodeURIComponent(token)}`,
    });
    const data = await r.json();
    return data?.success === true;
  } catch (e) {
    console.error("reCAPTCHA verification error:", e);
    return false;
  }
}

export async function guardPublicForm(req: Request, captchaToken: string | undefined | null):
  Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (rateLimited(req)) return { ok: false, status: 429, error: "Too many submissions from your network. Please wait a few minutes and try again." };
  if (!captchaToken) return { ok: false, status: 400, error: "Please complete the CAPTCHA verification." };
  if (!(await verifyCaptcha(captchaToken))) return { ok: false, status: 400, error: "CAPTCHA verification failed. Please try again." };
  return { ok: true };
}
