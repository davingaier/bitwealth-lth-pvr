# Improve Email Template Logo - Professional Styling

# Option 1: Add CSS to force transparency and improve styling
$previewPath = "email-templates-preview.html"
$html = Get-Content $previewPath -Raw

# Find and replace the logo img tags with improved styling
$oldLogoStyle = 'style="max-width: 220px; height: auto; margin-bottom: 10px;"'
$newLogoStyle = 'style="max-width: 180px; height: auto; margin-bottom: 15px; background: transparent; mix-blend-mode: lighten; filter: brightness(1.2) contrast(1.1);"'

$html = $html -replace [regex]::Escape($oldLogoStyle), $newLogoStyle

# Also update the larger sizes
$html = $html -replace 'max-width: 240px', 'max-width: 200px'
$html = $html -replace 'max-width: 200px; height: auto; margin-bottom: 10px;', 'max-width: 160px; height: auto; margin-bottom: 12px; background: transparent; mix-blend-mode: lighten;'

$html | Out-File $previewPath -Encoding utf8

Write-Host "✓ Logo styling improved!" -ForegroundColor Green
Write-Host ""
Write-Host "Changes applied:" -ForegroundColor Cyan
Write-Host "  • Reduced size (220px → 180px)" 
Write-Host "  • Added blend mode for better integration"
Write-Host "  • Increased brightness for dark backgrounds"
Write-Host "  • Forced transparent background"
Write-Host ""
Write-Host "Opening updated preview..." -ForegroundColor Cyan
Start-Process $previewPath
