import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const org_id = Deno.env.get("ORG_ID");
  
  const sb = createClient(url!, key!, {
    db: { schema: "lth_pvr" }
  });
  
  const todayStr = "2026-02-01";
  
  const result = await sb
    .schema("lth_pvr")
    .from("decisions_daily")
    .select("*")
    .eq("org_id", org_id)
    .eq("trade_date", todayStr)
    .in("action", ["BUY", "SELL"]);
  
  return new Response(JSON.stringify({
    count: result.data?.length ?? 0,
    error: result.error,
    data: result.data
  }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});
