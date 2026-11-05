import { getServiceKey } from "../_shared/supabaseKeys.ts";
// client.ts — identical pattern to ef_fetch_rb_bands/client.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
  const key = getServiceKey();
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "lth_pvr" },
    global: { headers: { "x-client-info": "ef:onchain-pvr" } },
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
