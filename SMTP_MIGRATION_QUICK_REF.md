# SMTP Migration Quick Reference
**Date:** January 4, 2026

---

## 🚀 Quick Deploy (After SMTP Credentials Obtained)

```powershell
# 1. Test SMTP Connection
.\test-smtp.ps1 -SmtpPass 'your_password'

# 2. Apply Database Migration
supabase db push --project-ref wqnmxpooabmedvtackji

# 3. Add Environment Variables (Supabase Dashboard)
# Settings → Edge Functions → Secrets:
# - SMTP_HOST=mail.bitwealth.co.za
# - SMTP_PORT=587
# - SMTP_USER=admin@bitwealth.co.za
# - SMTP_PASS=your_smtp_password_here
# - SMTP_SECURE=false
# - ALERT_EMAIL_FROM=admin@bitwealth.co.za
# - ALERT_EMAIL_TO=admin@bitwealth.co.za

# 4. Deploy Edge Functions
supabase functions deploy ef_send_email --project-ref wqnmxpooabmedvtackji --no-verify-jwt
supabase functions deploy ef_alert_digest --project-ref wqnmxpooabmedvtackji --no-verify-jwt

# 5. Test Email Send
curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_send_email `
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" `
  -H "Content-Type: application/json" `
  -d '{"template_key":"prospect_confirmation","to_email":"admin@bitwealth.co.za","data":{"first_name":"Test","website_url":"https://bitwealth.co.za"}}'

# 6. Check Email Logs
# SQL: SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 5;
```

---

## 📧 Email Flow Summary

### Customer Onboarding Emails

| Milestone | Trigger | Template | From | To |
|-----------|---------|----------|------|-----|
| M1 Prospect | Form submit | prospect_confirmation | noreply | Customer |
| M1 Prospect | Form submit | prospect_notification | noreply | Admin |
| M2 Strategy | Admin confirms | kyc_portal_registration | noreply | Customer |
| M3 KYC Upload | Customer uploads ID | kyc_id_uploaded_notification | noreply | Admin (2x) |
| M3 KYC Verify | Admin verifies | kyc_verified_notification | noreply | Customer |
| M4 Deposit Ref | Admin saves ref | deposit_instructions | noreply | Customer |
| M5 Funds | Balance > 0 | funds_deposited_admin_notification | noreply | Admin (2x) |
| M5 Funds | Balance > 0 | registration_complete_welcome | noreply | Customer |

### System Emails

| Type | Trigger | From | To |
|------|---------|------|-----|
| Alert Digest | Daily 05:00 UTC | admin | Admin |
| Fee Invoices | Monthly | TBD | Customer |

---

## 🔧 Modified Files

```
✅ supabase/functions/_shared/smtp.ts (NEW)
✅ supabase/functions/ef_send_email/index.ts (MODIFIED)
✅ supabase/functions/ef_alert_digest/index.ts (MODIFIED)
✅ supabase/migrations/20260104_add_smtp_support_email_logs.sql (NEW)
✅ test-smtp.ps1 (NEW)
```

---

## 🚨 Rollback Command

```powershell
# Revert edge functions
git checkout HEAD~1 -- supabase/functions/ef_send_email/index.ts
git checkout HEAD~1 -- supabase/functions/ef_alert_digest/index.ts

# Redeploy
supabase functions deploy ef_send_email --project-ref wqnmxpooabmedvtackji --no-verify-jwt
supabase functions deploy ef_alert_digest --project-ref wqnmxpooabmedvtackji --no-verify-jwt

# Re-add RESEND_API_KEY via Dashboard
```

---

## 📊 Monitoring Queries

```sql
-- Email delivery rate (last 24h)
SELECT 
  status,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as percentage
FROM public.email_logs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status;

-- Recent failures
SELECT 
  template_key,
  recipient_email,
  error_message,
  created_at
FROM public.email_logs
WHERE status = 'failed'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- Email volume by template
SELECT 
  template_key,
  COUNT(*) as sent,
  COUNT(*) FILTER (WHERE status = 'sent') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed
FROM public.email_logs
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY template_key
ORDER BY sent DESC;
```

---

## 📝 Environment Variables Checklist

### Required for SMTP
- [ ] SMTP_HOST
- [ ] SMTP_PORT
- [ ] SMTP_USER
- [ ] SMTP_PASS
- [ ] SMTP_SECURE

### Required for Alerts
- [ ] ALERT_EMAIL_FROM=admin@bitwealth.co.za
- [ ] ALERT_EMAIL_TO=admin@bitwealth.co.za

### To Remove (After Testing)
- [ ] RESEND_API_KEY (delete after 48h success)

---

## 🎯 Testing Checklist

- [ ] SMTP connection test (test-smtp.ps1)
- [ ] Template email send (prospect_confirmation)
- [ ] Alert digest email
- [ ] Check email_logs table (smtp_message_id populated)
- [ ] Verify "From" address in inbox
- [ ] Check spam folder
- [ ] Monitor for 24-48 hours
- [ ] Remove RESEND_API_KEY

---

## 📞 Troubleshooting Quick Fixes

| Error | Fix |
|-------|-----|
| Connection timeout | Check SMTP_HOST and firewall |
| Authentication failed | Verify SMTP_USER/SMTP_PASS |
| TLS handshake error | Port 587=false, Port 465=true |
| Emails not received | Check spam, verify SPF/DKIM |

---

**See Full Documentation:** [SMTP_MIGRATION_DEPLOYMENT_GUIDE.md](SMTP_MIGRATION_DEPLOYMENT_GUIDE.md)  
**Email Audit:** [docs/EMAIL_SYSTEM_AUDIT_AND_SMTP_MIGRATION.md](docs/EMAIL_SYSTEM_AUDIT_AND_SMTP_MIGRATION.md)
