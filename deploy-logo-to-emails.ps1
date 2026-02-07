# Deploy BitWealth Logo to All Email Templates
# Date: 2026-02-08

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Deploy Logo to Email Templates" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Load environment variables
$envPath = "$PSScriptRoot\.env"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*?)\s*$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
    Write-Host "✓ Loaded .env file" -ForegroundColor Green
} else {
    Write-Host "✗ .env file not found" -ForegroundColor Red
    exit 1
}

$SUPABASE_URL = $env:SUPABASE_URL
$SERVICE_ROLE_KEY = $env:SUPABASE_SERVICE_ROLE_KEY

if (-not $SUPABASE_URL -or -not $SERVICE_ROLE_KEY) {
    Write-Host "✗ Missing required environment variables" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Environment configured" -ForegroundColor Green
Write-Host ""

# Read base64 logo
$base64 = Get-Content "$PSScriptRoot\logo-base64-full.txt" -Raw
Write-Host "✓ Loaded logo ($(($base64.Length / 1024).ToString('F2')) KB)" -ForegroundColor Green

# Create img tag
$logoImg = "<img src=`"data:image/png;base64,$base64`" alt=`"BitWealth`" style=`"width: 200px; height: auto; display: block; margin: 0 auto;`" />"

Write-Host ""
Write-Host "Fetching email templates..." -ForegroundColor Yellow

# Fetch all active templates
$headers = @{
    "apikey" = $SERVICE_ROLE_KEY
    "Authorization" = "Bearer $SERVICE_ROLE_KEY"
    "Content-Type" = "application/json"
}

$response = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/email_templates?active=eq.true&select=template_key,body_html" -Headers $headers -Method Get

Write-Host "✓ Found $($response.Count) active templates" -ForegroundColor Green
Write-Host ""

$updatedCount = 0
$skippedCount = 0

foreach ($template in $response) {
    $key = $template.template_key
    $html = $template.body_html
    
    # Check if template already has logo
    if ($html -like '*<img src="data:image/png;base64*alt="BitWealth"*') {
        Write-Host "  ⊙ $key - Already has logo" -ForegroundColor Gray
        $skippedCount++
        continue
    }
    
    $updated = $false
    $originalHtml = $html
    
    # Pattern 1: Orange text header (32px)
    $pattern1 = '<div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 32px; font-weight: 700; color: #F39C12; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div>'
    if ($html -like "*$pattern1*") {
        $html = $html.Replace($pattern1, $logoImg)
        $updated = $true
    }
    
    # Pattern 2: White text header (28px) - used in deposit_instructions
    $pattern2 = '<div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div>'
    if ($html -like "*$pattern2*") {
        $html = $html.Replace($pattern2, $logoImg)
        $updated = $true
    }
    
    # Pattern 3: Centered div wrapper (prospect_confirmation structure)
    $pattern3 = '<div style="text-align: center;"><div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 32px; font-weight: 700; color: #F39C12; letter-spacing: 0.5px; margin-bottom: 8px;">BitWealth</div></div>'
    $replacement3 = '<div style="text-align: center;">' + $logoImg + '</div>'
    if ($html -like "*$pattern3*") {
        $html = $html.Replace($pattern3, $replacement3)
        $updated = $true
    }
    
    # Pattern 4: Simple h1 tag (used in older templates like kyc_request, monthly_statement)
    $pattern4 = '<h1>BitWealth</h1>'
    if ($html -like "*$pattern4*") {
        $html = $html.Replace($pattern4, $logoImg)
        $updated = $true
    }
    
    # Pattern 5: White div without size specifications (prospect_notification)
    $pattern5 = '<div style="font-family: ''Aptos'', ''Segoe UI'', ''Helvetica Neue'', Arial, sans-serif; font-size: 28px; font-weight: 700; color: white; letter-spacing: 0.5px;">BitWealth</div>'
    if ($html -like "*$pattern5*") {
        $html = $html.Replace($pattern5, $logoImg)
        $updated = $true
    }
    
    if ($updated) {
        # Update template in database
        $updateBody = @{
            body_html = $html
        } | ConvertTo-Json -Depth 10
        
        try {
            Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/email_templates?template_key=eq.$key" `
                -Headers $headers `
                -Method Patch `
                -Body $updateBody | Out-Null
            
            Write-Host "  ✓ $key - Logo added" -ForegroundColor Green
            $updatedCount++
        } catch {
            Write-Host "  ✗ $key - Update failed: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "  ⊙ $key - No matching pattern found" -ForegroundColor Yellow
        $skippedCount++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Summary:" -ForegroundColor Cyan
Write-Host "  • Updated: $updatedCount templates" -ForegroundColor Green
Write-Host "  • Skipped: $skippedCount templates" -ForegroundColor Gray
Write-Host "  • Total: $($response.Count) templates" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($updatedCount -gt 0) {
    Write-Host "✓ Logo deployment complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Test an email by triggering a template (e.g., prospect_confirmation)" -ForegroundColor White
    Write-Host "  2. Check your inbox to verify logo displays correctly" -ForegroundColor White
    Write-Host "  3. If changes needed, update logo file and re-run this script" -ForegroundColor White
} else {
    Write-Host "✓ No updates needed - all templates already have logos" -ForegroundColor Green
}
