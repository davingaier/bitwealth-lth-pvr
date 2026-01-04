# SMTP Migration Deployment Guide
**Date:** January 4, 2026  
**Status:** Ready for Deployment

---

## ✅ Changes Completed

### 1. New Files Created
- ✅ `supabase/functions/_shared/smtp.ts` - SMTP utility module
- ✅ `supabase/migrations/20260104_add_smtp_support_email_logs.sql` - Database migration
- ✅ `docs/EMAIL_SYSTEM_AUDIT_AND_SMTP_MIGRATION.md` - Complete audit document

### 2. Modified Files
- ✅ `supabase/functions/ef_send_email/index.ts` - Replaced Resend with SMTP
- ✅ `supabase/functions/ef_alert_digest/index.ts` - Replaced Resend with SMTP

### 3. Edge Functions Affected
- **Modified:** `ef_send_email`, `ef_alert_digest`
- **Indirect (use ef_send_email):** `ef_prospect_submit`, `ef_confirm_strategy`, `ef_upload_kyc_id`, `ef_approve_kyc`, `ef_deposit_scan`

---

## 🔧 Prerequisites

### SMTP Credentials Required
Before deploying, obtain the following from your email hosting provider:

```bash
SMTP_HOST=mail.bitwealth.co.za   # e.g., mail.hover.com, smtp.gmail.com
SMTP_PORT=587                             # Usually 587 for STARTTLS or 465 for SSL
SMTP_USER=admin@bitwealth.co.za           # Your SMTP username
SMTP_PASS=your_smtp_password_here         # Your SMTP password
SMTP_SECURE=false                         # false for port 587, true for port 465
```

### Test SMTP Connection First
Before deploying, test your SMTP credentials:

```powershell
# Using PowerShell (Windows)
$smtp = New-Object Net.Mail.SmtpClient("mail.bitwealth.co.za", 587)
$smtp.EnableSsl = $true
$smtp.Credentials = New-Object System.Net.NetworkCredential("admin@bitwealth.co.za", $env:SMTP_PASS)

$msg = New-Object Net.Mail.MailMessage
$msg.From = "admin@bitwealth.co.za"
$msg.To.Add("admin@bitwealth.co.za")
$msg.Subject = "SMTP Test"
$msg.Body = "This is a test email."

$smtp.Send($msg)
Write-Host "Email sent successfully!"
```

Or use telnet:
```bash
telnet mail.yourhostingprovider.com 587
EHLO bitwealth.co.za
QUIT
```

---

## 📋 Deployment Steps

### Step 1: Backup Current Configuration

```powershell
# Export current environment variables (for rollback)
$env:RESEND_API_KEY_BACKUP = $env:RESEND_API_KEY

# Or via Supabase Dashboard:
# Settings → Edge Functions → Secrets → Copy RESEND_API_KEY value
```

### Step 2: Apply Database Migration

```powershell
cd c:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr

# Apply migration
supabase db push --project-ref wqnmxpooabmedvtackji
```

Or manually via Supabase Dashboard SQL Editor:
```sql
-- Copy contents of supabase/migrations/20260104_add_smtp_support_email_logs.sql
-- Paste into SQL Editor and run
```

Verify:
```sql
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'email_logs' 
  AND table_schema = 'public'
  AND column_name IN ('smtp_message_id', 'legacy_resend_message_id');
```

### Step 3: Add SMTP Environment Variables

Via Supabase Dashboard:
1. Go to **Settings → Edge Functions → Secrets**
2. Add new secrets:
   - `SMTP_HOST` = `mail.bitwealth.co.za`
   - `SMTP_PORT` = `587`
   - `SMTP_USER` = `admin@bitwealth.co.za`
   - `SMTP_PASS` = `your_smtp_password_here`
   - `SMTP_SECURE` = `false`

3. Update existing secrets:
   - `ALERT_EMAIL_FROM` = `admin@bitwealth.co.za`
   - `ALERT_EMAIL_TO` = `admin@bitwealth.co.za`

### Step 4: Deploy Updated Edge Functions

```powershell
# Deploy ef_send_email
supabase functions deploy ef_send_email --project-ref wqnmxpooabmedvtackji --no-verify-jwt

# Deploy ef_alert_digest
supabase functions deploy ef_alert_digest --project-ref wqnmxpooabmedvtackji --no-verify-jwt
```

**Note:** Other edge functions (ef_prospect_submit, ef_confirm_strategy, etc.) do NOT need redeployment - they call ef_send_email via HTTP.

### Step 5: Test Email Sending

#### Test 1: Template Email (via ef_send_email)

Via Supabase Dashboard SQL Editor:
```sql
-- Insert test email log (will trigger email send)
SELECT net.http_post(
  url := 'https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_send_email',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key')
  ),
  body := jsonb_build_object(
    'template_key', 'prospect_confirmation',
    'to_email', 'admin@bitwealth.co.za',
    'data', jsonb_build_object(
      'first_name', 'Test',
      'website_url', 'https://bitwealth.co.za'
    )
  )
);
```

Or via PowerShell:
```powershell
$headers = @{
  "Content-Type" = "application/json"
  "Authorization" = "Bearer YOUR_SERVICE_ROLE_KEY"
}

$body = @{
  template_key = "prospect_confirmation"
  to_email = "admin@bitwealth.co.za"
  data = @{
    first_name = "Test"
    website_url = "https://bitwealth.co.za"
  }
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_send_email" `
  -Method Post `
  -Headers $headers `
  -Body $body
```

Check results:
```sql
-- Check email logs
SELECT * FROM public.email_logs 
ORDER BY created_at DESC 
LIMIT 5;

