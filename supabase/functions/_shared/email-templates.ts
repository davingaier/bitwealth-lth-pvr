// email-templates.ts
// Purpose: HTML email templates for customer notifications
// Each function returns HTML and plain text versions

export interface EmailTemplate {
  html: string;
  text: string;
}

/**
 * Generate BitWealth logo header HTML (reusable across all templates)
 */
function getLogoHeader(): string {
  return `
    <div style="text-align: center;">
      <div style="font-family: 'Aptos', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 32px; font-weight: 700; color: #F39C12; letter-spacing: 0.5px; margin-bottom: 8px;">
        BitWealth
      </div>
      <div style="font-size: 13px; color: #ffffff; letter-spacing: 1px; text-transform: uppercase; opacity: 0.9;">
        LTH PVR Bitcoin DCA Strategy
      </div>
    </div>
  `;
}

/**
 * Template 7: Deposit Received - Customer Notification
 * Sent when USDT or ZAR deposit is detected
 * 
 * @param customerName - Customer's first name
 * @param depositAmount - Amount deposited (e.g., "500.00")
 * @param depositCurrency - Currency deposited ("USDT" or "ZAR")
 * @param depositDate - Date of deposit (ISO string or Date object)
 * @returns EmailTemplate with HTML and text versions
 * 
 * @example
 * const email = getDepositReceivedEmail("John", "500.00", "USDT", new Date());
 * await sendHTMLEmail(to, from, "Deposit Received", email.html, email.text);
 */
export function getDepositReceivedEmail(
  customerName: string,
  depositAmount: string,
  depositCurrency: string,
  depositDate: string | Date
): EmailTemplate {
  const formattedDate = typeof depositDate === 'string' 
    ? new Date(depositDate).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' })
    : depositDate.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });

  const currencySymbol = depositCurrency === "ZAR" ? "R" : "";
  const displayAmount = `${currencySymbol}${depositAmount} ${depositCurrency}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Aptos', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0A2E4D 0%, #1e3a8a 100%); color: white; padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
      ${getLogoHeader()}
      <div style="font-size: 48px; margin: 20px 0 10px 0;">🎉</div>
      <h1 style="margin: 0; font-size: 32px;">Deposit Received!</h1>
      <p style="font-size: 18px; margin-top: 10px;">Your Account is Now Active</p>
    </div>

    <!-- Body -->
    <div style="padding: 30px; background: #ffffff;">
      <p style="font-size: 16px; color: #1e3a8a;">Hi ${customerName},</p>

      <div style="background: #d1fae5; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; border-left: 4px solid #10b981;">
        <div style="font-size: 1.3em; font-weight: 700; color: #059669; margin-bottom: 10px;">
          ✓ ${displayAmount} Credited to Your Account
        </div>
        <div style="color: #065f46; font-size: 0.95em;">
          Date: ${formattedDate}
        </div>
      </div>

      <p style="color: #4b5563; line-height: 1.6;">
        Great news! We've detected a deposit to your BitWealth account and your funds have been successfully credited to your account and are now available for trading.
      </p>

      <h3 style="color: #0A2E4D; margin-top: 30px;">What happens next?</h3>
      <ul style="color: #4b5563; line-height: 1.8;">
        <li>Your strategy will automatically include these funds in the next trading cycle</li>
        <li>Orders will be executed according to the LTH PVR signals</li>
        <li>You can track performance in real-time via the Customer Portal</li>
      </ul>

      ${depositCurrency === "ZAR" ? `
      <div style="background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 4px;">
        <strong style="color: #92400e;">ℹ️ ZAR Deposit Note:</strong>
        <p style="color: #78350f; margin: 5px 0 0 0; font-size: 0.9em;">
          Your ZAR deposit must be manually converted to USDT on VALR before it can be used for trading. 
          Our team will handle this conversion and notify you once complete.
        </p>
      </div>
      ` : ''}

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://bitwealth.co.za/customer-portal.html" 
           style="display: inline-block; background: #3b82f6; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          View Your Portfolio →
        </a>
      </div>

      <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
        If you have any questions about your deposit or strategy performance, please don't hesitate to reach out.
      </p>

      <p style="color: #4b5563; margin-top: 30px;">
        Best regards,<br>
        <strong>The BitWealth Team</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;">
      <p style="margin: 0 0 10px 0;">
        © ${new Date().getFullYear()} BitWealth. All rights reserved.
      </p>
      <p style="margin: 0;">
        <a href="https://bitwealth.co.za" style="color: #3b82f6; text-decoration: none;">Website</a> · 
        <a href="https://bitwealth.co.za/customer-portal.html" style="color: #3b82f6; text-decoration: none;">Customer Portal</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;

  const text = `
DEPOSIT RECEIVED - BitWealth

Hi ${customerName},

DEPOSIT CONFIRMED:
${displayAmount} credited to your account
Date: ${formattedDate}

Great news! We've detected a deposit to your BitWealth account and your funds have been successfully credited.

WHAT HAPPENS NEXT:
• Your strategy will automatically include these funds in the next trading cycle
• Orders will be executed according to the LTH PVR signals
• You can track performance in real-time via the Customer Portal

${depositCurrency === "ZAR" ? `
NOTE: ZAR Deposit
Your ZAR deposit must be manually converted to USDT on VALR before it can be used for trading. Our team will handle this conversion and notify you once complete.
` : ''}

View your portfolio: https://bitwealth.co.za/customer-portal.html

If you have any questions about your deposit or strategy performance, please don't hesitate to reach out.

Best regards,
The BitWealth Team

© ${new Date().getFullYear()} BitWealth. All rights reserved.
Website: https://bitwealth.co.za
Customer Portal: https://bitwealth.co.za/customer-portal.html
  `.trim();

  return { html, text };
}
