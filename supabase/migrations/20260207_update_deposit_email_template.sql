-- Migration: Update deposit_instructions email template with crypto wallet options
-- Date: 2026-02-07
-- Purpose: Add BTC and USDT wallet addresses to deposit email template

UPDATE public.email_templates
SET body_html = '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="margin: 0; padding: 0; font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; background-color: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb;">
    <tr>
      <td align="center" style="padding: 20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border: 1px solid #e5e7eb;">
          <!-- Header -->
          <tr>
            <td style="background-color: #1e3a8a; padding: 30px; text-align: center;">
              <div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div>
              <h1 style="margin: 0; font-size: 24px; color: white; font-weight: 600;">💰 Fund Your Account</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              <p style="margin: 0 0 15px 0;">Hi {{first_name}},</p>
              
              <p style="margin: 0 0 15px 0;">Great news! Your ID has been verified and your VALR trading account is ready.</p>
              
              <p style="margin: 0 0 15px 0;"><strong>Choose your preferred deposit method below:</strong></p>
              
              <!-- ZAR Bank Transfer Section -->
              <div style="background-color: #f3f4f6; padding: 20px; border-radius: 5px; margin: 20px 0; border: 1px solid #e5e7eb;">
                <h3 style="margin: 0 0 15px 0; color: #1e3a8a; font-size: 18px;">🏦 Option 1: ZAR Bank Transfer</h3>
                
                <div style="background-color: #fee2e2; padding: 15px; border-left: 4px solid #ef4444; margin: 15px 0; border-radius: 4px;">
                  <strong style="color: #991b1b;">⚠️ CRITICAL: Use Your Unique Reference</strong><br>
                  When making a ZAR deposit, you MUST use the reference below.
                </div>
                
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
                      <span style="font-weight: bold; color: #4b5563;">YOUR REFERENCE:</span> <span style="font-size: 1.2em; color: #ef4444; font-weight: bold;">{{deposit_ref}}</span>
                    </td>
                  </tr>
                </table>
              </div>
              
              <hr style="border: 0; border-top: 2px solid #e5e7eb; margin: 30px 0;">
              
              <!-- Crypto Deposit Options -->
              <div style="background-color: #f0f9ff; padding: 20px; border-radius: 5px; margin: 20px 0; border: 1px solid #bae6fd;">
                <h3 style="margin: 0 0 15px 0; color: #1e3a8a; font-size: 18px;">💎 Option 2: Cryptocurrency Deposits</h3>
                
                <p style="margin: 0 0 15px 0; font-size: 14px; color: #1e40af;">If you already own cryptocurrency, you can deposit directly:</p>
                
                <!-- BTC Wallet -->
                <div style="background-color: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; border-radius: 4px;">
                  <strong style="color: #92400e; font-size: 15px;">🟠 Bitcoin (BTC)</strong><br>
                  <div style="margin: 10px 0; padding: 8px; background-color: #fffbeb; border-radius: 3px;">
                    <span style="font-family: ''Courier New'', monospace; font-size: 11px; color: #78350f; word-break: break-all;">{{btc_wallet_address}}</span>
                  </div>
                  <span style="font-size: 12px; color: #92400e;">⚠️ <strong>WARNING:</strong> Only send Bitcoin (BTC) to this address. Sending other cryptocurrencies will result in permanent loss of funds.</span>
                </div>
                
                <!-- USDT Wallet -->
                <div style="background-color: #d1fae5; padding: 15px; border-left: 4px solid #10b981; margin: 15px 0; border-radius: 4px;">
                  <strong style="color: #065f46; font-size: 15px;">🟢 Tether (USDT-TRC20)</strong><br>
                  <div style="margin: 10px 0; padding: 8px; background-color: #ecfdf5; border-radius: 3px;">
                    <span style="font-family: ''Courier New'', monospace; font-size: 11px; color: #064e3b; word-break: break-all;">{{usdt_wallet_address}}</span>
                  </div>
                  <div style="background-color: #065f46; color: white; padding: 8px; border-radius: 3px; margin: 8px 0;">
                    <strong style="font-size: 13px;">✅ Network: TRON (TRC20)</strong>
                  </div>
                  <span style="font-size: 12px; color: #065f46;">⚠️ <strong>CRITICAL:</strong> You MUST select <strong>TRON (TRC20)</strong> network when sending. Do NOT use Ethereum (ERC20) or other networks. TRON offers the lowest transaction fees.</span>
                </div>
              </div>
              
              <!-- Deposit Method Guide -->
              <div style="background-color: #eff6ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #3b82f6;">
                <strong style="color: #1e40af; font-size: 14px;">💡 Which deposit method should I choose?</strong>
                <ul style="font-size: 13px; color: #1e3a8a; margin: 8px 0 0 0; padding-left: 20px;">
                  <li style="margin-bottom: 6px;"><strong>ZAR Bank Transfer:</strong> Best for South African customers with rands (1-2 business days)</li>
                  <li style="margin-bottom: 6px;"><strong>Bitcoin (BTC):</strong> If you already own Bitcoin (faster, but higher network fees)</li>
                  <li style="margin-bottom: 6px;"><strong>USDT (TRON):</strong> Fastest and cheapest for crypto deposits (~1-3 minutes, fees &lt;$1) <strong style="color: #10b981;">← RECOMMENDED</strong></li>
                </ul>
              </div>
              
              <p style="margin: 20px 0 10px 0;"><strong>What happens next?</strong></p>
              <ol style="font-size: 14px; color: #4b5563; margin: 0 0 20px 0; padding-left: 20px;">
                <li style="margin-bottom: 8px;">Make your deposit using ONE of the methods above</li>
                <li style="margin-bottom: 8px;">Your funds will be credited within minutes (crypto) or 1-2 business days (ZAR)</li>
                <li style="margin-bottom: 8px;">We''ll notify you once your account is active and trading begins</li>
                <li style="margin-bottom: 8px;">You can log in to your portal to track your balance and transactions</li>
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
              <p style="margin: 0;">© 2026 BitWealth. All rights reserved.</p>
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

-- Verify update
DO $$
DECLARE
  template_html TEXT;
BEGIN
  SELECT body_html INTO template_html 
  FROM public.email_templates 
  WHERE template_key = 'deposit_instructions';
  
  IF template_html NOT LIKE '%btc_wallet_address%' OR template_html NOT LIKE '%usdt_wallet_address%' THEN
    RAISE EXCEPTION 'Migration failed: Email template not updated with crypto wallet placeholders';
  END IF;
  
  RAISE NOTICE 'Migration successful: deposit_instructions email template updated with crypto options';
END $$;
