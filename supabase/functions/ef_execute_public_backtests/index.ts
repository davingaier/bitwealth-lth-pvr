import { createClient } from "jsr:@supabase/supabase-js@2";

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  db: { schema: "lth_pvr_bt" },
});

/**
 * Execute Public Back-Test
 * Polls for pending public back-test requests and executes them
 */
Deno.serve(async (_req) => {
  try {
    console.log("🔍 Checking for pending public back-test requests...");

    // Get pending back-test requests
    const { data: requests, error: fetchError } = await supabase
      .schema("public")
      .from("backtest_requests")
      .select("id, bt_run_id, email")
      .eq("status", "running")
      .limit(5); // Process max 5 at a time

    if (fetchError) {
      console.error("Error fetching requests:", fetchError);
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!requests || requests.length === 0) {
      console.log("✅ No pending requests found");
      return new Response(
        JSON.stringify({ success: true, message: "No pending requests", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${requests.length} pending request(s)`);

    const results = [];

    // Process each request
    for (const request of requests) {
      try {
        console.log(`🚀 Triggering back-test for request ${request.id}`);

        // Trigger ef_bt_execute WITHOUT waiting for completion (fire-and-forget)
        fetch(`${supabaseUrl}/functions/v1/ef_bt_execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            bt_run_id: request.bt_run_id,
          }),
        }).catch((err) => {
          console.error(`Failed to trigger ef_bt_execute for ${request.id}:`, err);
        });

        // Check bt_runs status to see if it's already completed
        const { data: btRun } = await supabase
          .schema("lth_pvr_bt")
          .from("bt_runs")
          .select("status, error")
          .eq("bt_run_id", request.bt_run_id)
          .single();

        if (btRun) {
          if (btRun.status === "ok") {
            // Back-test completed successfully
            await supabase
              .schema("public")
              .from("backtest_requests")
              .update({ status: "completed", updated_at: new Date().toISOString() })
              .eq("id", request.id);

            console.log(`✅ Back-test completed for ${request.email}`);
            results.push({
              request_id: request.id,
              status: "completed",
              bt_run_id: request.bt_run_id,
            });
          } else if (btRun.status === "error") {
            // Back-test failed
            await supabase
              .schema("public")
              .from("backtest_requests")
              .update({
                status: "failed",
                error_message: btRun.error || "Back-test execution failed",
                updated_at: new Date().toISOString(),
              })
              .eq("id", request.id);

            console.error(`❌ Back-test failed for ${request.email}:`, btRun.error);
            results.push({
              request_id: request.id,
              status: "failed",
              error: btRun.error,
            });
          } else {
            // Still running
            console.log(`⏳ Back-test still running for ${request.email}`);
            results.push({
              request_id: request.id,
              status: "running",
              bt_run_id: request.bt_run_id,
            });
          }
        }
      } catch (error) {
        console.error(`❌ Error processing request ${request.id}:`, error);

        // Update request status to failed
        await supabase
          .schema("public")
          .from("backtest_requests")
          .update({
            status: "failed",
            error_message: error.message || "Unknown error",
            updated_at: new Date().toISOString(),
          })
          .eq("id", request.id);

        results.push({
          request_id: request.id,
          status: "failed",
          error: error.message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Error in ef_execute_public_backtests:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
