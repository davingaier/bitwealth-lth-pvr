-- Update all email templates with text-only headers and Aptos font
-- Changes:
-- 1. Replace logo images with professional text-only headers
-- 2. Update all fonts to Aptos with fallbacks
-- 3. Update KYC Portal Registration header to "📋 KYC Registration"

-- Define the professional text header
-- This will replace all logo image tags

-- prospect_confirmation
UPDATE email_templates
SET body_html = REPLACE(
  REPLACE(
    REPLACE(
      body_html,
      '<h1 style="color: #F39C12; margin: 0; font-size: 28px; font-weight: bold;">BitWealth</h1>',
      '<div style="text-align: center;"><div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 32px; font-weight: 700; color: #F39C12; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div></div>'
    ),
    'font-family: Arial, sans-serif',
    'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
  ),
  'font-family: Arial',
  'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
)
WHERE template_key = 'prospect_confirmation';

-- prospect_notification
UPDATE email_templates
SET body_html = REPLACE(
  REPLACE(
    body_html,
    'font-family: Arial, sans-serif',
    'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
  ),
  '<h1>BitWealth</h1>',
  '<div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px;">BitWealth</div>'
)
WHERE template_key = 'prospect_notification';

-- kyc_portal_registration (with custom header)
UPDATE email_templates
SET body_html = REPLACE(
  REPLACE(
    REPLACE(
      body_html,
      '<h1>🎉 Welcome to BitWealth!</h1>',
      '<div style="text-align: center;"><div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 32px; font-weight: 700; color: #F39C12; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div></div><h1 style="margin: 0; font-size: 28px;">📋 KYC Registration</h1>'
    ),
    'font-family: Arial, sans-serif',
    'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
  ),
  'font-family: Arial',
  'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
)
WHERE template_key = 'kyc_portal_registration';

-- kyc_id_uploaded_notification
UPDATE email_templates
SET body_html = REPLACE(
  REPLACE(
    body_html,
    '<h1>📄 New ID Document Uploaded</h1>',
    '<div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div><h1 style="margin: 0; font-size: 24px;">📄 New ID Document Uploaded</h1>'
  ),
  'font-family: Arial, sans-serif',
  'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
)
WHERE template_key = 'kyc_id_uploaded_notification';

-- deposit_instructions
UPDATE email_templates
SET body_html = REPLACE(
  REPLACE(
    body_html,
    '<h1>💰 Fund Your Account</h1>',
    '<div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div><h1 style="margin: 0; font-size: 28px;">💰 Fund Your Account</h1>'
  ),
  'font-family: Arial, sans-serif',
  'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
)
WHERE template_key = 'deposit_instructions';

-- funds_deposited_admin_notification
UPDATE email_templates
SET body_html = REPLACE(
  REPLACE(
    body_html,
    '<h1>💰 Funds Deposited!</h1>',
    '<div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div><h1 style="margin: 0; font-size: 24px;">💰 Funds Deposited!</h1>'
  ),
  'font-family: Arial, sans-serif',
  'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
)
WHERE template_key = 'funds_deposited_admin_notification';

-- registration_complete_welcome
UPDATE email_templates
SET body_html = REPLACE(
  REPLACE(
    REPLACE(
      body_html,
      '<div class="emoji">🎉</div>
      <h1>Welcome to BitWealth!</h1>',
      '<div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 32px; font-weight: 700; color: white; letter-spacing: 0.5px; margin-bottom: 15px;">BitWealth</div><div style="font-size: 48px; margin-bottom: 10px;">🎉</div><h1 style="margin: 0; font-size: 32px;">Welcome to BitWealth!</h1>'
    ),
    'font-family: Arial, sans-serif',
    'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
  ),
  'font-family: Arial',
  'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
)
WHERE template_key = 'registration_complete_welcome';

-- Update remaining templates (legacy ones) with font changes only
UPDATE email_templates
SET body_html = REPLACE(
  REPLACE(
    body_html,
    'font-family: Arial, sans-serif',
    'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
  ),
  'font-family: Arial',
  'font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif'
)
WHERE template_key IN (
  'account_setup_complete',
  'kyc_request',
  'kyc_verified_notification',
  'funds_deposited_notification',
  'monthly_statement',
  'support_request_confirmation',
  'support_request_notification',
  'withdrawal_approved',
  'withdrawal_completed',
  'withdrawal_request_notification'
);

-- Verify updates
SELECT 
  template_key,
  CASE 
    WHEN body_html LIKE '%Aptos%' THEN '✓ Font updated'
    ELSE '✗ Font not updated'
  END as font_status,
  CASE 
    WHEN body_html LIKE '%<div style="font-family: ''Aptos''%BitWealth%' THEN '✓ Text header'
    WHEN body_html LIKE '%<h1>%BitWealth%' THEN '✓ Has header'
    ELSE '- No header'
  END as header_status,
  LENGTH(body_html) as size_bytes
FROM email_templates
WHERE active = true
ORDER BY template_key;
