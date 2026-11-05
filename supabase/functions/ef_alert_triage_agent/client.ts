import { getServiceKey } from "../_shared/supabaseKeys.ts";
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getServiceClient(): any {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!;
  const key = getServiceKey()!;
  return createClient(url, key, { db: { schema: "public" } });
}
