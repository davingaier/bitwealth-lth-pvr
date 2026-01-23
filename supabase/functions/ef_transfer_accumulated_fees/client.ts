// client.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

export function getServiceClient() {
  const url =
    Deno.env.get("SUPABASE_URL") ??
    Deno.env.get("SB_URL"); // optional legacy

  const key = Deno.env.get("Secret Key");

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or Secret Key env var");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db:   { schema: "lth_pvr" },
    global: { headers: { "x-client-info": "ef:transfer-accumulated-fees" } },
  });
}

// small utils
export const todayUTC = () => new Date(Date.now());
export const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10);
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
