# Contact Form Email Notification System - Quick Reference

## Deployment Status: ✅ COMPLETE
**Deployed:** 2026-01-12  
**Edge Function:** `ef_contact_form_submit`  
**Database Table:** `public.contact_form_submissions`

---

## System Overview

**What it does:**
- Captures contact form submissions from website (https://bitwealth.co.za#contact)
- Verifies reCAPTCHA to prevent spam
- Stores submissions in database for CRM tracking
- Sends admin notification email to info@bitwealth.co.za
- Sends auto-reply confirmation email to submitter

---

## User Experience Flow

1. **User fills out contact form:**
   - Name (required)
   - Email (required, validated)
   - Message (required)

2. **User completes reCAPTCHA challenge**

3. **User clicks "Send Message" button**

4. **System processes submission:**
   - Verifies reCAPTCHA with Google API
   - Validates email format
   - Stores in database
   - Sends two emails (admin + auto-reply)

5. **User sees success message:**
   > "Thank you for your message! We'll get back to you within 24 hours."

6. **Emails sent:**
   - **To info@bitwealth.co.za:** Full message details with submitter info
   - **To submitter:** Professional auto-reply confirming receipt

---

## Technical Details

### Database Table
```sql
-- View recent submissions
SELECT 
  id, 
  created_at, 
  name, 
  email, 
  LEFT(message, 50) as message_preview,
  captcha_verified,
  admin_notified_at IS NOT NULL as admin_notified,
  auto_reply_sent_at IS NOT NULL as auto_reply_sent
FROM public.contact_form_submissions 
ORDER BY created_at DESC 
LIMIT 10;

-- Check for failed email deliveries
SELECT * 
FROM public.contact_form_submissions 
WHERE admin_notified_at IS NULL 
   OR auto_reply_sent_at IS NULL
ORDER BY created_at DESC;

-- Count submissions by day
SELECT 
  DATE(created_at) as submission_date,
  COUNT(*) as total_submissions
FROM public.contact_form_submissions
GROUP BY DATE(created_at)
ORDER BY submission_date DESC;
```

### Edge Function Details
- **Function Name:** `ef_contact_form_submit`
- **Endpoint:** `https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_contact_form_submit`
- **JWT Verification:** Disabled (public endpoint)
- **CORS:** Enabled
- **Request Body:**
  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "message": "I'm interested in your services",
    "captcha_token": "03AGdBq..."
  }
  ```
- **Response (Success):**
  ```json
  {
    "success": true,
    "message": "Thank you for your message! We'll get back to you within 24 hours.",
    "admin_notified": true,
    "auto_reply_sent": true
  }
  ```
- **Response (Error):**
  ```json
  {
    "success": false,
    "error": "reCAPTCHA verification failed. Please try again."
  }
  ```

### Environment Variables Required
- `RECAPTCHA_SECRET_KEY` - Google reCAPTCHA server-side secret ✅ Set
- `SMTP_HOST` - SMTP server hostname ✅ Set
- `SMTP_PORT` - SMTP server port ✅ Set
- `SMTP_USER` - SMTP username ✅ Set
- `SMTP_PASS` - SMTP password ✅ Set
- `SUPABASE_URL` - Project URL ✅ Set
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key ✅ Set

---

## Email Templates

### Admin Notification Email
**To:** info@bitwealth.co.za  
**From:** BitWealth Contact Form <noreply@bitwealth.co.za>  
**Subject:** 🔔 New Contact Form Submission from {name}  
**Content:**
- Submitter name
- Submitter email (clickable mailto link)
- Full message text
- Submission timestamp (South Africa timezone)
- Professional HTML formatting with BitWealth branding

### Auto-Reply Email
**To:** {submitter_email}  
**From:** BitWealth <info@bitwealth.co.za>  
**Subject:** Thank You for Contacting BitWealth  
**Content:**
- Personalized greeting (Hi {name})
- Confirmation message received
- 24-hour response time commitment
- CTA button linking to LTH PVR strategy page
- BitWealth branding and footer

---

## Testing Checklist

### ✅ Basic Functionality
- [x] Form submission with valid data
- [x] reCAPTCHA verification working
- [x] Database record created
- [x] Admin email received
- [x] Auto-reply email received

### ⏳ Error Handling (Test Later)
- [ ] Invalid email format rejection
- [ ] Missing required fields rejection
- [ ] reCAPTCHA failure (invalid token)
- [ ] reCAPTCHA timeout (no token)

### ⏳ Edge Cases (Test Later)
- [ ] Very long message (10,000+ characters)
- [ ] Special characters in name/email
- [ ] Multiple submissions from same email
- [ ] Non-English characters (Unicode support)

---

## Troubleshooting

### Issue: No emails received
**Check:**
1. Database record created? `SELECT * FROM public.contact_form_submissions ORDER BY created_at DESC LIMIT 1;`
2. SMTP credentials valid? Test with `ef_send_email` function
3. Check edge function logs: Supabase Dashboard → Functions → ef_contact_form_submit → Logs
4. Verify timestamps: `admin_notified_at` and `auto_reply_sent_at` should not be NULL

### Issue: reCAPTCHA not working
**Check:**
1. Site key correct in HTML? Check data-sitekey attribute in website/index.htmldex.html
2. Secret key set in environment? `supabase secrets list --project-ref wqnmxpooabmedvtackji | Select-String "RECAPTCHA"`
3. Domain registered with Google reCAPTCHA? Should include `bitwealth.co.za`

### Issue: Form submission fails
**Check:**
1. Browser console for JavaScript errors (F12 → Console tab)
2. Network tab for edge function response (F12 → Network tab)
3. Edge function deployed? `supabase functions list --project-ref wqnmxpooabmedvtackji`

---

## Maintenance

### Weekly Tasks
- Review submissions: Check for spam or abuse
- Monitor email delivery: Verify `admin_notified_at` and `auto_reply_sent_at` populated

### Monthly Tasks
- Analyze submission trends: Count by day/week
- Archive old submissions (optional): Keep last 12 months

### As Needed
- Update email templates: Modify `ef_contact_form_submit/index.ts`
- Adjust rate limits: Add logic based on email/IP address
- Build admin UI: Create dashboard to view/respond to submissions

---

## Future Enhancements

1. **Rate Limiting:** Prevent abuse (e.g., max 5 submissions per email per day)
2. **Admin Dashboard:** UI panel in admin UI to view/respond to submissions
3. **Auto-Response Templates:** Multiple templates based on message content
4. **CRM Integration:** Sync with external CRM system (HubSpot, Salesforce)
5. **Notification Channels:** Slack/Discord webhook in addition to email
6. **Analytics:** Track conversion rate (contact → prospect → customer)

---

## Related Documentation

- **SDD v0.6.17:** Full architecture documentation
- **Deployment Script:** `deploy-contact-form.ps1`
- **Edge Function:** `supabase/functions/ef_contact_form_submit/index.ts`
- **Migration:** `supabase/migrations/20260112_add_contact_form_submissions.sql`
- **Website Form:** `website/index.html` (lines 436-442 + JavaScript handler)

---

**Last Updated:** 2026-01-12  
**Status:** Production Ready ✅
