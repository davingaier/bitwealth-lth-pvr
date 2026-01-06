# Update all fonts to Aptos with fallbacks

$previewPath = "email-templates-preview.html"
$html = Get-Content $previewPath -Raw

Write-Host "Updating fonts to Aptos..." -ForegroundColor Cyan

# Define the font stack (Aptos with fallbacks for email compatibility)
$fontStack = "'Aptos', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"

# Replace all font-family declarations
$html = $html -replace "font-family: 'Arial'[^;]*", "font-family: $fontStack"
$html = $html -replace 'font-family: Arial[^;]*', "font-family: $fontStack"
$html = $html -replace 'font-family: [^;]+sans-serif', "font-family: $fontStack"
$html = $html -replace 'font-family: [^;]+Helvetica[^;]*', "font-family: $fontStack"

# Update inline styles in body tags
$html = $html -replace 'style="margin: 0; padding: 0; font-family: [^"]*"', "style=`"margin: 0; padding: 0; font-family: $fontStack`""

# Update the main body style in CSS sections
$html = $html -replace 'body \{ font-family:[^;]+;', "body { font-family: $fontStack;"
$html = $html -replace 'body \{ font-family:[^}]+sans-serif;', "body { font-family: $fontStack;"

$html | Out-File $previewPath -Encoding utf8

Write-Host "✓ All fonts updated to Aptos!" -ForegroundColor Green
Write-Host ""
Write-Host "Font stack applied:" -ForegroundColor Cyan
Write-Host "  1. Aptos (primary - modern Microsoft font)"
Write-Host "  2. Segoe UI (fallback for Windows)"
Write-Host "  3. Helvetica Neue (fallback for Mac/iOS)"
Write-Host "  4. Arial (universal fallback)"
Write-Host "  5. sans-serif (system default)"
Write-Host ""
Write-Host "Note: Aptos is a Microsoft 365 font - not all email clients support it." -ForegroundColor Yellow
Write-Host "The fallback fonts ensure compatibility across all devices." -ForegroundColor Yellow
Write-Host ""
Write-Host "Opening preview..." -ForegroundColor Cyan
Start-Process $previewPath
