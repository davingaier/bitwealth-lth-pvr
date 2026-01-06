# Adding BitWealth Logo to Email Templates

## Step 1: Save the Logo

1. From the 3 logo variations provided:
   - ✅ **USE: logo-white.png** (white logo for dark blue headers)
   - ❌ Skip: logo-transparent.png (harder to see on light backgrounds in email clients)
   - ❌ Skip: logo-dark-blue.png (won't show on dark blue headers)

2. Save `logo-white.png` to your Desktop

## Step 2: Convert Logo to Base64

Run this PowerShell command:

```powershell
# Convert logo to base64
$logoPath = "$env:USERPROFILE\Desktop\logo-white.png"
$bytes = [System.IO.File]::ReadAllBytes($logoPath)
$base64 = [Convert]::ToBase64String($bytes)

# Save to file
Set-Content "logo-white-base64.txt" $base64

# Copy to clipboard (optional)
Set-Clipboard $base64

Write-Host "✓ Logo converted! Base64 saved to logo-white-base64.txt and copied to clipboard"
Write-Host "Base64 length: $($base64.Length) characters"
```

## Step 3: Update Email Templates

### Option A: Using Base64 (RECOMMENDED - Most Reliable)

**Pros:**
- ✅ Works even if recipient blocks external images
- ✅ Logo always displays
- ✅ No external dependencies

**Cons:**
- ❌ Increases email size by ~30-50KB
- ❌ May trigger spam filters if logo is very large

**SQL Update Script:**

```sql
-- IMPORTANT: Replace PASTE_BASE64_HERE with the actual base64 string from logo-white-base64.txt

-- prospect_confirmation
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1 style="color: #F39C12; margin: 0; font-size: 28px; font-weight: bold;">BitWealth</h1>',
  '<img src="data:image/png;base64,PASTE_BASE64_HERE" alt="BitWealth" style="max-width: 220px; height: auto; margin-bottom: 10px;" />'
)
WHERE template_key = 'prospect_confirmation';

-- prospect_notification
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>BitWealth</h1>',
  '<img src="data:image/png;base64,PASTE_BASE64_HERE" alt="BitWealth" style="max-width: 200px; height: auto; margin-bottom: 10px;" /><h1 style="margin: 5px 0 0; font-size: 20px;">BitWealth</h1>'
)
WHERE template_key = 'prospect_notification';

-- kyc_portal_registration
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>🎉 Welcome to BitWealth!</h1>',
  '<img src="data:image/png;base64,PASTE_BASE64_HERE" alt="BitWealth" style="max-width: 220px; height: auto; margin-bottom: 15px;" /><h1 style="margin: 0; font-size: 28px;">🎉 Welcome to BitWealth!</h1>'
)
WHERE template_key = 'kyc_portal_registration';

-- kyc_id_uploaded_notification
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>📄 New ID Document Uploaded</h1>',
  '<img src="data:image/png;base64,PASTE_BASE64_HERE" alt="BitWealth" style="max-width: 200px; height: auto; margin-bottom: 10px;" /><h1 style="margin: 0; font-size: 24px;">📄 New ID Document Uploaded</h1>'
)
WHERE template_key = 'kyc_id_uploaded_notification';

-- deposit_instructions
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>💰 Fund Your Account</h1>',
  '<img src="data:image/png;base64,PASTE_BASE64_HERE" alt="BitWealth" style="max-width: 220px; height: auto; margin-bottom: 15px;" /><h1 style="margin: 0; font-size: 28px;">💰 Fund Your Account</h1>'
)
WHERE template_key = 'deposit_instructions';

-- funds_deposited_admin_notification
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>💰 Funds Deposited!</h1>',
  '<img src="data:image/png;base64,PASTE_BASE64_HERE" alt="BitWealth" style="max-width: 200px; height: auto; margin-bottom: 10px;" /><h1 style="margin: 0; font-size: 24px;">💰 Funds Deposited!</h1>'
)
WHERE template_key = 'funds_deposited_admin_notification';

-- registration_complete_welcome
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<div class="emoji">🎉</div>
      <h1>Welcome to BitWealth!</h1>',
  '<img src="data:image/png;base64,PASTE_BASE64_HERE" alt="BitWealth" style="max-width: 240px; height: auto; margin-bottom: 20px;" />
      <div style="font-size: 48px; margin-bottom: 10px;">🎉</div>
      <h1 style="margin: 0; font-size: 32px;">Welcome to BitWealth!</h1>'
)
WHERE template_key = 'registration_complete_welcome';
```

### Option B: Using Website Hosting (Smaller Email Size)

**Pros:**
- ✅ Much smaller email size
- ✅ Easier to update logo (just replace file on server)
- ✅ Less likely to trigger spam filters

**Cons:**
- ❌ Requires logo to be publicly accessible
- ❌ Won't display if recipient blocks external images
- ❌ Depends on website availability

**Steps:**
1. Upload `logo-white.png` to your website server at: `https://bitwealth.co.za/images/logo-white.png`
2. Verify it's accessible by opening URL in browser
3. Run the SQL script below:

```sql
-- prospect_confirmation
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1 style="color: #F39C12; margin: 0; font-size: 28px; font-weight: bold;">BitWealth</h1>',
  '<img src="https://bitwealth.co.za/images/logo-white.png" alt="BitWealth" style="max-width: 220px; height: auto; margin-bottom: 10px;" />'
)
WHERE template_key = 'prospect_confirmation';

-- prospect_notification
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>BitWealth</h1>',
  '<img src="https://bitwealth.co.za/images/logo-white.png" alt="BitWealth" style="max-width: 200px; height: auto; margin-bottom: 10px;" /><h1 style="margin: 5px 0 0; font-size: 20px;">BitWealth</h1>'
)
WHERE template_key = 'prospect_notification';

-- kyc_portal_registration
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>🎉 Welcome to BitWealth!</h1>',
  '<img src="https://bitwealth.co.za/images/logo-white.png" alt="BitWealth" style="max-width: 220px; height: auto; margin-bottom: 15px;" /><h1 style="margin: 0; font-size: 28px;">🎉 Welcome to BitWealth!</h1>'
)
WHERE template_key = 'kyc_portal_registration';

-- kyc_id_uploaded_notification
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>📄 New ID Document Uploaded</h1>',
  '<img src="https://bitwealth.co.za/images/logo-white.png" alt="BitWealth" style="max-width: 200px; height: auto; margin-bottom: 10px;" /><h1 style="margin: 0; font-size: 24px;">📄 New ID Document Uploaded</h1>'
)
WHERE template_key = 'kyc_id_uploaded_notification';

-- deposit_instructions
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>💰 Fund Your Account</h1>',
  '<img src="https://bitwealth.co.za/images/logo-white.png" alt="BitWealth" style="max-width: 220px; height: auto; margin-bottom: 15px;" /><h1 style="margin: 0; font-size: 28px;">💰 Fund Your Account</h1>'
)
WHERE template_key = 'deposit_instructions';

-- funds_deposited_admin_notification
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<h1>💰 Funds Deposited!</h1>',
  '<img src="https://bitwealth.co.za/images/logo-white.png" alt="BitWealth" style="max-width: 200px; height: auto; margin-bottom: 10px;" /><h1 style="margin: 0; font-size: 24px;">💰 Funds Deposited!</h1>'
)
WHERE template_key = 'funds_deposited_admin_notification';

-- registration_complete_welcome
UPDATE email_templates
SET body_html = REPLACE(
  body_html,
  '<div class="emoji">🎉</div>
      <h1>Welcome to BitWealth!</h1>',
  '<img src="https://bitwealth.co.za/images/logo-white.png" alt="BitWealth" style="max-width: 240px; height: auto; margin-bottom: 20px;" />
      <div style="font-size: 48px; margin-bottom: 10px;">🎉</div>
      <h1 style="margin: 0; font-size: 32px;">Welcome to BitWealth!</h1>'
)
WHERE template_key = 'registration_complete_welcome';
```

## Step 4: Preview Templates

Open `email-templates-preview.html` in your browser to see all 7 templates with logos.

```powershell
# Open preview in default browser
Start-Process "email-templates-preview.html"
```

## Step 5: Test Email Sending

Send a test email to yourself:

```powershell
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_send_email `
  -H "Authorization: Bearer [anon_key]" `
  -H "Content-Type: application/json" `
  -d '{
    "template_key": "prospect_confirmation",
    "to_email": "your.email@example.com",
    "data": {
      "first_name": "John",
      "website_url": "https://bitwealth.co.za"
    }
  }'
```

Check your inbox and verify:
- [ ] Logo displays correctly
- [ ] Logo size is appropriate (not too large/small)
- [ ] Email doesn't go to spam
- [ ] Mobile responsive (check on phone)

## Step 6: Update Remaining Templates (Optional)

The 7 main onboarding templates are now updated. If you want to add the logo to the remaining 10 templates (monthly_statement, support_request, etc.), follow the same pattern:

1. Find the `<h1>` or header element
2. Replace with `<img src="..." />` followed by the heading
3. Test the template

---

## Recommendation

**Use Option A (Base64)** for maximum reliability. Email size increase is acceptable (~40KB for a logo), and it ensures the logo always displays even if the recipient blocks external images.

If your logo file is very large (>100KB), consider:
1. Resizing to 400px width max
2. Optimizing with TinyPNG or similar tool
3. Using website hosting (Option B) instead

---

## Files Created

- `email-templates-preview.html` - Preview all templates in browser
- `logo-white-base64.txt` - Base64 encoded logo (after running Step 2)
- `ADD_LOGO_TO_EMAILS.md` - This file

---

**Questions?** The AI agent is ready to help with any issues!
