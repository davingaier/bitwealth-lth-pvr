# Deploy Website Fix - Registration Flow Redirects
# Date: January 7, 2026
# Issue: Form went blank after registration instead of redirecting to ID upload

Write-Host "=== BitWealth Website Deployment - Registration Fix ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Fixed Files:" -ForegroundColor Yellow
Write-Host "  - register.html: Fixed redirect path" -ForegroundColor Gray
Write-Host "  - login.html: Fixed all redirect paths" -ForegroundColor Gray
Write-Host "  - upload-kyc.html: Fixed redirect paths" -ForegroundColor Gray
Write-Host ""

# Get current directory
$websiteDir = Join-Path $PSScriptRoot "website"

if (-not (Test-Path $websiteDir)) {
    Write-Host "ERROR: website directory not found!" -ForegroundColor Red
    exit 1
}

Write-Host "Website directory: $websiteDir" -ForegroundColor Green
Write-Host ""

# Check which hosting provider is being used
Write-Host "Choose deployment method:" -ForegroundColor Cyan
Write-Host "1. Netlify (via drag-and-drop in browser)"
Write-Host "2. Vercel (via CLI)"
Write-Host "3. Cloudflare Pages (via wrangler)"
Write-Host "4. Manual - just show me the files to upload"
Write-Host ""

$choice = Read-Host "Enter choice (1-4)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "=== Netlify Deployment ===" -ForegroundColor Cyan
        Write-Host "1. Go to: https://app.netlify.com" -ForegroundColor Yellow
        Write-Host "2. Find your site (bitwealth.co.za or bitwealth-xxx.netlify.app)" -ForegroundColor Yellow
        Write-Host "3. Click 'Deploys' tab" -ForegroundColor Yellow
        Write-Host "4. Drag and drop the 'website' folder to deploy" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Website folder location: $websiteDir" -ForegroundColor Green
        Write-Host ""
        Write-Host "Opening folder in Explorer..." -ForegroundColor Gray
        explorer $websiteDir
    }
    "2" {
        Write-Host ""
        Write-Host "=== Vercel Deployment ===" -ForegroundColor Cyan
        Write-Host "Deploying via Vercel CLI..." -ForegroundColor Yellow
        Set-Location $websiteDir
        vercel --prod
    }
    "3" {
        Write-Host ""
        Write-Host "=== Cloudflare Pages Deployment ===" -ForegroundColor Cyan
        Write-Host "Deploying via Wrangler..." -ForegroundColor Yellow
        npx wrangler pages deploy $websiteDir
    }
    "4" {
        Write-Host ""
        Write-Host "=== Files to Upload ===" -ForegroundColor Cyan
        Write-Host "Upload these files to your production server:" -ForegroundColor Yellow
        Write-Host "  - website/register.html" -ForegroundColor Green
        Write-Host "  - website/login.html" -ForegroundColor Green
        Write-Host "  - website/upload-kyc.html" -ForegroundColor Green
        Write-Host ""
        Write-Host "Opening folder in Explorer..." -ForegroundColor Gray
        explorer $websiteDir
    }
    default {
        Write-Host "Invalid choice!" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=== After Deployment ===" -ForegroundColor Cyan
Write-Host "Test the flow:" -ForegroundColor Yellow
Write-Host "1. Fill out prospect form on homepage" -ForegroundColor Gray
Write-Host "2. Receive email with registration link" -ForegroundColor Gray
Write-Host "3. Create password + accept agreements" -ForegroundColor Gray
Write-Host "4. Should redirect to login page (https://bitwealth.co.za/login.html)" -ForegroundColor Gray
Write-Host "5. After login, should redirect to ID upload (https://bitwealth.co.za/upload-kyc.html)" -ForegroundColor Gray
Write-Host ""
Write-Host "Deployment script complete!" -ForegroundColor Green
