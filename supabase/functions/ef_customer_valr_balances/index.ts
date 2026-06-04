// ef_customer_valr_balances/index.ts
//
// Admin-only helper: returns a customer's LIVE VALR account balances for
// ZAR, BTC, USDT and USDPC (total / available / reserved), straight from the
// exchange. Powers the "Customer Balances" card in the Admin UI's Customer
// Transactions module.
//
// Works for both credential models via resolveCustomerCredentials():
//   - subaccount model: master key + X-VALR-SUB-ACCOUNT-ID
//   - API model:        customer's own vault-decrypted key
//
// Read-only: it places no orders and writes nothing. Invoked from the
// authenticated admin browser session, so JWT verification stays ON (default).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveCustomerCredentials } from "../_shared/valrCredentials.ts";
import { getAccountBalances } from "../_shared/valrClient.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

// Currencies surfaced in the Admin UI card, in display order.
const WANTED = ["ZAR", "BTC", "USDT", "USDPC"] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "Server not configured" }, 500);

  let customerId: number | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (body && Number.isFinite(Number(body.customer_id))) {
      customerId = Number(body.customer_id);
    }
  } catch (_e) { /* ignore */ }

  if (customerId == null) return json({ ok: false, error: "customer_id is required" }, 400);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  try {
    const creds = await resolveCustomerCredentials(sb, customerId);
    const raw = await getAccountBalances(creds.subaccountId, {
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
    });

    // Index by upper-cased currency code.
    const by: Record<string, { available: number; reserved: number; total: number }> = {};
    for (const b of raw) {
      const sym = String(b.currency ?? "").toUpperCase();
      if (!sym) continue;
      const available = Number(b.available ?? 0);
      const reserved = Number((b as any).reserved ?? 0);
      const total = Number(b.total ?? available + reserved);
      by[sym] = {
        available: Number.isFinite(available) ? available : 0,
        reserved: Number.isFinite(reserved) ? reserved : 0,
        total: Number.isFinite(total) ? total : 0,
      };
    }

    const balances = WANTED.map((sym) => ({
      currency: sym,
      available: by[sym]?.available ?? 0,
      reserved: by[sym]?.reserved ?? 0,
      total: by[sym]?.total ?? 0,
    }));

    return json({
      ok: true,
      customer_id: customerId,
      account_model: creds.accountModel,
      subaccount_id: creds.subaccountId,
      fetched_at: new Date().toISOString(),
      balances,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ef_customer_valr_balances error:", msg);
    return json({ ok: false, error: msg }, 502);
  }
});
