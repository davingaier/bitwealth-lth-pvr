# gen-chart-js-daily.ps1
# Generates docs/chart-data-daily.js with DAILY granularity for fee-model.html drill-down.
# Run this once after any back-test update. Requires $env:SUPABASE_ANON_KEY to be set.
#
# Usage:
#   $env:SUPABASE_ANON_KEY = "your-anon-key"
#   .\gen-chart-js-daily.ps1

$url = "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_run_lth_pvr_simulator"
$key = $env:SUPABASE_ANON_KEY
if (!$key) { Write-Error "Set `$env:SUPABASE_ANON_KEY before running."; exit 1 }

$headers = @{ "Authorization" = "Bearer $key"; "Content-Type" = "application/json" }
$progId = "f7ec6155-5b31-4ba2-9d44-f3516f76c1a7"

$periods = @(
    @{ label="5yr";  start="2021-06-10"; end="2026-06-09" },
    @{ label="10yr"; start="2016-06-10"; end="2026-06-09" }
)

$dailyArrays = @{}

foreach ($p in $periods) {
    Write-Host "Fetching $($p.label) daily data..." -NoNewline
    $body = @{
        start_date    = $p.start
        end_date      = $p.end
        upfront_usd   = 2400
        monthly_usd   = 200
        variation_ids = @($progId)
    } | ConvertTo-Json

    try {
        $r = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body
    } catch {
        Write-Error "API call failed: $_"; exit 1
    }

    $progRow = $r.results | Where-Object { $_.variation_name -eq "progressive" } | Select-Object -First 1
    if (!$progRow) { Write-Error "No progressive variation in response"; exit 1 }

    # Save ALL daily points (no downsampling)
    $entries = $progRow.daily | ForEach-Object {
        "['$($_.trade_date)',$([math]::Round($_.nav_usd,2))]"
    }
    $dailyArrays[$p.label] = $entries -join ","
    Write-Host " $($progRow.daily.Count) days"
}

$today = Get-Date -Format 'yyyy-MM-dd'
$out = @"
// Auto-generated DAILY chart data — $today
// Used by fee-model.html Detail Explorer for daily drill-down validation.
// To regenerate: .\gen-chart-js-daily.ps1
const _lth5_daily  = [$($dailyArrays['5yr'])];
const _lth10_daily = [$($dailyArrays['10yr'])];
"@

$outPath = Join-Path $PSScriptRoot "docs\chart-data-daily.js"
[System.IO.File]::WriteAllText($outPath, $out, [System.Text.Encoding]::UTF8)
$sz = [math]::Round((Get-Item $outPath).Length / 1024, 1)
Write-Host "Written $outPath ($sz KB)"
Write-Host ""
Write-Host "Next step: add the following line to fee-model.html before the closing </body>:"
Write-Host "  <script src=`"chart-data-daily.js`"></script>"
Write-Host "(Place it AFTER the chart-data.js script tag)"
