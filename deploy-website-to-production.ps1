# Deploy Website to Production - bitwealth.co.za
# Date: January 7, 2026

Write-Host "=== BitWealth Website Production Deployment ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Issue: 404 errors - website files not deployed to production" -ForegroundColor Yellow
Write-Host "Solution: Upload website folder to bitwealth.co.za hosting" -ForegroundColor Green
Write-Host ""

$websiteDir = ".\website"

if (-not (Test-Path $websiteDir)) {
    Write-Host "ERROR: website directory not found!" -ForegroundColor Red
    exit 1
}

Write-Host "Files to deploy:" -ForegroundColor Cyan
Get-ChildItem $websiteDir -Recurse -File | ForEach-Object {
    $relativePath = $_.FullName.Replace((Get-Item $websiteDir).FullName, "").TrimStart("\")
    Write-Host "  $relativePath" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=== Deployment Instructions ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your hosting is: LiteSpeed Web Server (75.2.60.5)" -ForegroundColor Yellow
Write-Host ""
Write-Host "Method 1: FTP/SFTP Upload" -ForegroundColor White
Write-Host "  1. Open FileZilla or WinSCP" -ForegroundColor Gray
Write-Host "  2. Connect to: bitwealth.co.za" -ForegroundColor Gray
Write-Host "  3. Use your hosting FTP credentials" -ForegroundColor Gray
Write-Host "  4. Navigate to: public_html/ or www/" -ForegroundColor Gray
Write-Host "  5. Upload ALL files from: $websiteDir" -ForegroundColor Gray
Write-Host ""
Write-Host "Method 2: Hosting Control Panel" -ForegroundColor White
Write-Host "  1. Log in to cPanel/Plesk at your hosting provider" -ForegroundColor Gray
Write-Host "  2. Open File Manager" -ForegroundColor Gray
Write-Host "  3. Navigate to public_html folder" -ForegroundColor Gray
Write-Host "  4. Upload files from: $websiteDir" -ForegroundColor Gray
Write-Host ""
Write-Host "Opening website folder in Explorer..." -ForegroundColor Yellow
explorer $websiteDir
Write-Host ""

Write-Host "After deployment, test:" -ForegroundColor Cyan
Write-Host "  https://bitwealth.co.za/index.html" -ForegroundColor Green
Write-Host "  https://bitwealth.co.za/register.html" -ForegroundColor Green
Write-Host "  https://bitwealth.co.za/login.html" -ForegroundColor Green
Write-Host ""
Write-Host "If you need FTP credentials, check:" -ForegroundColor Yellow
Write-Host "  - Hosting provider welcome email" -ForegroundColor Gray
Write-Host "  - cPanel login details" -ForegroundColor Gray
Write-Host "  - Contact your hosting provider if needed" -ForegroundColor Gray
