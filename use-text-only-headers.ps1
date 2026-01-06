# Professional text-only email headers (no logo needed)

$previewPath = "email-templates-preview.html"
$html = Get-Content $previewPath -Raw

# Create a professional text-based header that matches your brand
$professionalHeader = @'
<div style="text-align: center;">
    <div style="font-family: 'Arial', 'Helvetica', sans-serif; font-size: 32px; font-weight: 700; color: #F39C12; letter-spacing: 0.5px; margin-bottom: 8px;">
        BitWealth
    </div>
    <div style="font-size: 13px; color: #ffffff; letter-spacing: 1px; text-transform: uppercase; opacity: 0.9;">
        Advanced Bitcoin DCA Strategy
    </div>
</div>
'@

# Remove all logo images and replace with professional text
$html = $html -replace '<img[^>]*data:image[^>]*>', $professionalHeader

# Also clean up any leftover styling
$html = $html -replace 'Advanced Bitcoin DCA Strategy</p>', 'Advanced Bitcoin DCA Strategy</div>'

$html | Out-File $previewPath -Encoding utf8

Write-Host "✓ Applied professional text-only headers" -ForegroundColor Green
Write-Host ""
Write-Host "Benefits:" -ForegroundColor Cyan
Write-Host "  • No logo rendering issues"
Write-Host "  • Works in ALL email clients"
Write-Host "  • Clean, professional look"
Write-Host "  • Fast loading"
Write-Host "  • Matches your brand colors"
Write-Host ""
Write-Host "Opening preview..." -ForegroundColor Cyan
Start-Process $previewPath
