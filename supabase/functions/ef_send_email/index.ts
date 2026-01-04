// ef_send_email/index.ts
// Purpose: Centralized email sending using SMTP
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendHTMLEmail } from "../_shared/smtp.ts";

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
 * Extract plain text from HTML for email fallback
 */
function htmlToPlainText(html: string): string {
  // Simple HTML to text conversion
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
    const text = htmlToPlainText(html);

    // Set default from address if not provided
    const fromAddress = from_email || "BitWealth <noreply@bitwealth.co.za>";

    // Send email via SMTP
    const result = await sendHTMLEmail(to_email, fromAddress, subject, html, text);

    // Log email attempt
    await supabase.from("email_logs").insert({
      template_key,
      recipient_email: to_email,
      subject,
      status: result.success ? "sent" : "failed",
      smtp_message_id: result.messageId,
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
        message_id: result.messageId,
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
