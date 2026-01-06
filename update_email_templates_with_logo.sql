-- Update all email templates to include BitWealth logo
-- Logo will be base64 encoded for maximum email client compatibility

-- Note: The logo image needs to be converted to base64 first
-- For now, using a hosted URL approach (logo should be uploaded to website/images/)

-- prospect_confirmation
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1 style="color: #F39C12; margin: 0; font-size: 28px; font-weight: bold;">BitWealth</h1>',
  '<img src="https://bitwealth.co.za/images/logo-white.png" alt="BitWealth" style="max-width: 200px; height: auto; margin-bottom: 10px;" />'
)
WHERE template_key = 'prospect_confirmation';

-- For templates with different header structures, we'll need to update each one
-- Let me create a more comprehensive update script