-- Should see smtp_message_id populated and status = 'sent'
```

#### Test 2: Alert Digest Email (via ef_alert_digest)

First, create a test alert:
```sql
INSERT INTO public.alert_events (
  org_id, 
  component, 
  severity, 
  message, 
  context
)
VALUES (
  'YOUR_ORG_ID',
  'test_component',
  'error',
  'Test alert for SMTP migration',
  '{}'::jsonb
);
```

Then trigger alert digest:
```powershell
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_alert_digest `
  -H "Authorization: Bearer YOUR_ANON_KEY" `
  -H "Content-Type: application/json" `
  -d '{}'
```

Check inbox for alert email.

### Step 6: Monitor for 24 Hours

```sql
-- Check email success rate
SELECT 
  status,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
FROM public.email_logs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Check for SMTP errors
SELECT 
  template_key,
  recipient_email,
  error_message,
  created_at
FROM public.email_logs
WHERE status = 'failed'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

### Step 7: Remove Resend API Key (After Success)

**⚠️ ONLY after confirming emails work for 48 hours:**

Via Supabase Dashboard:
1. Go to **Settings → Edge Functions → Secrets**
2. Delete `RESEND_API_KEY`

---

## 🚨 Rollback Procedure

If SMTP fails, immediately rollback:

### 1. Restore Resend API Key
```powershell
# Via Dashboard: Settings → Edge Functions → Secrets
# Add back: RESEND_API_KEY = your_backup_value
```

### 2. Revert Edge Functions

```powershell
# Checkout previous version
git checkout HEAD~1 -- supabase/functions/ef_send_email/index.ts
git checkout HEAD~1 -- supabase/functions/ef_alert_digest/index.ts

# Redeploy
supabase functions deploy ef_send_email --project-ref wqnmxpooabmedvtackji --no-verify-jwt
supabase functions deploy ef_alert_digest --project-ref wqnmxpooabmedvtackji --no-verify-jwt
```

### 3. Verify Resend Works
```sql
-- Test email via old system
SELECT * FROM public.email_logs 
WHERE created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

---

## 🔍 Troubleshooting

### Issue: "SMTP connection timeout"
**Cause:** Wrong SMTP_HOST or firewall blocking port  
**Solution:** 
- Verify SMTP_HOST with hosting provider
- Check if port 587 or 465 is open
- Try alternate port (587 vs 465)

### Issue: "Authentication failed"
**Cause:** Wrong SMTP_USER or SMTP_PASS  
**Solution:**
- Verify credentials with hosting provider
- Check if "App Passwords" are required (e.g., Gmail)
- Ensure username is full email address (not just "admin")

### Issue: "TLS handshake error"
**Cause:** Wrong SMTP_SECURE setting  
**Solution:**
- Port 587 → `SMTP_SECURE=false` (STARTTLS)
- Port 465 → `SMTP_SECURE=true` (SSL/TLS)

### Issue: Emails sent but not received
**Cause:** SPF/DKIM/DMARC not configured  
**Solution:**
- Check email spam folders
- Verify DNS records for domain:
  ```
  TXT record: v=spf1 include:yourprovider.com ~all
  DKIM record: [provided by hosting]
  DMARC record: v=DMARC1; p=none; rua=mailto:admin@bitwealth.co.za
  ```

### Issue: "Missing SMTP configuration"
**Cause:** Environment variables not set  
**Solution:**
```powershell
# Verify via Supabase Functions logs
supabase functions logs ef_send_email --project-ref wqnmxpooabmedvtackji

# Check for "Missing SMTP configuration" error
# Re-add missing variables via Dashboard
```

---

## 📊 Success Metrics

After deployment, monitor these metrics:

| Metric | Target | Check Via |
|--------|--------|-----------|
| Email delivery rate | >98% | `SELECT status, COUNT(*) FROM email_logs GROUP BY status` |
| SMTP errors | <2% | `SELECT COUNT(*) FROM email_logs WHERE status='failed'` |
| Average send time | <5 seconds | Edge function logs |
| Alert digest delivery | 100% | Daily inbox check at 05:00 UTC |

---

## 📧 Email Address Mapping (Post-Migration)

| Template | Recipient Type | From Address |
|----------|---------------|--------------|
| prospect_confirmation | Customer | noreply@bitwealth.co.za |
| prospect_notification | Admin | noreply@bitwealth.co.za |
| kyc_portal_registration | Customer | noreply@bitwealth.co.za |
| kyc_id_uploaded_notification | Admin | noreply@bitwealth.co.za |
| kyc_verified_notification | Customer | noreply@bitwealth.co.za |
| deposit_instructions | Customer | noreply@bitwealth.co.za |
| funds_deposited_admin_notification | Admin | noreply@bitwealth.co.za |
| registration_complete_welcome | Customer | noreply@bitwealth.co.za |
| alert_digest | Admin | admin@bitwealth.co.za |

**Future Enhancement:** Allow per-template from_email override in database.

---

## 🎯 Next Steps (Post-Migration)

1. ✅ Monitor email logs for 1 week
2. ✅ Configure SPF/DKIM/DMARC records
3. ✅ Set up email rate limiting (if needed)
4. ✅ Implement support@bitwealth.co.za for support tickets
5. ✅ Add email delivery webhooks (bounce/complaint handling)
6. ✅ Create email analytics dashboard

---

## 📝 Documentation Updates Required

After successful deployment, update:
- [ ] `docs/SDD_v0.6.md` - Section on email integration
- [ ] `SECRET_KEY_MIGRATION.md` - Add SMTP environment variables
- [ ] `DEPLOYMENT_COMPLETE.md` - Remove Resend references

---

**Migration Owner:** Davin  
**Deployment Date:** TBD (pending SMTP credentials)  
**Rollback Deadline:** 24 hours post-deployment
