# =====================================================================
# deploy-alert-events-relocation.ps1
# ---------------------------------------------------------------------
# Redeploys every edge function whose source was modified by the
# 2026-05-02 alert_events relocation:
#   - 4 stale per-EF clones of alerting.ts
#   - 8 EFs with direct sb.schema("lth_pvr").from("alert_events")
#   - All EFs that import the canonical _shared/alerting.ts
#
# IMPORTANT: Pipeline / cron / service-to-service functions are
# deployed with --no-verify-jwt. User-facing functions keep default JWT
# verification.
# =====================================================================

$ErrorActionPreference = "Continue"
$projectRef = "wqnmxpooabmedvtackji"

Set-Location "C:\Users\davin\Dropbox\BitWealth\bitwealth-lth-pvr\bitwealth-lth-pvr"

# Internal / cron / service-to-service (need --no-verify-jwt)
$internal = @(
    "ef_alert_digest",
    "ef_atms_monitor",
    "ef_auto_convert_btc_to_usdt",
    "ef_bt_execute",
    "ef_calculate_interim_performance_fee",
    "ef_calculate_performance_fees",
    "ef_collect_annual_fees",
    "ef_convert_platform_fee_btc",
    "ef_convert_zar_to_usdt",
    "ef_create_order_intents",
    "ef_deposit_scan",
    "ef_execute_orders",
    "ef_fee_monthly_close",
    "ef_fetch_ci_bands",
    "ef_fetch_rb_bands",
    "ef_generate_decisions",
    "ef_generate_statement",
    "ef_market_fallback",
    "ef_poll_orders",
    "ef_post_ledger_and_balances",
    "ef_process_withdrawal_queue",
    "ef_renew_rb_token",
    "ef_revert_withdrawal_fees",
    "ef_rotate_api_key_notifications",
    "ef_sync_valr_transactions",
    "ef_tfs_screen",
    "ef_transfer_accumulated_fees",
    "ef_valr_ws_monitor"
)

# Public / authenticated user-facing (default JWT verification)
$publicFns = @(
    "ef_link_bank_account",
    "ef_request_withdrawal",
    "ef_revert_withdrawal",
    "ef_store_customer_api_keys",
    "ef_valr_create_subaccount"
)

$ok = 0; $fail = 0; $skip = 0

function Deploy-Function {
    param([string]$name, [bool]$noVerifyJwt)
    $path = "supabase\functions\$name"
    if (-not (Test-Path $path)) {
        Write-Host "SKIP (missing): $name" -ForegroundColor DarkYellow
        $script:skip++; return
    }
    $jwtFlag = if ($noVerifyJwt) { "--no-verify-jwt" } else { "" }
    Write-Host "Deploying: $name $jwtFlag" -ForegroundColor Yellow
    if ($noVerifyJwt) {
        $out = supabase functions deploy $name --project-ref $projectRef --no-verify-jwt 2>&1
    } else {
        $out = supabase functions deploy $name --project-ref $projectRef 2>&1
    }
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK" -ForegroundColor Green
        $script:ok++
    } else {
        Write-Host "  FAILED: $out" -ForegroundColor Red
        $script:fail++
    }
}

Write-Host "`n--- Internal / cron / service functions (--no-verify-jwt) ---`n" -ForegroundColor Cyan
foreach ($f in $internal) { Deploy-Function -name $f -noVerifyJwt $true }

Write-Host "`n--- Public / user-facing functions (default JWT) ---`n" -ForegroundColor Cyan
foreach ($f in $publicFns) { Deploy-Function -name $f -noVerifyJwt $false }

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Deploy summary: $ok OK, $fail FAILED, $skip SKIPPED" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
