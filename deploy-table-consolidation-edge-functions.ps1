# Deploy Updated Edge Functions (Table Consolidation Migration - Phase 4)
# Updates 8 edge functions to use new public.customer_strategies table

$PROJECT_REF = "wqnmxpooabmedvtackji"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying Edge Functions (Day 4)" -ForegroundColor Cyan
Write-Host "Table Consolidation Migration v0.6.23" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Deploy in priority order (critical trading pipeline first)

Write-Host "[1/8] Deploying ef_generate_decisions (CRITICAL - daily trading pipeline)..." -ForegroundColor Yellow
supabase functions deploy ef_generate_decisions --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { 
    Write-Host "FAILED! Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "✓ SUCCESS" -ForegroundColor Green
Write-Host ""

Write-Host "[2/8] Deploying ef_execute_orders (CRITICAL - order execution)..." -ForegroundColor Yellow
supabase functions deploy ef_execute_orders --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { 
    Write-Host "FAILED! Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "✓ SUCCESS" -ForegroundColor Green
Write-Host ""

Write-Host "[3/8] Deploying ef_deposit_scan (CRITICAL - customer onboarding)..." -ForegroundColor Yellow
supabase functions deploy ef_deposit_scan --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { 
    Write-Host "FAILED! Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "✓ SUCCESS" -ForegroundColor Green
Write-Host ""

Write-Host "[4/8] Deploying ef_confirm_strategy (HIGH - customer strategy creation)..." -ForegroundColor Yellow
supabase functions deploy ef_confirm_strategy --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { 
    Write-Host "FAILED! Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "✓ SUCCESS" -ForegroundColor Green
Write-Host ""

Write-Host "[5/8] Deploying ef_balance_reconciliation (MEDIUM - balance sync)..." -ForegroundColor Yellow
supabase functions deploy ef_balance_reconciliation --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { 
    Write-Host "FAILED! Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "✓ SUCCESS" -ForegroundColor Green
Write-Host ""

Write-Host "[6/8] Deploying ef_fee_monthly_close (MEDIUM - monthly fee processing)..." -ForegroundColor Yellow
supabase functions deploy ef_fee_monthly_close --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { 
    Write-Host "FAILED! Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "✓ SUCCESS" -ForegroundColor Green
Write-Host ""

Write-Host "[7/8] Deploying ef_monthly_statement_generator (LOW - monthly statements)..." -ForegroundColor Yellow
supabase functions deploy ef_monthly_statement_generator --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { 
    Write-Host "FAILED! Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "✓ SUCCESS" -ForegroundColor Green
Write-Host ""

Write-Host "[8/8] Deploying ef_generate_statement (LOW - on-demand statements)..." -ForegroundColor Yellow
supabase functions deploy ef_generate_statement --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { 
    Write-Host "FAILED! Aborting deployment." -ForegroundColor Red
    exit 1
}
Write-Host "✓ SUCCESS" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "ALL 8 EDGE FUNCTIONS DEPLOYED!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Monitor alerts for next 24 hours" -ForegroundColor White
Write-Host "  2. Test critical flows:" -ForegroundColor White
Write-Host "     - Daily decision generation (03:05 UTC)" -ForegroundColor White
Write-Host "     - Order execution (03:15 UTC)" -ForegroundColor White
Write-Host "     - Deposit detection (every 5 min)" -ForegroundColor White
Write-Host "  3. Update RPC functions (Day 5-6)" -ForegroundColor White
Write-Host "  4. Update UI components (Day 7)" -ForegroundColor White
Write-Host ""
Write-Host "Rollback: If issues occur, redeploy from git commit" -ForegroundColor Yellow
Write-Host "  git checkout HEAD~1 supabase/functions/" -ForegroundColor Gray
Write-Host "  ./redeploy-all-functions.ps1" -ForegroundColor Gray
Write-Host ""
