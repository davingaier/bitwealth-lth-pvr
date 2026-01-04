# SMTP Diagnostic Script
# Tests multiple SMTP configurations to find the working one

$smtpHost = "mail.bitwealth.co.za"
$user = "admin@bitwealth.co.za"
$pass = "D@v!nG@!er01020"
$recipient = "admin@bitwealth.co.za"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BitWealth SMTP Diagnostics" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Port 587 with STARTTLS
Write-Host "Test 1: Port 587 with STARTTLS" -ForegroundColor Yellow
try {
    $smtp = New-Object Net.Mail.SmtpClient($smtpHost, 587)
    $smtp.EnableSsl = $true
    $smtp.Timeout = 10000
    $smtp.Credentials = New-Object System.Net.NetworkCredential($user, $pass)
    
    $msg = New-Object Net.Mail.MailMessage
    $msg.From = $user
    $msg.To.Add($recipient)
    $msg.Subject = "SMTP Test - Port 587 STARTTLS - $(Get-Date -Format 'HH:mm:ss')"
    $msg.Body = "Success! Port 587 with STARTTLS works."
    
    $smtp.Send($msg)
    Write-Host "  ✓ SUCCESS - Port 587 with STARTTLS" -ForegroundColor Green
    Write-Host ""
    Write-Host "Use these settings in Supabase:" -ForegroundColor Green
    Write-Host "  SMTP_HOST=mail.bitwealth.co.za" -ForegroundColor Cyan
    Write-Host "  SMTP_PORT=587" -ForegroundColor Cyan
    Write-Host "  SMTP_SECURE=false" -ForegroundColor Cyan
    exit 0
} catch {
    Write-Host "  ✗ FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 2: Port 465 with SSL/TLS
Write-Host "Test 2: Port 465 with SSL/TLS (Implicit)" -ForegroundColor Yellow
try {
    # Port 465 requires implicit SSL, which .NET SmtpClient doesn't support well
    # We need to use a workaround
    $smtp = New-Object Net.Mail.SmtpClient($smtpHost, 465)
    $smtp.EnableSsl = $true
    $smtp.Timeout = 10000
    $smtp.Credentials = New-Object System.Net.NetworkCredential($user, $pass)
    
    # Try to force SSL
    $smtp.UseDefaultCredentials = $false
    
    $msg = New-Object Net.Mail.MailMessage
    $msg.From = $user
    $msg.To.Add($recipient)
    $msg.Subject = "SMTP Test - Port 465 SSL - $(Get-Date -Format 'HH:mm:ss')"
    $msg.Body = "Success! Port 465 with SSL works."
    
    $smtp.Send($msg)
    Write-Host "  ✓ SUCCESS - Port 465 with SSL" -ForegroundColor Green
    Write-Host ""
    Write-Host "Use these settings in Supabase:" -ForegroundColor Green
    Write-Host "  SMTP_HOST=mail.bitwealth.co.za" -ForegroundColor Cyan
    Write-Host "  SMTP_PORT=465" -ForegroundColor Cyan
    Write-Host "  SMTP_SECURE=true" -ForegroundColor Cyan
    exit 0
} catch {
    Write-Host "  ✗ FAILED: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.InnerException) {
        Write-Host "    Inner: $($_.Exception.InnerException.Message)" -ForegroundColor DarkRed
    }
}

Write-Host ""

# Test 3: Port 25 without SSL (not recommended, but sometimes works)
Write-Host "Test 3: Port 25 without SSL (NOT RECOMMENDED)" -ForegroundColor Yellow
try {
    $smtp = New-Object Net.Mail.SmtpClient($smtpHost, 25)
    $smtp.EnableSsl = $false
    $smtp.Timeout = 10000
    $smtp.Credentials = New-Object System.Net.NetworkCredential($user, $pass)
    
    $msg = New-Object Net.Mail.MailMessage
    $msg.From = $user
    $msg.To.Add($recipient)
    $msg.Subject = "SMTP Test - Port 25 Plain - $(Get-Date -Format 'HH:mm:ss')"
    $msg.Body = "Success! Port 25 without SSL works (but not secure)."
    
    $smtp.Send($msg)
    Write-Host "  ✓ SUCCESS - Port 25 plain (not recommended for production)" -ForegroundColor Yellow
    exit 0
} catch {
    Write-Host "  ✗ FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Red
Write-Host "All SMTP tests failed!" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""
Write-Host "Troubleshooting suggestions:" -ForegroundColor Yellow
Write-Host "1. Verify username/password are correct" -ForegroundColor White
Write-Host "2. Check if SMTP access is enabled in your hosting control panel" -ForegroundColor White
Write-Host "3. Some hosts require authentication from webmail first" -ForegroundColor White
Write-Host "4. Try using 'admin@bitwealth.co.za' or just 'admin' as username" -ForegroundColor White
Write-Host "5. Contact your hosting provider (Hover, etc.) to confirm SMTP settings" -ForegroundColor White
Write-Host ""

# Show connection test results
Write-Host "Port connectivity test:" -ForegroundColor Yellow
Test-NetConnection -ComputerName $smtpHost -Port 587 | Select-Object ComputerName, RemotePort, TcpTestSucceeded
Test-NetConnection -ComputerName $smtpHost -Port 465 | Select-Object ComputerName, RemotePort, TcpTestSucceeded
