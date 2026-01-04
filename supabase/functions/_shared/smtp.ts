// smtp.ts
// Purpose: SMTP email sending utility for Deno edge functions using nodemailer
// Replaces Resend API with direct SMTP integration

import nodemailer from "npm:nodemailer@6.9.7";

/**
 * SMTP Configuration from environment variables
 */
interface SMTPConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
}

/**
 * Email sending options
 */
interface EmailOptions {
  to: string | string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

/**
 * Email sending result
 */
interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Get SMTP configuration from environment variables
 */
function getSMTPConfig(): SMTPConfig {
  const host = Deno.env.get("SMTP_HOST");
  const port = Deno.env.get("SMTP_PORT");
  const username = Deno.env.get("SMTP_USER");
  const password = Deno.env.get("SMTP_PASS");
  const secure = Deno.env.get("SMTP_SECURE");

  if (!host || !port || !username || !password) {
    throw new Error(
      "Missing SMTP configuration. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS"
    );
  }

  return {
    host,
    port: parseInt(port, 10),
    username,
    password,
    secure: secure === "true",
  };
}

/**
 * Send email via SMTP using nodemailer
 * 
 * @param options - Email sending options
 * @returns EmailResult with success status and message ID or error
 * 
 * @example
 * ```typescript
 * const result = await sendEmail({
 *   to: "customer@example.com",
 *   from: "noreply@bitwealth.co.za",
 *   subject: "Welcome to BitWealth",
 *   html: "<h1>Welcome!</h1><p>Thanks for joining us.</p>",
 *   text: "Welcome! Thanks for joining us."
 * });
 * 
 * if (!result.success) {
 *   console.error("Email failed:", result.error);
 * }
 * ```
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  try {
    const config = getSMTPConfig();

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });

    // Normalize 'to' field to array
    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    // Validate required fields
    if (!options.from || recipients.length === 0 || !options.subject) {
      return {
        success: false,
        error: "Missing required fields: from, to, subject",
      };
    }

    if (!options.html && !options.text) {
      return {
        success: false,
        error: "Either html or text content is required",
      };
    }

    // Send email
    const info = await transporter.sendMail({
      from: options.from,
      to: recipients.join(", "),
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("SMTP send error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Send plain text email (for alerts)
 * 
 * @param to - Recipient email address(es)
 * @param from - Sender email address
 * @param subject - Email subject
 * @param text - Plain text content
 * @returns EmailResult with success status
 * 
 * @example
 * ```typescript
 * await sendTextEmail(
 *   "admin@bitwealth.co.za",
 *   "admin@bitwealth.co.za",
 *   "Alert Digest",
 *   "5 new critical alerts..."
 * );
 * ```
 */
export async function sendTextEmail(
  to: string | string[],
  from: string,
  subject: string,
  text: string
): Promise<EmailResult> {
  return sendEmail({ to, from, subject, text });
}

/**
 * Send HTML email (for templated emails)
 * 
 * @param to - Recipient email address
 * @param from - Sender email address
 * @param subject - Email subject
 * @param html - HTML content
 * @param text - Optional plain text fallback
 * @returns EmailResult with success status
 * 
 * @example
 * ```typescript
 * await sendHTMLEmail(
 *   "customer@example.com",
 *   "noreply@bitwealth.co.za",
 *   "Welcome!",
 *   "<h1>Welcome</h1>",
 *   "Welcome"
 * );
 * ```
 */
export async function sendHTMLEmail(
  to: string,
  from: string,
  subject: string,
  html: string,
  text?: string
): Promise<EmailResult> {
  return sendEmail({ to, from, subject, html, text });
}

/**
 * Test SMTP connection
 * Useful for debugging configuration issues
 * 
 * @returns true if connection successful, false otherwise
 */
export async function testSMTPConnection(): Promise<boolean> {
  try {
    const config = getSMTPConfig();
    console.log(`Testing SMTP connection to ${config.host}:${config.port}...`);
    
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });

    await transporter.verify();
    console.log("SMTP connection verified successfully");
    return true;
  } catch (error) {
    console.error("SMTP test failed:", error);
    return false;
  }
}

/**
 * Close SMTP connection (cleanup)
 * Not needed for nodemailer as connections are created per-send
 */
export function closeSMTPConnection(): void {
  // No-op for nodemailer
  console.log("SMTP cleanup called (no action needed for nodemailer)");
}
