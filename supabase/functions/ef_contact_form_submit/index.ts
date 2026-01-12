// ef_contact_form_submit/index.ts
// Purpose: Handle contact form submissions from website with reCAPTCHA verification
// Sends admin notification to info@bitwealth.co.za and auto-reply to submitter

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendHTMLEmail } from "../_shared/smtp.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RECAPTCHA_SECRET_KEY = Deno.env.get("RECAPTCHA_SECRET_KEY");
const ADMIN_EMAIL = "info@bitwealth.co.za";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

/**
 * Verify Google reCAPTCHA token
 */
async function verifyCaptcha(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${RECAPTCHA_SECRET_KEY}&response=${token}`,
    });

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error("reCAPTCHA verification error:", error);
    return false;
  }
}

/**
 * Generate admin notification email HTML
 */
function generateAdminEmailHTML(name: string, email: string, message: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #003B73; color: white; padding: 30px 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px; }
    .field { margin-bottom: 20px; }
    .label { font-weight: 600; color: #003B73; margin-bottom: 5px; }
    .value { background: white; padding: 12px; border-left: 3px solid #F39C12; border-radius: 4px; }
    .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">📧 New Contact Form Submission</h1>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">Name:</div>
        <div class="value">${name}</div>
      </div>
      <div class="field">
        <div class="label">Email:</div>
        <div class="value"><a href="mailto:${email}">${email}</a></div>
      </div>
      <div class="field">
        <div class="label">Message:</div>
        <div class="value">${message.replace(/\n/g, '<br>')}</div>
      </div>
      <div class="field">
        <div class="label">Submitted:</div>
        <div class="value">${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</div>
      </div>
    </div>
    <div class="footer">
      <p>This email was automatically generated from the BitWealth website contact form.</p>
      <p><a href="https://bitwealth.co.za">bitwealth.co.za</a></p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate auto-reply confirmation email HTML
 */
function generateAutoReplyHTML(name: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #003B73 0%, #0074D9 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .logo { font-size: 36px; font-weight: 700; margin-bottom: 10px; }
    .content { background: #f9f9f9; padding: 30px 20px; border: 1px solid #ddd; border-top: none; }
    .message { background: white; padding: 20px; border-left: 4px solid #F39C12; border-radius: 4px; margin: 20px 0; }
    .cta { text-align: center; margin: 30px 0; }
    .btn { display: inline-block; background: #F39C12; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .footer { background: #003B73; color: white; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">BitWealth</div>
      <p style="margin: 0; font-size: 18px;">Thank You for Contacting Us</p>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <div class="message">
        <strong>✅ Message Received</strong><br>
        We've successfully received your message and will get back to you within 24 hours.
      </div>
      
      <p>Our team reviews all inquiries carefully and will respond to your email address as soon as possible.</p>
      
      <p>In the meantime, feel free to explore our platform:</p>
      
      <div class="cta">
        <a href="https://bitwealth.co.za/lth-pvr.html" class="btn">Learn About LTH PVR Strategy</a>
      </div>
      
      <p style="margin-top: 30px;">Best regards,<br><strong>The BitWealth Team</strong></p>
    </div>
    <div class="footer">
      <p style="margin: 0 0 10px 0;"><strong>BitWealth</strong> - Smart Bitcoin Accumulation</p>
      <p style="margin: 0;">🌐 <a href="https://bitwealth.co.za" style="color: #F39C12;">bitwealth.co.za</a> | 
         📧 <a href="mailto:info@bitwealth.co.za" style="color: #F39C12;">info@bitwealth.co.za</a></p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await req.json();
    const { name, email, message, captcha_token } = body;

    // Validate inputs
    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Missing required fields: name, email, message" 
        }),
        { status: 400, headers: CORS }
      );
    }

    if (!captcha_token) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "reCAPTCHA verification required" 
        }),
        { status: 400, headers: CORS }
      );
    }

    // Verify reCAPTCHA
    const captchaValid = await verifyCaptcha(captcha_token);
    if (!captchaValid) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "reCAPTCHA verification failed. Please try again." 
        }),
        { status: 400, headers: CORS }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Invalid email address format" 
        }),
        { status: 400, headers: CORS }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });

    // Store submission in database
    const { data: submission, error: dbError } = await supabase
      .from("contact_form_submissions")
      .insert({
        name,
        email: email.toLowerCase().trim(),
        message,
        captcha_verified: true,
        user_agent: req.headers.get("user-agent"),
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
      })
      .select("id")
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Failed to save submission. Please try again." 
        }),
        { status: 500, headers: CORS }
      );
    }

    // Send admin notification email
    const adminEmailHTML = generateAdminEmailHTML(name, email, message);
    const adminEmailText = `New Contact Form Submission\n\nName: ${name}\nEmail: ${email}\nMessage: ${message}\nSubmitted: ${new Date().toISOString()}`;
    
    const adminEmailResult = await sendHTMLEmail(
      ADMIN_EMAIL,
      "BitWealth Contact Form <noreply@bitwealth.co.za>",
      `🔔 New Contact Form Submission from ${name}`,
      adminEmailHTML,
      adminEmailText
    );

    // Update admin_notified_at if email sent successfully
    if (adminEmailResult.success) {
      await supabase
        .from("contact_form_submissions")
        .update({ admin_notified_at: new Date().toISOString() })
        .eq("id", submission.id);
    } else {
      console.error("Admin email failed:", adminEmailResult.error);
    }

    // Send auto-reply to submitter
    const autoReplyHTML = generateAutoReplyHTML(name);
    const autoReplyText = `Hi ${name},\n\nThank you for contacting BitWealth! We've received your message and will get back to you within 24 hours.\n\nBest regards,\nThe BitWealth Team\n\nbitwealth.co.za`;
    
    const autoReplyResult = await sendHTMLEmail(
      email,
      "BitWealth <info@bitwealth.co.za>",
      "Thank You for Contacting BitWealth",
      autoReplyHTML,
      autoReplyText
    );

    // Update auto_reply_sent_at if email sent successfully
    if (autoReplyResult.success) {
      await supabase
        .from("contact_form_submissions")
        .update({ auto_reply_sent_at: new Date().toISOString() })
        .eq("id", submission.id);
    } else {
      console.error("Auto-reply email failed:", autoReplyResult.error);
    }

    // Return success even if emails failed (submission is saved)
    return new Response(
      JSON.stringify({
        success: true,
        message: "Thank you for your message! We'll get back to you within 24 hours.",
        admin_notified: adminEmailResult.success,
        auto_reply_sent: autoReplyResult.success,
      }),
      { status: 200, headers: CORS }
    );

  } catch (error) {
    console.error("Contact form submission error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "An unexpected error occurred. Please try again." 
      }),
      { status: 500, headers: CORS }
    );
  }
});
