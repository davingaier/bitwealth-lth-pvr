# Replace logo image with professional text styling

$previewPath = "email-templates-preview.html"
$html = Get-Content $previewPath -Raw

# Read one of the SVG files if available
$svgPath = "C:\Users\davin\Dropbox\BitWealth\Logo\SVG"
$svgFiles = Get-ChildItem "$svgPath\*.svg" -ErrorAction SilentlyContinue

if ($svgFiles) {
    Write-Host "Found SVG files:" -ForegroundColor Green
    $svgFiles | ForEach-Object { Write-Host "  - $($_.Name)" }
    
    # Use the first SVG file (or you can specify which one)
    $svgFile = $svgFiles[0].FullName
    $svgContent = Get-Content $svgFile -Raw
    
    # Convert SVG to base64
    $svgBytes = [System.Text.Encoding]::UTF8.GetBytes($svgContent)
    $svgBase64 = [Convert]::ToBase64String($svgBytes)
    
    Write-Host "`nConverting SVG to base64..." -ForegroundColor Cyan
    Write-Host "SVG file: $($svgFiles[0].Name)"
    Write-Host "Size: $([math]::Round($svgFiles[0].Length/1KB, 2)) KB"
    
    # Replace all logo images with SVG version - much smaller and truly transparent
    $html = $html -replace 'data:image/png;base64,[^"]+', "data:image/svg+xml;base64,$svgBase64"
    
    # Fix the sizing to be smaller and cleaner
    $html = $html -replace 'max-width: \d+px; height: auto; margin-bottom: \d+px;[^"]*', 'width: 140px; height: auto; margin-bottom: 12px;'
    
    $html | Out-File $previewPath -Encoding utf8
    
    Write-Host "`n✓ Updated to SVG logo!" -ForegroundColor Green
    Write-Host "  • True transparency (no white box)"
    Write-Host "  • Smaller size (140px width)"
    Write-Host "  • Smaller file size"
    Write-Host "  • Crisp at any resolution"
    
} else {
    Write-Host "SVG files not found. Using text-only approach instead..." -ForegroundColor Yellow
    Write-Host ""
    
    # Fallback: Replace logos with clean text styling
    # This looks professional and matches your brand
    $textLogo = '<div style="text-align: center; margin-bottom: 15px;"><span style="font-family: Arial, sans-serif; font-size: 28px; font-weight: bold; color: #F39C12; letter-spacing: 1px;">BitWealth</span></div>'
    
    # Remove all logo images and replace with text
    $html = $html -replace '<img src="data:image/[^>]+/>', $textLogo
    
    $html | Out-File $previewPath -Encoding utf8
    
    Write-Host "✓ Replaced with professional text logo!" -ForegroundColor Green
    Write-Host "  • No white box issues"
    Write-Host "  • Clean, professional look"
    Write-Host "  • Matches your brand colors"
}

Write-Host "`nOpening preview..." -ForegroundColor Cyan
Start-Process $previewPath
