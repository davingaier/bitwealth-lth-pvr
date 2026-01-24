# Deploy TC1.7 Optimized Auto-Convert Edge Functions
# Date: 2026-01-24
# Purpose: Deploy updated performance fee functions with automatic BTC conversion

Write-Host "🚀 Deploying TC1.7 Optimized Auto-Convert Functions" -ForegroundColor Cyan
Write-Host ""

$projectRef = "wqnmxpooabmedvtackji"

# Function 1: ef_calculate_performance_fees (triggers automatic conversion)
Write-Host "📦 Deploying ef_calculate_performance_fees..." -ForegroundColor Yellow
supabase functions deploy ef_calculate_performance_fees `
  --project-ref $projectRef `
  --no-verify-jwt

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ ef_calculate_performance_fees deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ ef_calculate_performance_fees deployment failed" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Function 2: ef_auto_convert_btc_to_usdt (new auto_convert action)
Write-Host "📦 Deploying ef_auto_convert_btc_to_usdt..." -ForegroundColor Yellow
supabase functions deploy ef_auto_convert_btc_to_usdt `
  --project-ref $projectRef `
  --no-verify-jwt

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ ef_auto_convert_btc_to_usdt deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ ef_auto_convert_btc_to_usdt deployment failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎉 TC1.7 Deployment Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Changes Deployed:" -ForegroundColor Cyan
Write-Host "  1. ef_calculate_performance_fees: Triggers automatic conversion for insufficient USDT"
Write-Host "  2. ef_auto_convert_btc_to_usdt: New 'auto_convert' action with optimized workflow"
Write-Host ""
Write-Host "✨ Optimization Highlights:" -ForegroundColor Cyan
Write-Host "  • Uses available USDT first before converting BTC"
Write-Host "  • Reduces BTC conversion by up to 50%"
Write-Host "  • No customer approval required (automatic execution)"
Write-Host "  • 3-ledger workflow: partial payment → BTC sale → remaining payment"
Write-Host "  • LIMIT order with MARKET fallback (5-minute monitoring)"
Write-Host ""
Write-Host "📚 Documentation:" -ForegroundColor Cyan
Write-Host "  • Test case: docs/TASK_5_FEE_IMPLEMENTATION_TEST_CASES.md (TC1.7)"
Write-Host "  • Status: ✅ PASS (tested with Customer 47 SQL simulation)"
Write-Host ""
