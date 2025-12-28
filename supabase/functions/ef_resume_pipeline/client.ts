// ef_resume_pipeline/client.ts
// Supabase client for resume_pipeline edge function

import { createClient } from "jsr:@supabase/supabase-js@2";

export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  // Try multiple environment variables for service role key
  const key = Deno.env.get("SECRET_KEY") || 
              Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
              Deno.env.get("SERVICE_ROLE_KEY");

  if (!url) throw new Error("SUPABASE_URL not set");
  if (!key) throw new Error("Service role key not found in environment (tried SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, SERVICE_ROLE_KEY)");

  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { "x-client-info": "ef_resume_pipeline" } },
  });
}
