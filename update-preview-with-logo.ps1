# Update email templates preview with actual logo

$logoPath = "C:\Users\davin\Desktop\BitWealth Logo (Transparent Background)_v1.0_20250719.png"
$previewPath = "email-templates-preview.html"

Write-Host "Converting logo to base64..." -ForegroundColor Cyan
$bytes = [System.IO.File]::ReadAllBytes($logoPath)
$base64 = [Convert]::ToBase64String($bytes)

Write-Host "✓ Logo converted: $([math]::Round($bytes.Length/1KB, 2)) KB" -ForegroundColor Green
Write-Host "✓ Base64 length: $($base64.Length) characters" -ForegroundColor Green

# Read the preview HTML
$html = Get-Content $previewPath -Raw

# Replace all placeholder base64 references with actual logo
$html = $html -replace 'data:image/png;base64,LOGO_BASE64_HERE', "data:image/png;base64,$base64"

# Save updated HTML
$html | Out-File $previewPath -Encoding utf8

Write-Host "✓ Preview updated!" -ForegroundColor Green
Write-Host ""
Write-Host "Opening preview in browser..." -ForegroundColor Cyan
Start-Process $previewPath

Write-Host ""
Write-Host "✓ DONE! You should now see the BitWealth logo in all email templates." -ForegroundColor Green
