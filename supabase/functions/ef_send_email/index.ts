// ef_send_email/index.ts
// Purpose: Centralized email sending using Resend API
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SECRET_KEY = Deno.env.get("Secret Key");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

/**
 * Replace {{placeholders}} in template with values from data object
 */
function replacePlaceholders(template: string, data: Record<string, any>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, String(value ?? ""));
  }
  return result;
}

/**
 * Send email via Resend API
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
  from: string = "BitWealth <noreply@bitwealth.co.za>"
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return {
        success: false,
        error: `Resend API error: ${errorData.message || response.statusText}`,
      };
    }

    const result = await response.json();
    return {
      success: true,
      message_id: result.id,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to send email: ${error.message}`,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const {
      template_key,
      to_email,
      data = {},
      from_email,
    } = body;

    // Validate inputs
    if (!template_key || !to_email) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: template_key, to_email" }),
        { status: 400, headers: CORS }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { persistSession: false },
    });

    // Fetch email template
    const { data: template, error: templateError } = await supabase
      .from("email_templates")
      .select("subject, body_html")
      .eq("template_key", template_key)
      .eq("active", true)
      .single();

    if (templateError || !template) {
      return new Response(
        JSON.stringify({ error: `Template not found: ${template_key}` }),
        { status: 404, headers: CORS }
      );
    }

    // Replace placeholders in subject and body
    const subject = replacePlaceholders(template.subject, data);
    const html = replacePlaceholders(template.body_html, data);

    // Send email via Resend
    const result = await sendEmail(to_email, subject, html, from_email);

    // Log email attempt
    await supabase.from("email_logs").insert({
      template_key,
      recipient_email: to_email,
      subject,
      status: result.success ? "sent" : "failed",
      resend_message_id: result.message_id,
      error_message: result.error,
      template_data: data,
    });

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 500, headers: CORS }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_id: result.message_id,
      }),
      { status: 200, headers: CORS }
    );
  } catch (error) {
    console.error("ef_send_email error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: CORS }
    );
  }
});
