# Deploy Balance Reconciliation Function
# Purpose: Deploy automated balance reconciliation edge function
# Created: 2026-01-05

Write-Host "Deploying ef_balance_reconciliation..." -ForegroundColor Cyan

supabase functions deploy ef_balance_reconciliation `
  --project-ref wqnmxpooabmedvtackji `
  --no-verify-jwt

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ ef_balance_reconciliation deployed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Deployment failed" -ForegroundColor Red
    exit 1
}

Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Apply migration: supabase db push --db-url [connection_string]" -ForegroundColor White
Write-Host "2. Test manually: curl -X POST https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_balance_reconciliation -H 'Authorization: Bearer [anon_key]'" -ForegroundColor White
Write-Host "3. Verify pg_cron job: SELECT * FROM cron.job WHERE jobname = 'balance-reconciliation-hourly';" -ForegroundColor White
