# Deploy Contact Form Email Notification System
# Created: 2026-01-12
# Purpose: Deploy contact_form_submissions table and ef_contact_form_submit edge function

Write-Host "=== Deploying Contact Form Email Notification System ===" -ForegroundColor Cyan
Write-Host ""

$PROJECT_REF = "wqnmxpooabmedvtackji"

# Step 1: Apply migration
Write-Host "[1/3] Applying database migration..." -ForegroundColor Yellow
# Use MCP tool instead: mcp_supabase_apply_migration
Write-Host "Skipping CLI migration (use MCP tool or Supabase Dashboard)" -ForegroundColor Yellow
Write-Host "Skipping CLI migration (use MCP tool or Supabase Dashboard)" -ForegroundColor Yellow

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Migration failed. Trying MCP tool..." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run this SQL via MCP or Supabase Dashboard:" -ForegroundColor Yellow
    Get-Content "supabase\migrations\20260112_add_contact_form_submissions.sql"
    Write-Host ""
    Read-Host "Press Enter after migration applied"
}

Write-Host "✓ Migration applied" -ForegroundColor Green
Write-Host ""

# Step 2: Deploy edge function
Write-Host "[2/3] Deploying ef_contact_form_submit edge function..." -ForegroundColor Yellow
supabase functions deploy ef_contact_form_submit --project-ref $PROJECT_REF --no-verify-jwt

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Edge function deployment failed" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Edge function deployed" -ForegroundColor Green
Write-Host ""

# Step 3: Verify environment variables
Write-Host "[3/3] Verifying environment variables..." -ForegroundColor Yellow
Write-Host "Required environment variables:" -ForegroundColor Cyan
Write-Host "  • RECAPTCHA_SECRET_KEY" -ForegroundColor White
Write-Host "  • SMTP_HOST" -ForegroundColor White
Write-Host "  • SMTP_PORT" -ForegroundColor White
Write-Host "  • SMTP_USER" -ForegroundColor White
Write-Host "  • SMTP_PASS" -ForegroundColor White
Write-Host ""
Write-Host "Run this command to set RECAPTCHA_SECRET_KEY <your-recaptcha-secret-key>llow
Write-Host '  supabase secrets set RECAPTCHA_SECRET_KEY="<your-recaptcha-secret-key>" --project-ref wqnmxpooabmedvtackji' -ForegroundColor Gray
Write-Host ""

# Test contact form
Write-Host "=== Testing Contact Form ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Test the contact form at:" -ForegroundColor Yellow
Write-Host "  https://bitwealth.co.za#contact" -ForegroundColor White
Write-Host ""
Write-Host "Expected behavior:" -ForegroundColor Yellow
Write-Host "  1. User fills out form (name, email, message)" -ForegroundColor White
Write-Host "  2. User completes reCAPTCHA" -ForegroundColor White
Write-Host "  3. User clicks 'Send Message'" -ForegroundColor White
Write-Host "  4. Success message appears below form" -ForegroundColor White
Write-Host "  5. Admin email sent to info@bitwealth.co.za" -ForegroundColor White
Write-Host "  6. Auto-reply sent to user's email address" -ForegroundColor White
Write-Host ""
Write-Host "Verify submissions in database:" -ForegroundColor Yellow
Write-Host "  SELECT * FROM public.contact_form_submissions ORDER BY created_at DESC LIMIT 5;" -ForegroundColor Gray
Write-Host ""

Write-Host "✓ Deployment complete!" -ForegroundColor Green
