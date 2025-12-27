# Deploy remaining 20 Edge Functions with new "Secret Key"
# Run this from the project root directory

$PROJECT_REF = "wqnmxpooabmedvtackji"

# List of remaining functions to deploy (excluding the 9 already deployed)
$REMAINING_FUNCTIONS = @(
    "ef_bt_execute",
    "ef_std_dca_roll",
    "ef_fee_monthly_close",
    "ef_fee_invoice_email",
    "ef_valr_deposit_scan",
    "ef_valr_subaccounts",
    "chart-narrative",
    "create-daily-rules",
    "adv-build-transactions",
    "std-build-transactions",
    "real-txs-allocate-deposits",
    "real-txs-extract",
    "real-txs-sync-valr",
    "valr-balance-finalizer",
    "valr-balances",
    "valr-convert-zar",
    "valr-execute-orders",
    "valr-fees-harvester",
    "valr-poll-orders",
    "valr-preview-orders"
)

$deployed = 0
$failed = 0
$skipped = 0

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Deploying $($REMAINING_FUNCTIONS.Count) remaining functions" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

foreach ($func in $REMAINING_FUNCTIONS) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Deploying: $func..." -ForegroundColor Yellow
    
    try {
        $output = supabase functions deploy $func --project-ref $PROJECT_REF 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[SUCCESS] $func deployed" -ForegroundColor Green
            $deployed++
        } else {
            Write-Host "[FAILED] $func - Exit code: $LASTEXITCODE" -ForegroundColor Red
            Write-Host "Output: $output" -ForegroundColor Red
            $failed++
        }
    } catch {
        Write-Host "[ERROR] $func - $_" -ForegroundColor Red
        $failed++
    }
    
    Start-Sleep -Milliseconds 500  # Small delay between deployments
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Deployment Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] Deployed: $deployed" -ForegroundColor Green
Write-Host "[FAILED]  Failed:   $failed" -ForegroundColor Red
Write-Host "[INFO]    Skipped:  $skipped" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

if ($failed -gt 0) {
    Write-Host "Some deployments failed. Check the output above for details." -ForegroundColor Red
    exit 1
} else {
    Write-Host "All functions deployed successfully!" -ForegroundColor Green
    Write-Host "`nTotal deployed functions: $(9 + $deployed) / 29" -ForegroundColor Cyan
    exit 0
}
