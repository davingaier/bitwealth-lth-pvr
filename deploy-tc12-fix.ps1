# Deploy updated edge functions for TC1.2 steps 6 & 7 fix
# Purpose: Add auto-conversion of BTC platform fees to USDT after transfer

Write-Host "Deploying updated edge functions..." -ForegroundColor Cyan

# Deploy new conversion function
Write-Host "`n1. Deploying ef_convert_platform_fee_btc..." -ForegroundColor Yellow
supabase functions deploy ef_convert_platform_fee_btc `
  --project-ref wqnmxpooabmedvtackji `
  --no-verify-jwt

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ef_convert_platform_fee_btc deployment failed" -ForegroundColor Red
    exit 1
}

# Deploy updated ef_post_ledger_and_balances
Write-Host "`n2. Deploying ef_post_ledger_and_balances..." -ForegroundColor Yellow
supabase functions deploy ef_post_ledger_and_balances `
  --project-ref wqnmxpooabmedvtackji `
  --no-verify-jwt

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ef_post_ledger_and_balances deployment failed" -ForegroundColor Red
    exit 1
}

# Deploy updated ef_transfer_accumulated_fees
Write-Host "`n3. Deploying ef_transfer_accumulated_fees..." -ForegroundColor Yellow
supabase functions deploy ef_transfer_accumulated_fees `
  --project-ref wqnmxpooabmedvtackji `
  --no-verify-jwt

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ ef_transfer_accumulated_fees deployment failed" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ All functions deployed successfully!" -ForegroundColor Green
Write-Host "`nChanges:" -ForegroundColor Cyan
Write-Host "  • Created ef_convert_platform_fee_btc (new function)" -ForegroundColor White
Write-Host "  • Updated ef_post_ledger_and_balances (triggers conversion after transfer)" -ForegroundColor White
Write-Host "  • Updated ef_transfer_accumulated_fees (triggers conversion after monthly batch)" -ForegroundColor White
Write-Host "`nTC1.2 Steps 6 & 7 now functional - BTC platform fees will auto-convert to USDT" -ForegroundColor Green
