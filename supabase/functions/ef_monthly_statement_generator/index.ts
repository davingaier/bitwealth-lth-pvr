// ef_monthly_statement_generator/index.ts
// Purpose: Generate monthly statements for all active customers on 1st of month
// Triggered by pg_cron at 00:01 UTC on 1st of every month
// Generates previous month's statements and emails customers

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = Deno.env.get("ORG_ID");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  try {
    console.log("[ef_monthly_statement_generator] Starting monthly statement generation");

    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      db: { schema: "lth_pvr" },
    });

    // Calculate previous month
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    console.log(`[ef_monthly_statement_generator] Generating statements for ${prevMonth}/${prevYear}`);

    // Get all active customers with strategies (consolidated table)
    const { data: strategies, error: strategyError } = await supabase
      .schema("public")
      .from("customer_strategies")
      .select(`
        customer_id,
        status,
        customer_details!inner(
          customer_id,
          first_names,
          last_name,
          email
        )
      `)
      .eq("org_id", ORG_ID)
      .eq("status", "active");

    if (strategyError) {
      throw new Error(`Failed to fetch strategies: ${strategyError.message}`);
    }

    console.log(`[ef_monthly_statement_generator] Found ${strategies?.length || 0} active customers`);

    const results = {
      total: strategies?.length || 0,
      generated: 0,
      emailed: 0,
      errors: [] as any[],
    };

    // Generate statements for each customer
    for (const strategy of strategies || []) {
      const customerId = strategy.customer_id;
      const customer = (strategy as any).customer_details;

      try {
        console.log(`[ef_monthly_statement_generator] Generating statement for customer ${customerId}`);

        // Call ef_generate_statement
        const statementResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/ef_generate_statement`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              customer_id: customerId,
              year: prevYear,
              month: prevMonth,
            }),
          }
        );

        if (!statementResponse.ok) {
          const errorData = await statementResponse.json();
          throw new Error(errorData.error || "Failed to generate statement");
        }

        const statementData = await statementResponse.json();
        results.generated++;

        console.log(`[ef_monthly_statement_generator] Statement generated: ${statementData.filename}`);

        // Send email notification
        try {
          const monthNames = ["", "January", "February", "March", "April", "May", "June",
                             "July", "August", "September", "October", "November", "December"];
          const monthName = monthNames[prevMonth];

          const emailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: "BitWealth <no-reply@bitwealth.co.za>",
              to: [customer.email],
              subject: `Your BitWealth ${monthName} ${prevYear} Monthly Statement`,
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <style>
                    body { font-family: 'Aptos', 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #032C48; background: #f5f5f5; margin: 0; padding: 0; }
                    .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden; }
                    .header { background: linear-gradient(135deg, #032C48 0%, #065A9E 100%); color: white; padding: 40px 30px; text-align: center; }
                    .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
                    .content { padding: 40px 30px; }
                    .greeting { font-size: 18px; font-weight: 600; color: #032C48; margin-bottom: 20px; }
                    .message { font-size: 16px; color: #333; margin-bottom: 30px; line-height: 1.8; }
                    .btn { display: inline-block; background: #E5A663; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; margin: 20px 0; transition: background 0.3s; }
                    .btn:hover { background: #D89553; }
                    .footer { background: #f8f8f8; padding: 30px; text-align: center; font-size: 14px; color: #666; border-top: 1px solid #e0e0e0; }
                    .footer a { color: #065A9E; text-decoration: none; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="header">
                      <h1>📄 Monthly Statement Available</h1>
                    </div>
                    <div class="content">
                      <div class="greeting">Hi ${customer.first_names},</div>
                      <div class="message">
                        <p>Your BitWealth monthly investment statement for <strong>${monthName} ${prevYear}</strong> is now ready!</p>
                        <p>This statement includes:</p>
                        <ul style="margin: 15px 0; padding-left: 20px;">
                          <li>Performance summary with ROI and CAGR</li>
                          <li>Complete transaction history</li>
                          <li>Benchmark comparison (LTH PVR vs Standard DCA)</li>
                          <li>Portfolio balances and fee breakdown</li>
                        </ul>
                        <p>You can download your statement using the button below, or log in to the Customer Portal anytime to access all your statements.</p>
                      </div>
                      <div style="text-align: center;">
                        <a href="${statementData.downloadUrl}" class="btn">📥 Download Statement</a>
                      </div>
                      <div style="margin-top: 30px; padding: 20px; background: #f0f7ff; border-left: 4px solid #065A9E; border-radius: 6px;">
                        <p style="margin: 0; font-size: 14px; color: #032C48;">
                          <strong>📊 Quick Access:</strong> Log in to the <a href="https://bitwealth.co.za/customer-portal.html" style="color: #065A9E; text-decoration: none;">Customer Portal</a> to view your current portfolio, download historical statements, and manage your settings.
                        </p>
                      </div>
                    </div>
                    <div class="footer">
                      <p>This is an automated message from BitWealth.</p>
                      <p>If you have any questions, please contact us at <a href="mailto:support@bitwealth.co.za">support@bitwealth.co.za</a></p>
                      <p style="margin-top: 20px; font-size: 12px; color: #999;">
                        © ${prevYear} BitWealth. All rights reserved.<br>
                        Automated Bitcoin Investment Platform
                      </p>
                    </div>
                  </div>
                </body>
                </html>
              `,
            }),
          });

          if (!emailResponse.ok) {
            const emailError = await emailResponse.json();
            throw new Error(`Email failed: ${JSON.stringify(emailError)}`);
          }

          results.emailed++;
          console.log(`[ef_monthly_statement_generator] Email sent to ${customer.email}`);

        } catch (emailError) {
          console.error(`[ef_monthly_statement_generator] Email error for customer ${customerId}:`, emailError);
          results.errors.push({
            customer_id: customerId,
            email: customer.email,
            type: "email",
            error: emailError.message,
          });
        }

      } catch (error) {
        console.error(`[ef_monthly_statement_generator] Error for customer ${customerId}:`, error);
        results.errors.push({
          customer_id: customerId,
          type: "statement",
          error: error.message,
        });
      }
    }

    console.log(`[ef_monthly_statement_generator] Complete:`, results);

    return new Response(
      JSON.stringify({
        success: true,
        month: prevMonth,
        year: prevYear,
        results,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("[ef_monthly_statement_generator] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to generate monthly statements" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
