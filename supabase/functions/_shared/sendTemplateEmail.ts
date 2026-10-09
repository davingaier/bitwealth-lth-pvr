// _shared/sendTemplateEmail.ts — call ef_send_email from another edge function.
//
// Always authenticates with the service role key: ef_send_email rejects the anon key
// and non-admin user tokens, so forwarding the caller's Authorization header breaks for
// cron (no key) and customer-initiated calls. Retries transient gateway errors (5xx /
// network) — a lone 502 at the busy 00:00 UTC cron burst otherwise loses the email.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

export interface TemplateEmailResult {
  ok: boolean;
  status: number;
  error?: string;
  attempts: number;
}

export async function sendTemplateEmail(
  payload: { template_key: string; to_email: string; data?: Record<string, unknown>; from_email?: string },
  maxAttempts = 3,
): Promise<TemplateEmailResult> {
  let lastStatus = 0;
  let lastError = "";
  let tried = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    tried = attempt;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ef_send_email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      lastStatus = res.status;
      lastError = (await res.text()).slice(0, 300);
      if (res.status < 500) break; // 4xx will not succeed on retry
    } catch (e) {
      lastError = (e as Error).message;
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  return { ok: false, status: lastStatus, error: lastError, attempts: tried };
}
