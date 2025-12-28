// ef_resume_pipeline/index.ts
// Edge function to resume the LTH_PVR daily pipeline
// Provides REST API endpoint for UI and manual triggering

import { getServiceClient } from "./client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let sb;
  try {
    sb = getServiceClient();
  } catch (initError: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to initialize Supabase client",
        details: initError.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  }

  try {
    // Parse request body (optional trade_date)
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is acceptable - will use current date
    }

    const tradeDateParam = body.trade_date || null;
    const checkStatusOnly = body.check_status === true;

    // If check_status requested, return status without executing
    if (checkStatusOnly) {
      const { data: statusData, error: statusErr } = await sb
        .schema("lth_pvr")
        .rpc("get_pipeline_status", { p_trade_date: tradeDateParam });

      if (statusErr) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to check pipeline status",
            details: statusErr.message,
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "content-type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify(statusData), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // Execute pipeline resume
    const { data, error } = await sb
      .schema("lth_pvr")
      .rpc("resume_daily_pipeline", { p_trade_date: tradeDateParam });

    if (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to resume pipeline",
          details: error.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    // Check if the function returned an error state
    if (data && !data.success) {
      return new Response(JSON.stringify(data), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("ef_resume_pipeline error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  }
});
