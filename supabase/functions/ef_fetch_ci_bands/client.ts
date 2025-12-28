// client.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL"); // optional legacy
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    db: {
      schema: "lth_pvr"
    },
    global: {
      headers: {
        "x-client-info": "ef:lth-pvr"
      }
    }
  });
}
// small utils you’re already using are fine to keep here too
export const todayUTC = ()=>new Date(Date.now());
export const yyyymmdd = (d)=>d.toISOString().slice(0, 10);
export const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
