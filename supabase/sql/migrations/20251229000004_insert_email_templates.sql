-- Migration: Email Templates with Initial Data
-- Created: 2025-12-29
-- Purpose: Insert initial email templates for customer portal communications

-- Insert email templates with HTML bodies
INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active) VALUES

-- 1. Prospect Notification (to admin)
('prospect_notification', 'Prospect Notification (Admin)', 'Alert admin when new prospect submits interest form', 
'New Prospect: {{first_name}} {{surname}}', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">New Prospect Alert</h2>
<p>Hi Davin,</p>
<p>A new prospect has expressed interest in BitWealth:</p>
<table style="border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;font-weight:bold;">Name:</td><td style="padding:8px;">{{first_name}} {{surname}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Email:</td><td style="padding:8px;">{{email}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Phone:</td><td style="padding:8px;">{{phone_country_code}} {{phone_number}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Country:</td><td style="padding:8px;">{{country}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Upfront Amount:</td><td style="padding:8px;">{{upfront_amount_range}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Monthly Amount:</td><td style="padding:8px;">{{monthly_amount_range}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Message:</td><td style="padding:8px;">{{message}}</td></tr>
</table>
<p><a href="{{admin_portal_url}}" style="background:#F39C12;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">View in Admin Portal</a></p>
<p style="color:#95a5a6;margin-top:30px;">- BitWealth System</p>
</body>
</html>', true),

-- 2. Prospect Confirmation (to prospect)
('prospect_confirmation', 'Prospect Confirmation', 'Thank you email to prospect after submitting interest form', 
'Thank you for your interest in BitWealth', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">Welcome to BitWealth!</h2>
<p>Hi {{first_name}},</p>
<p>Thank you for expressing interest in our <strong>Advanced Bitcoin DCA investment strategy</strong>!</p>
<p>We''ve received your information and will be in touch within <strong>24 hours</strong> to discuss your investment goals.</p>
<p>In the meantime, feel free to learn more about our strategy at: <a href="{{website_url}}">{{website_url}}</a></p>
<p style="margin-top:30px;">Best regards,<br>The BitWealth Team<br><a href="mailto:support@bitwealth.co.za">support@bitwealth.co.za</a></p>
</body>
</html>', true),

-- 3. KYC Request (to customer)
('kyc_request', 'KYC Request', 'Request customer to submit KYC documents', 
'Next Steps: KYC Verification Required', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">Next Steps: KYC Verification</h2>
<p>Hi {{first_name}},</p>
<p><strong>Great news!</strong> We''re ready to proceed with setting up your BitWealth account.</p>
<p>To comply with regulations, we need you to:</p>
<ol style="line-height:1.8;">
<li>Reply to this email with a clear copy of your <strong>ID (passport or ID card)</strong></li>
<li>Complete your account registration and accept the Investment Disclaimer online</li>
</ol>
<p><em>Optional:</em> You may download and keep a signed copy of the Investment Disclaimer for your records (attached).</p>
<p>Once we receive your ID and verify your identity, we''ll send you a <strong>registration link</strong> to complete your account setup within <strong>1 business day</strong>.</p>
<p style="margin-top:30px;">Best regards,<br>The BitWealth Team<br><a href="mailto:support@bitwealth.co.za">support@bitwealth.co.za</a></p>
</body>
</html>', true),

-- 4. KYC Verified Notification (to admin)
('kyc_verified_notification', 'KYC Verified Notification (Admin)', 'Alert admin when KYC documents received', 
'KYC Documents Received: {{customer_name}}', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">KYC Documents Received</h2>
<p>Hi Davin,</p>
<p><strong>{{first_name}} {{surname}}</strong> has submitted their KYC documents.</p>
<p>Please verify the ID and update their status in the Admin Portal.</p>
<table style="border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;font-weight:bold;">Customer Email:</td><td style="padding:8px;">{{email}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Phone:</td><td style="padding:8px;">{{phone_country_code}} {{phone_number}}</td></tr>
</table>
<p><a href="{{admin_portal_url}}" style="background:#F39C12;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">View Documents in Admin Portal</a></p>
<p style="color:#95a5a6;margin-top:30px;">- BitWealth System</p>
</body>
</html>', true),

-- 5. Account Setup Complete (to customer)
('account_setup_complete', 'Account Setup Complete', 'Notify customer account is ready and provide deposit details', 
'Your BitWealth Account is Ready!', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">Your Account is Ready!</h2>
<p>Hi {{first_name}},</p>
<p>Your BitWealth account has been set up successfully! 🎉</p>
<h3>Next Step: Deposit Your Funds</h3>
<table style="background:#f8f9fa;border:2px solid #F39C12;padding:20px;margin:20px 0;border-radius:8px;">
<tr><td style="padding:8px;font-weight:bold;">Bank:</td><td style="padding:8px;">{{bank_name}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Account Number:</td><td style="padding:8px;">{{account_number}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Account Holder:</td><td style="padding:8px;">{{account_holder}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;color:#e74c3c;">Reference:</td><td style="padding:8px;font-weight:bold;color:#e74c3c;">{{deposit_reference}}</td></tr>
</table>
<p style="background:#ffe5e5;border-left:4px solid #e74c3c;padding:15px;"><strong>IMPORTANT:</strong> Please use the reference code <strong>{{deposit_reference}}</strong> when making your deposit.</p>
<p>Amount: <strong>{{investment_amount}}</strong> (or your preferred amount)</p>
<p>Once your funds are received, we''ll convert them to USDT and your strategy will begin trading within <strong>24 hours</strong>.</p>
<h3>Access Your Customer Portal</h3>
<p><a href="{{portal_url}}" style="background:#F39C12;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">Log In to Portal</a></p>
<p>Username: <strong>{{email}}</strong><br>Password: (set during registration)</p>
<p style="margin-top:30px;">Best regards,<br>The BitWealth Team<br><a href="mailto:support@bitwealth.co.za">support@bitwealth.co.za</a></p>
</body>
</html>', true),

-- 6. Funds Deposited Notification (to admin)
('funds_deposited_notification', 'Funds Deposited Notification (Admin)', 'Alert admin when customer deposits funds', 
'Funds Deposited: {{customer_name}}', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">Funds Deposited</h2>
<p>Hi Davin,</p>
<p><strong>{{first_name}} {{surname}}</strong> has deposited funds into their VALR subaccount.</p>
<table style="border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;font-weight:bold;">Amount:</td><td style="padding:8px;">R {{amount_zar}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Customer:</td><td style="padding:8px;">{{email}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Deposit Reference:</td><td style="padding:8px;">{{deposit_reference}}</td></tr>
</table>
<p><strong>Action Required:</strong> Convert ZAR to USDT and update customer status to "active".</p>
<p><a href="{{admin_portal_url}}" style="background:#F39C12;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">View in Admin Portal</a></p>
<p style="color:#95a5a6;margin-top:30px;">- BitWealth System</p>
</body>
</html>', true),

-- 7. Withdrawal Request Notification (to admin)
('withdrawal_request_notification', 'Withdrawal Request Notification (Admin)', 'Alert admin when customer requests withdrawal', 
'Withdrawal Request: {{customer_name}}', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">Withdrawal Request</h2>
<p>Hi Davin,</p>
<p><strong>{{first_name}} {{surname}}</strong> has requested a withdrawal.</p>
<table style="border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;font-weight:bold;">Amount:</td><td style="padding:8px;">{{amount_usdt}} USDT (~R {{amount_zar}})</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Customer:</td><td style="padding:8px;">{{email}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Requested:</td><td style="padding:8px;">{{requested_at}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Bank Details:</td><td style="padding:8px;">{{bank_name}} - {{account_number}}</td></tr>
</table>
<p><a href="{{admin_portal_url}}" style="background:#F39C12;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">Review in Admin Portal</a></p>
<p style="color:#95a5a6;margin-top:30px;">- BitWealth System</p>
</body>
</html>', true),

-- 8. Withdrawal Approved (to customer)
('withdrawal_approved', 'Withdrawal Approved', 'Notify customer withdrawal is approved', 
'Withdrawal Approved', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#27ae60;">Withdrawal Approved ✓</h2>
<p>Hi {{first_name}},</p>
<p>Your withdrawal request has been <strong>approved</strong>!</p>
<table style="border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;font-weight:bold;">Amount:</td><td style="padding:8px;">{{amount_usdt}} USDT (~R {{amount_zar}})</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Processing:</td><td style="padding:8px;">Funds will be transferred within <strong>2 business days</strong></td></tr>
<tr><td style="padding:8px;font-weight:bold;">Bank:</td><td style="padding:8px;">{{bank_name}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Account:</td><td style="padding:8px;">{{account_number}}</td></tr>
</table>
<p>You''ll receive a confirmation email once the transfer is complete.</p>
<p style="margin-top:30px;">Best regards,<br>The BitWealth Team<br><a href="mailto:support@bitwealth.co.za">support@bitwealth.co.za</a></p>
</body>
</html>', true),

-- 9. Withdrawal Completed (to customer)
('withdrawal_completed', 'Withdrawal Completed', 'Notify customer withdrawal is complete', 
'Withdrawal Complete', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#27ae60;">Withdrawal Complete ✓</h2>
<p>Hi {{first_name}},</p>
<p>Your withdrawal has been processed successfully!</p>
<table style="border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;font-weight:bold;">Amount:</td><td style="padding:8px;">R {{amount_zar}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Bank:</td><td style="padding:8px;">{{bank_name}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Account:</td><td style="padding:8px;">{{account_number}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Completed:</td><td style="padding:8px;">{{completed_at}}</td></tr>
</table>
<p>Please allow <strong>1-2 business days</strong> for the funds to reflect in your account.</p>
<p style="margin-top:30px;">Best regards,<br>The BitWealth Team<br><a href="mailto:support@bitwealth.co.za">support@bitwealth.co.za</a></p>
</body>
</html>', true),

-- 10. Support Request Notification (to admin)
('support_request_notification', 'Support Request Notification (Admin)', 'Alert admin of new support request', 
'Support Request: {{subject}}', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">New Support Request</h2>
<p>Hi Davin,</p>
<p><strong>{{customer_name}}</strong> has submitted a support request.</p>
<table style="border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;font-weight:bold;">Subject:</td><td style="padding:8px;">{{subject}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Message:</td><td style="padding:8px;">{{message}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Customer:</td><td style="padding:8px;">{{email}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Submitted:</td><td style="padding:8px;">{{created_at}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Priority:</td><td style="padding:8px;">{{priority}}</td></tr>
</table>
<p>Reply to: <a href="mailto:{{email}}">{{email}}</a></p>
<p><a href="{{admin_portal_url}}" style="background:#F39C12;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">View in Admin Portal</a></p>
<p style="color:#95a5a6;margin-top:30px;">- BitWealth System</p>
</body>
</html>', true),

-- 11. Support Request Confirmation (to customer)
('support_request_confirmation', 'Support Request Confirmation', 'Confirm receipt of customer support request', 
'Support Request Received', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">Support Request Received</h2>
<p>Hi {{first_name}},</p>
<p>We''ve received your support request and will respond within <strong>24 hours</strong>.</p>
<table style="border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;font-weight:bold;">Subject:</td><td style="padding:8px;">{{subject}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Reference:</td><td style="padding:8px;">{{request_id}}</td></tr>
</table>
<p>For urgent matters, please reply to this email.</p>
<p style="margin-top:30px;">Best regards,<br>The BitWealth Team<br><a href="mailto:support@bitwealth.co.za">support@bitwealth.co.za</a></p>
</body>
</html>', true),

-- 12. Monthly Statement (to customer)
('monthly_statement', 'Monthly Statement', 'Send monthly performance statement to customer', 
'Your BitWealth Monthly Statement - {{month}} {{year}}', 
'<html>
<head><style>body{font-family:Arial,sans-serif;color:#2C3E50;}</style></head>
<body>
<h2 style="color:#F39C12;">Monthly Statement - {{month}} {{year}}</h2>
<p>Hi {{first_name}},</p>
<p>Your monthly statement for <strong>{{month}} {{year}}</strong> is attached.</p>
<h3>Performance Summary</h3>
<table style="border-collapse:collapse;margin:20px 0;width:100%;">
<tr><td style="padding:8px;font-weight:bold;">Opening Balance:</td><td style="padding:8px;text-align:right;">R {{opening_nav}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Closing Balance:</td><td style="padding:8px;text-align:right;">R {{closing_nav}}</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Monthly Return:</td><td style="padding:8px;text-align:right;color:#27ae60;">{{monthly_return}}%</td></tr>
<tr><td style="padding:8px;font-weight:bold;">Total Return:</td><td style="padding:8px;text-align:right;color:#27ae60;">{{total_return}}%</td></tr>
</table>
<p>View full details in the attached PDF or log in to your portal:</p>
<p><a href="{{portal_url}}" style="background:#F39C12;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">View Portal</a></p>
<p style="margin-top:30px;">Best regards,<br>The BitWealth Team<br><a href="mailto:support@bitwealth.co.za">support@bitwealth.co.za</a></p>
</body>
</html>', true)

ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  active = EXCLUDED.active,
  updated_at = NOW();

COMMENT ON TABLE public.email_templates IS 'Updated with 12 initial customer portal email templates';
