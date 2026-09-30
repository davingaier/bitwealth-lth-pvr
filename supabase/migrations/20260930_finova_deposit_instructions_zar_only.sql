-- Finova-custody clients can only fund by ZAR EFT (no crypto deposit wallets exist in
-- their Finova subaccount). Derived from deposit_instructions with the crypto block removed.
INSERT INTO public.email_templates (template_key, name, description, subject, body_html, active)
SELECT 'deposit_instructions_zar_only',
       'Deposit Instructions (ZAR only — Finova custody)',
       'Sent automatically when Finova verifies a client''s subaccount. VALR banking details + the Finova-issued ZAR deposit reference. Placeholders: {{first_name}}, {{deposit_ref}}, {{website_url}}',
       'Fund Your BitWealth Account - Deposit Instructions',
       replace(replace(replace(replace(replace(
         regexp_replace(t.body_html,
           '<hr style="border: 0; border-top: 2px solid #e5e7eb; margin: 30px 0;">\s*<!-- Crypto Deposit Options -->.*?(<p style="margin: 20px 0 10px 0;"><strong>What happens next\?</strong></p>)',
           '\1'),
         'Choose your preferred deposit method below:', 'Please fund your account by ZAR bank transfer using the details below:'),
         'Option 1: ZAR Bank Transfer', 'ZAR Bank Transfer'),
         'Make your deposit using ONE of the methods above', 'Make your ZAR deposit using the banking details and your unique reference above'),
         'within minutes (crypto) or 1-2 business days (ZAR)', 'within 1-2 business days'),
         'your VALR trading account is ready', 'your VALR account is ready'),
       true
FROM public.email_templates t
WHERE t.template_key = 'deposit_instructions'
  AND NOT EXISTS (SELECT 1 FROM public.email_templates WHERE template_key = 'deposit_instructions_zar_only');
