# deploy-marketing-charts.ps1
#
# Deploys the self-refreshing LTH PVR marketing charts:
#   1. Applies the DB migration (public.marketing_chart_data table + reader RPC +
#      monthly pg_cron job).
#   2. Deploys the ef_refresh_marketing_charts edge function.
#   3. Fires one immediate run to populate the chart data now (trailing 5-year
#      back-test, $2,400 upfront + $200/month, USDPC on).
#
# Prereqs:
#   - Supabase CLI logged in:  supabase login   (paste your access token)
#   - $env:SUPABASE_SERVICE_ROLE_KEY set (used only for the immediate populate call)
#
# Usage:  .\deploy-marketing-charts.ps1

$ErrorActionPreference = 'Stop'
$ProjectRef  = 'wqnmxpooabmedvtackji'
$FunctionUrl = "https://$ProjectRef.supabase.co/functions/v1/ef_refresh_marketing_charts"

Write-Host "==> 1/3  Applying DB migration (table + RPC + monthly cron)..." -ForegroundColor Cyan
# db push applies any un-applied migrations, including 20260711_marketing_chart_data.sql.
supabase db push

Write-Host "==> 2/3  Deploying ef_refresh_marketing_charts (cron/service-to-service, no JWT)..." -ForegroundColor Cyan
supabase functions deploy ef_refresh_marketing_charts --project-ref $ProjectRef --no-verify-jwt

Write-Host "==> 3/3  Triggering initial populate (runs the trailing-5yr back-test)..." -ForegroundColor Cyan
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
    Write-Warning "SUPABASE_SERVICE_ROLE_KEY not set — skipping initial populate."
    Write-Warning "Populate manually later with the same Invoke-RestMethod call, or wait for the 1st-of-month cron."
} else {
    $resp = Invoke-RestMethod -Method Post -Uri $FunctionUrl `
        -Headers @{ Authorization = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"; 'Content-Type' = 'application/json' } `
        -Body '{}'
    Write-Host "Populate response:" -ForegroundColor Green
    $resp | ConvertTo-Json -Depth 6
}

Write-Host "`nDone. Reload website/lth-pvr.html — the charts + narrative now read from public.get_lth_pvr_marketing_chart()." -ForegroundColor Green
Write-Host "The 'lth_pvr_refresh_marketing_5yr' cron will refresh on the 1st of each month at 03:00 UTC." -ForegroundColor Green
