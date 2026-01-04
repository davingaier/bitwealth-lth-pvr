# SMTP Connection Test Script
# Purpose: Verify SMTP credentials before deploying to Supabase
# Usage: Update variables below with your SMTP credentials, then run in PowerShell

param(
    [string]$SmtpHost = "mail.yourhostingprovider.com",
    [int]$SmtpPort = 587,
    [string]$SmtpUser = "admin@bitwealth.co.za",
    [string]$SmtpPass = "",
    [bool]$EnableSsl = $true,
    [string]$TestRecipient = "admin@bitwealth.co.za"
)

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "BitWealth SMTP Connection Test" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Validate parameters
if ([string]::IsNullOrWhiteSpace($SmtpPass)) {
    Write-Host "ERROR: SMTP password is required!" -ForegroundColor Red
    Write-Host "Usage: .\test-smtp.ps1 -SmtpPass 'your_password'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  SMTP Host: $SmtpHost" -ForegroundColor White
Write-Host "  SMTP Port: $SmtpPort" -ForegroundColor White
Write-Host "  SMTP User: $SmtpUser" -ForegroundColor White
Write-Host "  Enable SSL: $EnableSsl" -ForegroundColor White
Write-Host "  Test Recipient: $TestRecipient" -ForegroundColor White
Write-Host ""

try {
    Write-Host "Step 1: Creating SMTP client..." -ForegroundColor Yellow
    $smtp = New-Object Net.Mail.SmtpClient($SmtpHost, $SmtpPort)
    $smtp.EnableSsl = $EnableSsl
    $smtp.Timeout = 30000  # 30 seconds
    $smtp.Credentials = New-Object System.Net.NetworkCredential($SmtpUser, $SmtpPass)
    Write-Host "  ✓ SMTP client created" -ForegroundColor Green

    Write-Host ""
    Write-Host "Step 2: Creating test email message..." -ForegroundColor Yellow
    $msg = New-Object Net.Mail.MailMessage
    $msg.From = $SmtpUser
    $msg.To.Add($TestRecipient)
    $msg.Subject = "BitWealth SMTP Test - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    $msg.Body = @"
This is a test email from the BitWealth SMTP migration process.

Test Details:
- SMTP Host: $SmtpHost
- SMTP Port: $SmtpPort
- Sender: $SmtpUser
- Test Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

If you received this email, your SMTP configuration is working correctly!

---
BitWealth LTH PVR System
"@
    $msg.IsBodyHtml = $false
    Write-Host "  ✓ Test message created" -ForegroundColor Green

    Write-Host ""
    Write-Host "Step 3: Sending test email..." -ForegroundColor Yellow
    $smtp.Send($msg)
    Write-Host "  ✓ Email sent successfully!" -ForegroundColor Green

    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "SUCCESS! SMTP configuration is working." -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "1. Check inbox at $TestRecipient" -ForegroundColor White
    Write-Host "2. If email received, proceed with Supabase deployment" -ForegroundColor White
    Write-Host "3. Add these environment variables to Supabase:" -ForegroundColor White
    Write-Host "   - SMTP_HOST=$SmtpHost" -ForegroundColor Cyan
    Write-Host "   - SMTP_PORT=$SmtpPort" -ForegroundColor Cyan
    Write-Host "   - SMTP_USER=$SmtpUser" -ForegroundColor Cyan
    Write-Host "   - SMTP_PASS=<your_password>" -ForegroundColor Cyan
    Write-Host "   - SMTP_SECURE=$(if ($EnableSsl) { 'true' } else { 'false' })" -ForegroundColor Cyan

} catch {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "ERROR: SMTP test failed!" -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Error Details:" -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting Tips:" -ForegroundColor Yellow
    Write-Host "1. Connection Timeout:" -ForegroundColor White
    Write-Host "   - Check SMTP host and port are correct" -ForegroundColor Gray
    Write-Host "   - Verify firewall allows outbound connections on port $SmtpPort" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Authentication Failed:" -ForegroundColor White
    Write-Host "   - Verify SMTP username and password" -ForegroundColor Gray
    Write-Host "   - Check if 'App Passwords' are required (Gmail, Outlook)" -ForegroundColor Gray
    Write-Host "   - Ensure username is full email address" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. TLS/SSL Error:" -ForegroundColor White
    Write-Host "   - Try port 587 with -EnableSsl `$true (STARTTLS)" -ForegroundColor Gray
    Write-Host "   - Try port 465 with -EnableSsl `$true (SSL/TLS)" -ForegroundColor Gray
    Write-Host "   - Try port 25 with -EnableSsl `$false (plain, not recommended)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "4. Relay Access Denied:" -ForegroundColor White
    Write-Host "   - Contact your email hosting provider" -ForegroundColor Gray
    Write-Host "   - Verify SMTP is enabled for your account" -ForegroundColor Gray
    Write-Host ""
    
    exit 1
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
