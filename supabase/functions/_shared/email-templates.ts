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
          Your ZAR will be automatically converted to USDT to be used for trading. You can view your currency conversions and balances in the Customer Portal.
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
Your ZAR will be automatically converted to USDT to be used for trading. You can view your currency conversions and balances in the Customer Portal.
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

/**
 * Template: Withdrawal Submitted & Processing
 * Sent immediately when EF10 creates the withdrawal record and starts execution.
 */
export function getWithdrawalSubmittedEmail(
  customerName: string,
  currency: string,
  grossAmount: number,
  netAmount: number,
  interimFeeUsdt: number,
  valrFeesDisplay: string,
  requestId: string,
): EmailTemplate {
  const currencySymbol = currency === "ZAR" ? "R" : "";
  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString("en-ZA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const grossDisplay = `${currencySymbol}${fmt(grossAmount)} ${currency}`;
  const netDisplay = `${currencySymbol}${fmt(netAmount)} ${currency}`;
  const feeDisplay = interimFeeUsdt > 0 ? `$${fmt(interimFeeUsdt)} USDT` : "None";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Aptos', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
    <div style="background: linear-gradient(135deg, #0A2E4D 0%, #1e3a8a 100%); color: white; padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
      ${getLogoHeader()}
      <div style="font-size: 48px; margin: 20px 0 10px 0;">⏳</div>
      <h1 style="margin: 0; font-size: 28px;">Withdrawal Processing</h1>
      <p style="font-size: 16px; margin-top: 10px; opacity: 0.9;">Your request is being executed</p>
    </div>
    <div style="padding: 30px; background: #ffffff;">
      <p style="font-size: 16px; color: #1e3a8a;">Hi ${customerName},</p>
      <p style="color: #4b5563; line-height: 1.6;">
        We have received your withdrawal request and are processing it now. Please allow a few minutes for VALR to process the transfer.
      </p>
      <div style="background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 6px 0; color: #4b5563;">Requested amount:</td>
            <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #111827;">${grossDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #4b5563;">Interim performance fee:</td>
            <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #b45309;">${feeDisplay}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #4b5563;">VALR fees:</td>
            <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #4b5563;">${valrFeesDisplay}</td>
          </tr>
          <tr style="border-top: 2px solid #d1d5db;">
            <td style="padding: 10px 0 6px; font-weight: 700; color: #0A2E4D;">Amount you will receive:</td>
            <td style="padding: 10px 0 6px; font-weight: 700; text-align: right; color: #059669; font-size: 1.1em;">${netDisplay}</td>
          </tr>
        </table>
      </div>
      <p style="color: #6b7280; font-size: 13px;">
        Reference: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 3px;">${requestId}</code>
      </p>
      <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
        If you did not request this withdrawal or believe there is an error, please contact us immediately.
      </p>
      <p style="color: #4b5563; margin-top: 30px;">
        Best regards,<br>
        <strong>The BitWealth Team</strong>
      </p>
    </div>
    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;">
      <p style="margin: 0 0 10px 0;">© ${new Date().getFullYear()} BitWealth. All rights reserved.</p>
      <p style="margin: 0;">
        <a href="https://bitwealth.co.za" style="color: #3b82f6; text-decoration: none;">Website</a> ·
        <a href="https://bitwealth.co.za/customer-portal.html" style="color: #3b82f6; text-decoration: none;">Customer Portal</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `
WITHDRAWAL PROCESSING - BitWealth

Hi ${customerName},

Your withdrawal request has been received and is now being executed.

WITHDRAWAL SUMMARY:
  Requested: ${grossDisplay}
  Interim fee: ${feeDisplay}
  VALR fees: ${valrFeesDisplay}
  You receive: ${netDisplay}

Reference: ${requestId}

If you did not request this withdrawal, please contact us immediately.

Best regards,
The BitWealth Team
  `.trim();

  return { html, text };
}

/**
 * Template: Withdrawal Outcome
 * Variant A (completed) — sent when VALR confirms the withdrawal.
 * Variant B (failed)    — sent when VALR rejects the withdrawal.
 */
export function getWithdrawalOutcomeEmail(
  customerName: string,
  currency: string,
  netAmount: number,
  status: "completed" | "failed",
  completedAt?: string | Date,
  errorMessage?: string,
  valrWithdrawalId?: string,
): EmailTemplate {
  const currencySymbol = currency === "ZAR" ? "R" : "";
  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString("en-ZA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const netDisplay = `${currencySymbol}${fmt(netAmount)} ${currency}`;
  const isCompleted = status === "completed";

  const formattedDate = completedAt
    ? (typeof completedAt === "string" ? new Date(completedAt) : completedAt).toLocaleDateString(
        "en-ZA",
        { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" },
      )
    : "";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Aptos', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
    <div style="background: linear-gradient(135deg, ${isCompleted ? "#065f46 0%, #059669" : "#7f1d1d 0%, #dc2626"} 100%); color: white; padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
      ${getLogoHeader()}
      <div style="font-size: 48px; margin: 20px 0 10px 0;">${isCompleted ? "✅" : "❌"}</div>
      <h1 style="margin: 0; font-size: 28px;">${isCompleted ? "Withdrawal Complete" : "Withdrawal Failed"}</h1>
    </div>
    <div style="padding: 30px; background: #ffffff;">
      <p style="font-size: 16px; color: #1e3a8a;">Hi ${customerName},</p>
      ${isCompleted
        ? `<div style="background: #d1fae5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; text-align: center;">
             <div style="font-size: 1.2em; font-weight: 700; color: #059669;">✓ ${netDisplay} Successfully Withdrawn</div>
             ${formattedDate ? `<div style="color: #065f46; font-size: 0.9em; margin-top: 8px;">Completed: ${formattedDate}</div>` : ""}
             ${valrWithdrawalId ? `<div style="color: #065f46; font-size: 0.85em; margin-top: 4px;">VALR ID: ${valrWithdrawalId}</div>` : ""}
           </div>
           <p style="color: #4b5563; line-height: 1.6;">Your withdrawal has been processed. For ${currency === "ZAR" ? "bank transfers, please allow 1–2 business days for the funds to reflect in your account." : "crypto withdrawals, please allow 10–60 minutes for the blockchain to confirm."}</p>`
        : `<div style="background: #fee2e2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
             <div style="font-weight: 700; color: #991b1b; margin-bottom: 8px;">❌ Withdrawal of ${netDisplay} could not be processed</div>
             ${errorMessage ? `<div style="color: #7f1d1d; font-size: 0.9em;">${errorMessage}</div>` : ""}
           </div>
           <p style="color: #4b5563; line-height: 1.6;">
             We were unable to complete your withdrawal. Your funds remain in your BitWealth account and have not been deducted. Please contact BitWealth support so we can assist you.
           </p>`}
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://bitwealth.co.za/customer-portal.html"
           style="display: inline-block; background: #3b82f6; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          View Your Portfolio →
        </a>
      </div>
      <p style="color: #4b5563; margin-top: 30px;">
        Best regards,<br>
        <strong>The BitWealth Team</strong>
      </p>
    </div>
    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;">
      <p style="margin: 0 0 10px 0;">© ${new Date().getFullYear()} BitWealth. All rights reserved.</p>
      <p style="margin: 0;">
        <a href="https://bitwealth.co.za" style="color: #3b82f6; text-decoration: none;">Website</a> ·
        <a href="https://bitwealth.co.za/customer-portal.html" style="color: #3b82f6; text-decoration: none;">Customer Portal</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = isCompleted
    ? `
WITHDRAWAL COMPLETE - BitWealth

Hi ${customerName},

Your withdrawal of ${netDisplay} has been successfully processed.
${formattedDate ? `Completed: ${formattedDate}` : ""}
${valrWithdrawalId ? `VALR Reference: ${valrWithdrawalId}` : ""}

For ZAR bank transfers, allow 1–2 business days. For crypto, allow 10–60 minutes for blockchain confirmation.

Best regards,
The BitWealth Team
    `.trim()
    : `
WITHDRAWAL FAILED - BitWealth

Hi ${customerName},

We were unable to process your withdrawal of ${netDisplay}.
${errorMessage ? `Reason: ${errorMessage}` : ""}

Your funds remain in your BitWealth account. Please contact BitWealth support for assistance.

Best regards,
The BitWealth Team
    `.trim();

  return { html, text };
}

/**
 * Template: Withdrawal Cancelled
 * Sent when EF11 cancels a pending withdrawal at customer's request.
 */
export function getWithdrawalCancelledEmail(
  customerName: string,
  currency: string,
  amount: number,
): EmailTemplate {
  const currencySymbol = currency === "ZAR" ? "R" : "";
  const fmt = (n: number, decimals = 2) =>
    n.toLocaleString("en-ZA", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const displayAmount = `${currencySymbol}${fmt(amount)} ${currency}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: 'Aptos', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f4;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff;">
    <div style="background: linear-gradient(135deg, #0A2E4D 0%, #1e3a8a 100%); color: white; padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
      ${getLogoHeader()}
      <div style="font-size: 48px; margin: 20px 0 10px 0;">🚫</div>
      <h1 style="margin: 0; font-size: 28px;">Withdrawal Cancelled</h1>
    </div>
    <div style="padding: 30px; background: #ffffff;">
      <p style="font-size: 16px; color: #1e3a8a;">Hi ${customerName},</p>
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; border-left: 4px solid #6b7280;">
        <div style="font-size: 1.1em; font-weight: 700; color: #374151;">Withdrawal of ${displayAmount} cancelled</div>
      </div>
      <p style="color: #4b5563; line-height: 1.6;">
        Your withdrawal request has been cancelled and no funds have been deducted from your account. Your full balance remains available in your BitWealth account.
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://bitwealth.co.za/customer-portal.html"
           style="display: inline-block; background: #3b82f6; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
          View Your Portfolio →
        </a>
      </div>
      <p style="color: #4b5563; margin-top: 30px;">Best regards,<br><strong>The BitWealth Team</strong></p>
    </div>
    <div style="background: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px;">
      <p style="margin: 0;">© ${new Date().getFullYear()} BitWealth. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  const text = `
WITHDRAWAL CANCELLED - BitWealth

Hi ${customerName},

Your withdrawal request for ${displayAmount} has been cancelled.
No funds have been deducted — your full balance remains in your account.

Best regards,
The BitWealth Team
  `.trim();

  return { html, text };
}

// ─── API Key Expiry Warning ────────────────────────────────────────────────────
export function getApiKeyExpiryWarningEmail(
  firstName: string,
  keyLabel: string,
  daysRemaining: number,
  expiresAt: Date | string,
  portalUrl: string
): { html: string; text: string } {
  const expiryDate = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  const expiryStr = expiryDate.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });

  const urgencyColor = daysRemaining <= 5 ? '#dc3545' : daysRemaining <= 10 ? '#ff8c00' : '#e6a817';
  const urgencyLabel = daysRemaining <= 1 ? '🚨 CRITICAL' : daysRemaining <= 5 ? '⚠️ Urgent' : '⚠️ Notice';
  const bgColor = daysRemaining <= 5 ? '#fee2e2' : '#fff3cd';
  const textColor = daysRemaining <= 5 ? '#991b1b' : '#856404';

  const html = `
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Aptos','Segoe UI','Helvetica Neue',Arial,sans-serif;background-color:#f4f4f4;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:linear-gradient(135deg,#0A2E4D 0%,#1e3a8a 100%);color:white;padding:40px;text-align:center;border-radius:10px 10px 0 0;">
      ${getLogoHeader()}
      <div style="font-size:48px;margin:20px 0 10px 0;">⚠️</div>
      <h1 style="margin:0;font-size:26px;">API Key Expiry ${urgencyLabel}</h1>
      <p style="font-size:15px;margin-top:10px;opacity:.9;">Action required to keep your trading active</p>
    </div>

    <div style="padding:30px;background:#ffffff;">
      <p style="font-size:16px;color:#1e3a8a;">Hi ${firstName},</p>

      <p style="color:#374151;line-height:1.6;">
        Your VALR API key (<strong>${keyLabel}</strong>) will expire in
        <strong style="color:${urgencyColor};">${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}</strong>
        on <strong>${expiryStr}</strong>.
      </p>

      <div style="background:${bgColor};border-left:4px solid ${urgencyColor};padding:16px;border-radius:4px;margin:20px 0;">
        <strong style="color:${textColor};">If you do not renew before ${expiryStr}, automated trading will be paused for your account.</strong>
      </div>

      <h3 style="color:#0A2E4D;">How to renew your API key (5 steps):</h3>
      <ol style="line-height:1.8;color:#374151;">
        <li>Log in to <a href="https://www.valr.com/" style="color:#3b82f6;">VALR</a> → <strong>Account → API Keys</strong></li>
        <li>Click <strong>Create New API Key</strong> — name it <code>BitWealth Trade</code></li>
        <li>Enable: <strong>View ✓ &nbsp;Trade ✓ &nbsp;Withdraw ✓ &nbsp;Link Bank Account ✓</strong></li>
        <li>Add withdrawal whitelists:<br>
          &nbsp;&nbsp;• BTC: <code>38ppcqBCz58KENxP9Hi79oCrVFuPTHSdTP</code><br>
          &nbsp;&nbsp;• USDT (TRC-20): <code>TSivCwsgBRXBT2A4nF6zRJcMMSX2FeNrfP</code>
        </li>
        <li>Copy your new Key &amp; Secret → <a href="${portalUrl}" style="color:#3b82f6;">BitWealth Portal → Settings → Update API Key</a></li>
      </ol>

      <div style="text-align:center;margin:28px 0;">
        <a href="${portalUrl}" style="background:${urgencyColor};color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
          Update API Key Now →
        </a>
      </div>

      <p style="color:#6b7280;font-size:.9em;">If you need help, reply to this email and our support team will assist you.</p>

      <p style="color:#4b5563;margin-top:30px;">
        Best regards,<br><strong>The BitWealth Team</strong>
      </p>
    </div>

    <div style="background:#f9fafb;padding:20px;text-align:center;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
      <p style="margin:0 0 10px 0;">© ${new Date().getFullYear()} BitWealth. All rights reserved.</p>
      <p style="margin:0;">
        <a href="https://bitwealth.co.za" style="color:#3b82f6;text-decoration:none;">Website</a> ·
        <a href="${portalUrl}" style="color:#3b82f6;text-decoration:none;">Customer Portal</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
${urgencyLabel} — VALR API Key Expiry Warning

Hi ${firstName},

Your VALR API key (${keyLabel}) expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} on ${expiryStr}.

Automated trading will be paused if you do not renew before this date.

Steps to renew:
1. Log in to VALR → Account → API Keys → Create New API Key
2. Name: "BitWealth Trade"
3. Permissions: View, Trade, Withdraw, Link Bank Account
4. Whitelist BTC: 38ppcqBCz58KENxP9Hi79oCrVFuPTHSdTP
   Whitelist USDT (TRC-20): TSivCwsgBRXBT2A4nF6zRJcMMSX2FeNrfP
5. Save key + secret → go to ${portalUrl} → Settings → Update API Key

Best regards,
The BitWealth Team
  `.trim();

  return { html, text };
}

// ─── API Key Expiry Critical (day 0 — trading paused) ────────────────────────
export function getApiKeyExpiryCriticalEmail(
  firstName: string,
  keyLabel: string,
  portalUrl: string
): { html: string; text: string } {
  const html = `
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Aptos','Segoe UI','Helvetica Neue',Arial,sans-serif;background-color:#f4f4f4;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:linear-gradient(135deg,#7f1d1d 0%,#dc3545 100%);color:white;padding:40px;text-align:center;border-radius:10px 10px 0 0;">
      ${getLogoHeader()}
      <div style="font-size:48px;margin:20px 0 10px 0;">🚨</div>
      <h1 style="margin:0;font-size:26px;">Trading Paused — API Key Expired</h1>
      <p style="font-size:15px;margin-top:10px;opacity:.9;">Immediate action required to resume trading</p>
    </div>

    <div style="padding:30px;background:#ffffff;">
      <p style="font-size:16px;color:#1e3a8a;">Hi ${firstName},</p>

      <p style="color:#374151;line-height:1.6;">
        Your VALR API key (<strong>${keyLabel}</strong>) has <strong style="color:#dc3545;">expired today</strong>.
        Automated BTC trading has been <strong>temporarily paused</strong> to prevent failed orders.
      </p>

      <div style="background:#fee2e2;border-left:4px solid #dc3545;padding:16px;border-radius:4px;margin:20px 0;">
        <strong style="color:#991b1b;">⚠️ No trades will execute until you supply a valid new API key.</strong><br>
        <span style="color:#374151;font-size:.9em;">Your funds are safe — nothing has been lost. Trading resumes as soon as the new key is saved.</span>
      </div>

      <h3 style="color:#0A2E4D;">Renew your API key now (5 steps):</h3>
      <ol style="line-height:1.8;color:#374151;">
        <li>Log in to <a href="https://www.valr.com/" style="color:#3b82f6;">VALR</a> → <strong>Account → API Keys</strong></li>
        <li>Click <strong>Create New API Key</strong> — name it <code>BitWealth Trade</code></li>
        <li>Enable: <strong>View ✓ &nbsp;Trade ✓ &nbsp;Withdraw ✓ &nbsp;Link Bank Account ✓</strong></li>
        <li>Add withdrawal whitelists:<br>
          &nbsp;&nbsp;• BTC: <code>38ppcqBCz58KENxP9Hi79oCrVFuPTHSdTP</code><br>
          &nbsp;&nbsp;• USDT (TRC-20): <code>TSivCwsgBRXBT2A4nF6zRJcMMSX2FeNrfP</code>
        </li>
        <li>Copy your new Key &amp; Secret → <a href="${portalUrl}" style="color:#3b82f6;">BitWealth Portal → Settings → Update API Key</a></li>
      </ol>

      <div style="text-align:center;margin:28px 0;">
        <a href="${portalUrl}" style="background:#dc3545;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
          Renew API Key Now →
        </a>
      </div>

      <p style="color:#6b7280;font-size:.9em;">Need help? Reply to this email — our team will respond quickly.</p>

      <p style="color:#4b5563;margin-top:30px;">
        Best regards,<br><strong>The BitWealth Team</strong>
      </p>
    </div>

    <div style="background:#f9fafb;padding:20px;text-align:center;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
      <p style="margin:0 0 10px 0;">© ${new Date().getFullYear()} BitWealth. All rights reserved.</p>
      <p style="margin:0;">
        <a href="https://bitwealth.co.za" style="color:#3b82f6;text-decoration:none;">Website</a> ·
        <a href="${portalUrl}" style="color:#3b82f6;text-decoration:none;">Customer Portal</a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
🚨 Trading Paused — VALR API Key Has Expired

Hi ${firstName},

Your VALR API key (${keyLabel}) has expired. Automated trading has been paused.

Your funds are safe. Trading resumes as soon as you supply a valid new API key.

Steps to renew:
1. Log in to VALR → Account → API Keys → Create New API Key
2. Name: "BitWealth Trade"
3. Permissions: View, Trade, Withdraw, Link Bank Account
4. Whitelist BTC: 38ppcqBCz58KENxP9Hi79oCrVFuPTHSdTP
   Whitelist USDT (TRC-20): TSivCwsgBRXBT2A4nF6zRJcMMSX2FeNrfP
5. Save key + secret → go to ${portalUrl} → Settings → Update API Key

Best regards,
The BitWealth Team
  `.trim();

  return { html, text };
}
