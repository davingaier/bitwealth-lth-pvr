import { createClient } from "jsr:@supabase/supabase-js@2";

export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createClient(url, key);
}
