-- Update deposit_instructions template with table-based layout for better email client compatibility
UPDATE public.email_templates
SET body_html = E'<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 0; }
    .header { background-color: #1e3a8a; color: white; padding: 30px; text-align: center; }
    .content { background: #ffffff; padding: 30px; }
    .footer { text-align: center; color: #6b7280; font-size: 12px; padding: 20px; background: #f9fafb; }
  </style>
</head>
<body>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb;">
    <tr>
      <td align="center" style="padding: 20px;">
        <table class="container" width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #e5e7eb;">
          <tr>
            <td class="header" style="background-color: #1e3a8a; padding: 30px; text-align: center;">
              <h1 style="font-size: 28px; font-weight: 700; color: white; margin: 0 0 8px 0;">BitWealth</h1>
              <h2 style="font-size: 24px; margin: 0; color: white;">💰 Fund Your Account</h2>
            </td>
          </tr>
          <tr>
            <td class="content" style="padding: 30px;">
              <p>Hi {{first_name}},</p>
              <p>Great news! Your ID has been verified and your VALR trading account is ready. The final step is to deposit your initial investment.</p>
              <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
                <strong>⚠️ CRITICAL: Use Your Unique Reference</strong><br>
                When making your deposit, you MUST use the reference below.
              </div>
              <div style="background: #f3f4f6; padding: 20px; margin: 20px 0; border: 1px solid #e5e7eb;">
                <h3 style="margin-top: 0; color: #1e3a8a;">🏦 VALR Banking Details</h3>
                <p><strong>Recipient:</strong> VALR</p>
                <p><strong>Bank:</strong> Standard Bank</p>
                <p><strong>Account Number:</strong> 001624849</p>
                <p><strong>Branch Code:</strong> 051001</p>
                <p><strong>Account Type:</strong> Current/Cheque</p>
                <p><strong>SWIFT Code:</strong> SBZAZAJJXXX</p>
                <p style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #3b82f6;">
                  <strong>YOUR REFERENCE:</strong> <span style="font-size: 1.2em; color: #ef4444; font-weight: bold;">{{deposit_reference}}</span>
                </p>
              </div>
              <p>Best regards,<br><strong>The BitWealth Team</strong></p>
            </td>
          </tr>
          <tr>
            <td class="footer" style="text-align: center; color: #6b7280; font-size: 12px; padding: 20px; background: #f9fafb;">
              <p>© 2025 BitWealth. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>',
updated_at = NOW()
WHERE template_key = 'deposit_instructions';
