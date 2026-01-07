-- Fix email templates to use solid color headers that work in Outlook
-- Problem: CSS gradients are stripped by Outlook
-- Solution: Use solid #1e3a8a background with table-based layout

-- 1. Fix kyc_portal_registration template
UPDATE public.email_templates
SET body_html = E'<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="margin: 0; padding: 0; font-family: \'Aptos\', \'Segoe UI\', \'Helvetica Neue\', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb;">
    <tr>
      <td align="center" style="padding: 20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border: 1px solid #e5e7eb;">
          <!-- Header -->
          <tr>
            <td style="background-color: #1e3a8a; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <div style="font-family: \'Aptos\', \'Segoe UI\', \'Helvetica Neue\', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div>
              <h1 style="margin: 0; font-size: 24px; color: white; font-weight: 600;">📋 KYC Registration</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 15px 0;">Hi {{first_name}},</p>
              
              <p style="margin: 0 0 15px 0;">Great news! We\'ve confirmed your interest in our <strong>{{strategy_name}}</strong> strategy.</p>
              
              <p style="margin: 0 0 15px 0;">The next step is to create your secure portal account where you\'ll be able to:</p>
              <ul style="margin: 0 0 15px 0; padding-left: 20px;">
                <li style="margin-bottom: 8px;">Upload your ID for verification (required for legal compliance)</li>
                <li style="margin-bottom: 8px;">Track your portfolio performance in real-time</li>
                <li style="margin-bottom: 8px;">View all transactions and statements</li>
                <li style="margin-bottom: 8px;">Manage your account settings</li>
              </ul>
              
              <div style="background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 4px;">
                <strong style="color: #92400e;">⚠️ Important:</strong> After registering, you\'ll be asked to upload a copy of your ID (passport or identity card). This is required for KYC (Know Your Customer) compliance.
              </div>
              
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="{{registration_url}}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600;">Create Your Account →</a>
                  </td>
                </tr>
              </table>
              
              <p style="font-size: 12px; color: #6b7280; margin: 0 0 15px 0;">This registration link is unique to your email address. If you have any issues accessing it, please reply to this email.</p>
              
              <p style="margin: 0 0 15px 0;">Once your ID is verified (usually within 24 hours), we\'ll send you the banking details to deposit your initial investment.</p>
              
              <p style="margin: 0 0 15px 0;">Questions? Just reply to this email - we\'re here to help!</p>
              
              <p style="margin: 20px 0 0 0;">Best regards,<br>
              <strong>The BitWealth Team</strong><br>
              <a href="{{website_url}}" style="color: #3b82f6; text-decoration: none;">{{website_url}}</a></p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="text-align: center; color: #6b7280; font-size: 12px; padding: 20px; background-color: #f9fafb;">
              <p style="margin: 0 0 5px 0;">© 2025 BitWealth. All rights reserved.</p>
              <p style="margin: 0;">You received this email because you expressed interest in our Bitcoin DCA services.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>'
WHERE template_key = 'kyc_portal_registration';

-- 2. Fix deposit_instructions template (already attempted but ensure table-based with solid color)
UPDATE public.email_templates
SET body_html = E'<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="margin: 0; padding: 0; font-family: \'Aptos\', \'Segoe UI\', \'Helvetica Neue\', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb;">
    <tr>
      <td align="center" style="padding: 20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border: 1px solid #e5e7eb;">
          <!-- Header -->
          <tr>
            <td style="background-color: #1e3a8a; padding: 30px; text-align: center;">
              <div style="font-family: \'Aptos\', \'Segoe UI\', \'Helvetica Neue\', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div>
              <h1 style="margin: 0; font-size: 24px; color: white; font-weight: 600;">💰 Fund Your Account</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 15px 0;">Hi {{first_name}},</p>
              
              <p style="margin: 0 0 15px 0;">Great news! Your ID has been verified and your VALR trading account is ready.</p>
              
              <div style="background-color: #fee2e2; padding: 15px; border-left: 4px solid #ef4444; margin: 20px 0; border-radius: 4px;">
                <strong style="color: #991b1b;">⚠️ CRITICAL: Use Your Unique Reference</strong><br>
                When making your deposit, you MUST use the reference below. This ensures your funds are credited to your account correctly.
              </div>
              
              <div style="background-color: #f3f4f6; padding: 20px; border-radius: 5px; margin: 20px 0; border: 1px solid #e5e7eb;">
                <h3 style="margin: 0 0 15px 0; color: #1e3a8a; font-size: 18px;">🏦 VALR Banking Details</h3>
                <table width="100%" cellpadding="4" cellspacing="0" border="0">
                  <tr>
                    <td style="font-weight: bold; color: #4b5563; padding: 4px 0;">Recipient:</td>
                    <td style="color: #1f2937; padding: 4px 0;">VALR</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold; color: #4b5563; padding: 4px 0;">Bank:</td>
                    <td style="color: #1f2937; padding: 4px 0;">Standard Bank</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold; color: #4b5563; padding: 4px 0;">Account Number:</td>
                    <td style="color: #1f2937; padding: 4px 0;">001624849</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold; color: #4b5563; padding: 4px 0;">Branch Code:</td>
                    <td style="color: #1f2937; padding: 4px 0;">051001</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold; color: #4b5563; padding: 4px 0;">Account Type:</td>
                    <td style="color: #1f2937; padding: 4px 0;">Current/Cheque</td>
                  </tr>
                  <tr>
                    <td style="font-weight: bold; color: #4b5563; padding: 4px 0;">SWIFT Code:</td>
                    <td style="color: #1f2937; padding: 4px 0;">SBZAZAJJXXX</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding-top: 15px; border-top: 2px solid #3b82f6;">
                      <span style="font-weight: bold; color: #4b5563;">YOUR REFERENCE:</span> <span style="font-size: 1.2em; color: #ef4444; font-weight: bold;">{{deposit_reference}}</span>
                    </td>
                  </tr>
                </table>
              </div>
              
              <p style="margin: 20px 0 10px 0;"><strong>What happens next?</strong></p>
              <ol style="font-size: 14px; color: #4b5563; margin: 0 0 20px 0; padding-left: 20px;">
                <li style="margin-bottom: 8px;">Make your deposit using the banking details above</li>
                <li style="margin-bottom: 8px;">Use your unique reference number</li>
                <li style="margin-bottom: 8px;">Your funds will be credited within 1-2 business days</li>
                <li style="margin-bottom: 8px;">We\'ll notify you once your account is active and trading begins</li>
              </ol>
              
              <p style="margin: 30px 0 10px 0;">Best regards,<br><strong>The BitWealth Team</strong></p>
              
              <p style="font-size: 12px; color: #6b7280; margin: 30px 0 0 0;">
                Questions? Visit <a href="{{website_url}}" style="color: #3b82f6; text-decoration: none;">{{website_url}}</a> or reply to this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="text-align: center; color: #6b7280; font-size: 12px; padding: 20px; background-color: #f9fafb;">
              <p style="margin: 0;">© 2025 BitWealth. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>'
WHERE template_key = 'deposit_instructions';
