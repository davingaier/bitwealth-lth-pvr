# Email System Audit & SMTP Migration Plan
**Date:** January 4, 2026  
**Status:** Implementation Ready

---

## 📧 Email Infrastructure Overview

### Current State: Resend API
- **Provider:** Resend (https://api.resend.com)
- **Authentication:** API Key (`RESEND_API_KEY`)
- **Implementation:** Centralized via `ef_send_email` edge function + direct calls in `ef_alert_digest`

### Target State: Direct SMTP
- **Mailboxes Available:**
  - `admin@bitwealth.co.za` - Admin notifications
  - `support@bitwealth.co.za` - Customer support communications
  - `noreply@bitwealth.co.za` - Automated system emails
- **Authentication:** SMTP credentials (host, port, username, password)

---

## 📊 Customer Onboarding Email Audit

### Milestone 1: Prospect Submission
| Trigger | Template Key | Recipient | From Address | Current Method | Edge Function |
|---------|-------------|-----------|--------------|----------------|---------------|
| Prospect form submit | `prospect_confirmation` | Customer | `noreply@bitwealth.co.za` | Resend via `ef_send_email` | `ef_prospect_submit` |
| Prospect form submit | `prospect_notification` | Admin | `noreply@bitwealth.co.za` | Resend via `ef_send_email` | `ef_prospect_submit` |

**Subject Lines:**
- Customer: "Thank you for your interest in BitWealth"
- Admin: "New Prospect: {{first_name}} {{surname}}"

---

### Milestone 2: Strategy Confirmation
| Trigger | Template Key | Recipient | From Address | Current Method | Edge Function |
|---------|-------------|-----------|--------------|----------------|---------------|
| Admin confirms strategy | `kyc_portal_registration` | Customer | `noreply@bitwealth.co.za` | Resend via `ef_send_email` | `ef_confirm_strategy` |

**Subject Line:** "Welcome to BitWealth - Create Your Portal Account"

**Contains:** Registration link to `register.html` for portal account creation + ID upload

---

### Milestone 3: KYC ID Upload
| Trigger | Template Key | Recipient | From Address | Current Method | Edge Function |
|---------|-------------|-----------|--------------|----------------|---------------|
| Customer uploads ID | `kyc_id_uploaded_notification` | Admin (2x) | `noreply@bitwealth.co.za` | Resend via `ef_send_email` | `ef_upload_kyc_id` |
| Admin verifies ID | `kyc_verified_notification` | Customer | `noreply@bitwealth.co.za` | Resend via `ef_send_email` | `ef_approve_kyc` |

**Admin Recipients:** Both `admin@bitwealth.co.za` AND `davin.gaier@gmail.com`

**Subject Lines:**
- Admin: "New ID Document Uploaded - {{first_name}} {{last_name}}"
- Customer: "Welcome to BitWealth - Your Account is Ready!"

---

### Milestone 4: VALR Account Setup
| Trigger | Template Key | Recipient | From Address | Current Method | Edge Function |
|---------|-------------|-----------|--------------|----------------|---------------|
| Admin saves deposit ref | `deposit_instructions` | Customer | `noreply@bitwealth.co.za` | Resend via `ef_send_email` | TBD (not yet implemented) |

**Subject Line:** "Fund Your BitWealth Account - Deposit Instructions"

**Contains:** VALR banking details + deposit reference code

---

### Milestone 5: Funds Deposit Detection
| Trigger | Template Key | Recipient | From Address | Current Method | Edge Function |
|---------|-------------|-----------|--------------|----------------|---------------|
| Balance > 0 detected | `funds_deposited_admin_notification` | Admin (2x) | `noreply@bitwealth.co.za` | Resend via `ef_send_email` | `ef_deposit_scan` |
| Balance > 0 detected | `registration_complete_welcome` | Customer | `noreply@bitwealth.co.za` | Resend via `ef_send_email` | `ef_deposit_scan` |

**Admin Recipients:** Both `admin@bitwealth.co.za` AND `davin.gaier@gmail.com`

**Subject Lines:**
- Admin: "💰 Funds Deposited - {{first_name}} {{last_name}} Now Active"
- Customer: "🎉 Welcome to BitWealth - Your Account is Active!"

---

## 🔧 Other Email Functions (Outside Onboarding)

### Alert Digest System
| Trigger | Template | Recipient | From Address | Current Method | Edge Function |
|---------|----------|-----------|--------------|----------------|---------------|
| Daily cron (05:00 UTC) | Plain text (not templated) | Admin | `ALERT_EMAIL_FROM` env var | **Direct Resend API call** | `ef_alert_digest` |

**⚠️ Special Case:** This function does NOT use `ef_send_email` - it calls Resend API directly.

**Current Config:**
- `ALERT_EMAIL_FROM` = Environment variable (should be `admin@bitwealth.co.za`)
- `ALERT_EMAIL_TO` = Environment variable (admin email address)
- `RESEND_API_KEY` = API key

---

### Fee Invoice Emails
| Trigger | Template | Recipient | From Address | Current Method | Edge Function |
|---------|----------|-----------|--------------|----------------|---------------|
| Monthly close | External service | Customer | Unknown | **External URL** | `ef_fee_invoice_email` |

**⚠️ Special Case:** This function calls an external email service URL (`INVOICE_EMAIL_URL`), not Resend or `ef_send_email`.

**Status:** May be separate system - requires further investigation.

---

### Support & Withdrawal Emails (Planned/Templated)
These templates exist but may not have edge functions yet:
- `support_request_confirmation` - "We Have Received Your Support Request"
- `support_request_notification` - "Support Request from {{first_name}} {{surname}} - {{subject}}"
- `withdrawal_request_notification` - "Withdrawal Request from {{first_name}} {{surname}} - R {{amount}}"
- `withdrawal_approved` - "Your Withdrawal Request Has Been Approved"
- `withdrawal_completed` - "Your Withdrawal Has Been Completed"
- `monthly_statement` - "Your BitWealth Monthly Statement - {{month_name}} {{year}}"

---

## 🎯 SMTP Migration Plan

### Step 1: Create SMTP Utility Module
**File:** `supabase/functions/_shared/smtp.ts`

**Requirements:**
- Deno-compatible SMTP client (e.g., `denominamail` or `denomailer`)
- Support for HTML emails
- Connection pooling for performance
- Error handling and retry logic
- Configuration via environment variables

**Environment Variables Needed:**
```bash
SMTP_HOST=mail.yourhostingprovider.com
SMTP_PORT=587
SMTP_USER=admin@bitwealth.co.za  # or your SMTP username
SMTP_PASS=your_smtp_password
SMTP_SECURE=false  # true for port 465, false for port 587 with STARTTLS
```

---

### Step 2: Update `ef_send_email` Function
**Changes:**
1. Remove Resend API integration
2. Import SMTP utility module
3. Replace `sendEmail()` function to use SMTP
4. Keep template system intact (fetch from `email_templates` table)
5. Update `email_logs` table (remove `resend_message_id`, add `smtp_message_id`)

**From Field Mapping:**
- Templates for customers: `noreply@bitwealth.co.za`
- Admin notifications: `noreply@bitwealth.co.za` (or `admin@bitwealth.co.za` if preferred)
- Support-related: `support@bitwealth.co.za`

---

### Step 3: Update `ef_alert_digest` Function
**Changes:**
1. Import SMTP utility module
2. Replace direct Resend API call with SMTP
3. Update environment variable: `ALERT_EMAIL_FROM` = `admin@bitwealth.co.za`
4. Keep plain-text email format (alerts are text, not HTML)

---

### Step 4: Update Environment Variables
**Remove:**
- `RESEND_API_KEY`

**Add:**
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`

**Update:**
- `ALERT_EMAIL_FROM` = `admin@bitwealth.co.za`
- `ALERT_EMAIL_TO` = `admin@bitwealth.co.za` (or comma-separated list)

---

### Step 5: Database Schema Updates (Optional)
**Table:** `public.email_logs`

**Migration:**
```sql
-- Add SMTP message ID column
ALTER TABLE public.email_logs
ADD COLUMN smtp_message_id TEXT;

-- Optionally rename/deprecate old column
ALTER TABLE public.email_logs
RENAME COLUMN resend_message_id TO legacy_resend_message_id;

-- Add comment
COMMENT ON COLUMN public.email_logs.smtp_message_id IS 'Message ID returned by SMTP server';
```

---

### Step 6: Testing Plan
**Test Cases:**
1. **Prospect Submission Email** (both customer + admin)
2. **Strategy Confirmation Email** (customer registration link)
3. **KYC Upload Notification** (admin alert)
4. **KYC Verified Email** (customer notification)
5. **Deposit Instructions Email** (customer with banking details)
6. **Funds Deposited Emails** (both admin + customer)
7. **Alert Digest Email** (admin plain-text alert)

**Verification:**
- Check inbox for each recipient
- Verify correct "From" address appears
- Confirm HTML rendering (for templated emails)
- Check email logs table for successful delivery
- Monitor SMTP errors in edge function logs

---

## 📝 Implementation Checklist

- [ ] Obtain SMTP credentials from hosting provider
- [ ] Test SMTP connection manually (via telnet or SMTP client)
- [ ] Create `_shared/smtp.ts` module
- [ ] Update `ef_send_email` to use SMTP
- [ ] Update `ef_alert_digest` to use SMTP
- [ ] Add SMTP environment variables to Supabase project
- [ ] Remove `RESEND_API_KEY` from environment
- [ ] Deploy updated edge functions
- [ ] Run test emails for each workflow
- [ ] Update SDD documentation with SMTP details
- [ ] Monitor email logs for first 48 hours

---

## 🚨 Rollback Plan

If SMTP migration fails:
1. Restore `RESEND_API_KEY` environment variable
2. Revert `ef_send_email` and `ef_alert_digest` to previous versions
3. Re-deploy original functions
4. Monitor email logs for recovery

**Git Tags:**
- Create tag `pre-smtp-migration` before starting
- Allows quick rollback via `git checkout pre-smtp-migration`

---

## 📧 Email Address Usage Strategy

| Address | Purpose | Use Cases |
|---------|---------|-----------|
| `noreply@bitwealth.co.za` | Automated system emails | Prospect confirmations, KYC links, deposit instructions, welcome emails, account status changes |
| `admin@bitwealth.co.za` | Admin notifications & alerts | KYC upload notifications, funds deposited alerts, alert digest, prospect notifications |
| `support@bitwealth.co.za` | Customer support | Support request confirmations, support ticket notifications, withdrawal-related communications |

**Recommendation:**
- Use `noreply@bitwealth.co.za` as default for all customer-facing automated emails
- Use `admin@bitwealth.co.za` for alert digest and internal notifications
- Reserve `support@bitwealth.co.za` for future support ticket system

---

## 🔍 Edge Functions Requiring SMTP Updates

1. ✅ **ef_send_email** - Central email service (Resend → SMTP)
2. ✅ **ef_alert_digest** - Alert emails (Direct Resend → SMTP)
3. ❌ **ef_prospect_submit** - Uses `ef_send_email` (no change needed)
4. ❌ **ef_confirm_strategy** - Uses `ef_send_email` (no change needed)
5. ❌ **ef_upload_kyc_id** - Uses `ef_send_email` (no change needed)
6. ❌ **ef_approve_kyc** - Uses `ef_send_email` (no change needed)
7. ❌ **ef_deposit_scan** - Uses `ef_send_email` (no change needed)
8. ⚠️ **ef_fee_invoice_email** - Uses external service (investigate separately)

**Total Functions to Modify:** 2 (ef_send_email, ef_alert_digest)

---

**Next Steps:** Obtain SMTP credentials and proceed with implementation.
