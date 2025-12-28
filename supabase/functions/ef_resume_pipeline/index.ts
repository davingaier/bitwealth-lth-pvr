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

    // Get pipeline status to determine which steps need execution
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

    if (!statusData.can_resume) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Cannot resume pipeline at this time",
          status: statusData,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "content-type": "application/json" },
        }
      );
    }

    // Execute steps sequentially
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const steps = statusData.steps;
    const results = [];
    
    const stepOrder = [
      { name: "ef_generate_decisions", status: steps.decisions },
      { name: "ef_create_order_intents", status: steps.order_intents },
      { name: "ef_execute_orders", status: steps.execute_orders },
      { name: "ef_poll_orders", status: steps.poll_orders },
      { name: "ef_post_ledger_and_balances", status: steps.ledger_posted },
    ];
    
    for (const step of stepOrder) {
      if (step.status === true) {
        results.push({ step: step.name, skipped: true, reason: "already complete" });
        continue;
      }
      
      console.log(`Executing ${step.name}...`);
      
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/${step.name}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        
        const text = await response.text();
        
        results.push({
          step: step.name,
          status: response.status,
          success: response.ok,
          response: text.substring(0, 200),
        });
        
        if (!response.ok) {
          console.error(`${step.name} failed: ${text}`);
          break;
        }
      } catch (err) {
        console.error(`${step.name} error:`, err);
        results.push({
          step: step.name,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        message: "Pipeline execution completed",
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
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
