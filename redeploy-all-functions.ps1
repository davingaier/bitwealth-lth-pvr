# redeploy-all-functions.ps1
# Redeploy all Edge Functions after updating secret key names

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Redeploying All Edge Functions" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to the project directory
Set-Location "C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr"

# List of all Edge Functions to redeploy
$functions = @(
    "admin-create-user",
    "adv-build-transactions",
    "chart-narrative",
    "create-daily-rules",
    "ef_alert_digest",
    "ef_bt_execute",
    "ef_create_order_intents",
    "ef_execute_orders",
    "ef_fee_invoice_email",
    "ef_fee_monthly_close",
    "ef_fetch_ci_bands",
    "ef_generate_decisions",
    "ef_poll_orders",
    "ef_post_ledger_and_balances",
    "ef_std_dca_roll",
    "ef_valr_deposit_scan",
    "ef_valr_ws_monitor",
    "real-txs-allocate-deposits",
    "real-txs-extract",
    "real-txs-sync-valr",
    "std-build-transactions",
    "valr-balance-finalizer",
    "valr-balances",
    "valr-convert-zar",
    "valr-execute-orders",
    "valr-fees-harvester",
    "valr-poll-orders",
    "valr-preview-orders",
    "ef_valr_subaccounts"
)

$successCount = 0
$failCount = 0
$skippedCount = 0

foreach ($func in $functions) {
    $funcPath = "supabase\functions\$func"
    
    if (Test-Path $funcPath) {
        Write-Host "Deploying: $func" -ForegroundColor Yellow
        
        try {
            # Deploy the function
            $output = supabase functions deploy $func --project-ref wqnmxpooabmedvtackji 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  [SUCCESS] $func deployed" -ForegroundColor Green
                $successCount++
            } else {
                Write-Host "  [FAILED] $func" -ForegroundColor Red
                Write-Host "  Error: $output" -ForegroundColor Red
                $failCount++
            }
        }
        catch {
            Write-Host "  [FAILED] $func - $_" -ForegroundColor Red
            $failCount++
        }
    } else {
        Write-Host "  [SKIPPED] $func (path not found)" -ForegroundColor Gray
        $skippedCount++
    }
    
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Successful: $successCount" -ForegroundColor Green
Write-Host "Failed: $failCount" -ForegroundColor Red
Write-Host "Skipped: $skippedCount" -ForegroundColor Gray
Write-Host "Total: $($functions.Count)" -ForegroundColor Cyan
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "[WARNING] Some deployments failed. Check the errors above." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "[SUCCESS] All Edge Functions deployed successfully!" -ForegroundColor Green
    exit 0
}
