# Deploy ef_convert_platform_fee_btc edge function
# Purpose: Auto-convert BitWealth's collected BTC platform fees to USDT

Write-Host "Deploying ef_convert_platform_fee_btc..." -ForegroundColor Cyan

supabase functions deploy ef_convert_platform_fee_btc `
  --project-ref wqnmxpooabmedvtackji `
  --no-verify-jwt

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ ef_convert_platform_fee_btc deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Deployment failed" -ForegroundColor Red
    exit 1
}
