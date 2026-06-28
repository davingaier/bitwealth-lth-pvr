# gen-chart-js-daily.ps1
# Generates docs/chart-data-daily.js for fee-model.html.
#
# Produces THREE things from the LTH PVR simulator (progressive variation):
#   1. _lth5_daily / _lth10_daily         — GROSS daily NAV (all fees = 0, USDPC on).
#                                           Drives the fee-model's return-extraction
#                                           reconstruction + Detail Explorer drill-down.
#   2. _lth5_daily_net / _lth10_daily_net — NET daily NAV with the real product fees
#                                           (platform 0.75%, perf 10% HWM, trade 8bps,
#                                           contrib 18bps, USDPC 10% APY on). Drives the
#                                           NAV-growth chart's 5yr/10yr lines when the
#                                           fee-model is in its default product config.
#   3. _lthAnchors                        — Authoritative per-period summary figures
#                                           (net NAV + fee breakdown) for ALL five
#                                           fee-model periods. fee-model.html snaps its
#                                           summary to these so the headline Ending NAV
#                                           matches the public back-tester EXACTLY.
#
# Run this once after any back-test / strategy change. Requires $env:SUPABASE_ANON_KEY.
#
# Usage:
#   $env:SUPABASE_ANON_KEY = "your-anon-key"
#   .\gen-chart-js-daily.ps1

$url = "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_run_lth_pvr_simulator"
$key = $env:SUPABASE_ANON_KEY
if (!$key) { Write-Error "Set `$env:SUPABASE_ANON_KEY before running."; exit 1 }

$headers = @{ "Authorization" = "Bearer $key"; "Content-Type" = "application/json" }
$progId  = "f7ec6155-5b31-4ba2-9d44-f3516f76c1a7"
$endDate = "2026-06-09"   # matches the public back-tester / Admin simulator window

# -- Helper: run the simulator and return the progressive result row ----------
function Invoke-Sim {
    param([string]$Start, [bool]$Gross)
    $body = @{
        start_date        = $Start
        end_date          = $endDate
        upfront_usd       = 2400
        monthly_usd       = 200
        variation_ids     = @($progId)
        # USDPC ON: idle USDT earns ~10% APY (matches the public back-tester and the
        # Commercial Fee Model's intended baseline).
        usdpc_enabled     = $true
        usdpc_apy_percent = 10
    }
    if ($Gross) {
        # GROSS run: zero every fee so fee-model.html can layer its own structure on
        # top without double-counting the simulator's defaults.
        $body.platform_fee_rate    = 0
        $body.performance_fee_rate = 0
        $body.trade_fee_rate       = 0
        $body.contrib_fee_rate     = 0
    }
    # NET run (Gross = $false): omit the overrides so the simulator applies the real
    # product fees (platform 0.75%, perf 10%, trade 8bps, contrib 18bps).
    $json = $body | ConvertTo-Json
    try {
        $r = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $json
    } catch {
        Write-Error "API call failed for $Start..$endDate : $_"; exit 1
    }
    $row = $r.results | Where-Object { $_.variation_name -eq "progressive" } | Select-Object -First 1
    if (!$row) { Write-Error "No progressive variation in response for $Start"; exit 1 }
    return $row
}

# -- Helper: turn a daily array into a compact JS literal ----------------------
function ConvertTo-DailyLiteral {
    param($Daily)
    ($Daily | ForEach-Object { "['$($_.trade_date)',$([math]::Round($_.nav_usd,2))]" }) -join ","
}

# -- 1 + 2. Gross + net daily series for the 5yr and 10yr chart/drill-down -----
$grossArrays = @{}
$netArrays   = @{}
$dailyDefs = @(
    @{ label = "5yr";  start = "2021-06-10" },
    @{ label = "10yr"; start = "2016-06-10" }
)
foreach ($d in $dailyDefs) {
    Write-Host "Fetching $($d.label) GROSS daily..." -NoNewline
    $g = Invoke-Sim -Start $d.start -Gross $true
    $grossArrays[$d.label] = ConvertTo-DailyLiteral $g.daily
    Write-Host " $($g.daily.Count) days"

    Write-Host "Fetching $($d.label) NET daily..." -NoNewline
    $n = Invoke-Sim -Start $d.start -Gross $false
    $netArrays[$d.label] = ConvertTo-DailyLiteral $n.daily
    Write-Host " $($n.daily.Count) days - net NAV `$$([math]::Round($n.final_nav_usd,0))"
}

# -- 3. Authoritative anchors for all five fee-model periods (NET runs) --------
$anchorDefs = @(
    @{ label = "1 Year";   start = "2025-06-10" },
    @{ label = "3 Years";  start = "2023-06-10" },
    @{ label = "5 Years";  start = "2021-06-10" },
    @{ label = "7 Years";  start = "2019-06-10" },
    @{ label = "10 Years"; start = "2016-06-10" }
)
$anchorLines = @()
$rebateLines = @()
foreach ($a in $anchorDefs) {
    Write-Host "Fetching anchor: $($a.label)..." -NoNewline
    $row = Invoke-Sim -Start $a.start -Gross $false

    # Per-day BitWealth exchange rebate = 50% of ALL THREE VALR fee legs for that day:
    #   - BTC/USDT trade fee     : charged in BTC -> convert at that day's BTC price
    #   - ZAR/USDT contribution  : exchange_fees_paid_usdt (contribution days only)
    #   - USDPC<->USDT conversion: usdpc_conversion_fee_usdt (buy-funding + idle sweep)
    # Summed across days = the period's total rebate, so the daily series ties EXACTLY
    # to _lthAnchors[...].exchRebate. (Order sizes vary daily, so the rebate varies daily.)
    $rebatePairs = @()
    $rebateTotal = 0.0
    foreach ($d in $row.daily) {
        $btcFeeUsd = [double]$d.exchange_fees_paid_btc * [double]$d.price_usd
        $usdtFee   = [double]$d.exchange_fees_paid_usdt
        $usdpcFee  = 0.0
        if (($d.PSObject.Properties.Name -contains 'usdpc_conversion_fee_usdt') -and $d.usdpc_conversion_fee_usdt) {
            $usdpcFee = [double]$d.usdpc_conversion_fee_usdt
        }
        $reb = ($btcFeeUsd + $usdtFee + $usdpcFee) * 0.5
        $rebateTotal += $reb
        if ($reb -gt 0) { $rebatePairs += "['$($d.trade_date)',$([math]::Round($reb,4))]" }
    }
    $rebate = [math]::Round($rebateTotal, 2)
    $rebateLines += "  ""$($a.label)"": [$($rebatePairs -join ',')]"

    $anchorLines += @"
  "$($a.label)": {
    invested:    $([math]::Round($row.total_contrib_gross_usdt, 2)),
    netNav:      $([math]::Round($row.final_nav_usd, 2)),
    platformFee: $([math]::Round($row.total_platform_fees_usdt, 2)),
    perfFee:     $([math]::Round($row.total_performance_fees_usdt, 2)),
    exchRebate:  $rebate,
    days:        $($row.days)
  }
"@
    Write-Host " net NAV `$$([math]::Round($row.final_nav_usd,0)) - plt `$$([math]::Round($row.total_platform_fees_usdt,0)) - prf `$$([math]::Round($row.total_performance_fees_usdt,0)) - rebate `$$rebate"
}
$anchorsJs = $anchorLines -join ",`n"
$rebateJs  = $rebateLines -join ",`n"

$today = Get-Date -Format 'yyyy-MM-dd'
$out = @"
// Auto-generated DAILY chart data — $today
// Source: ef_run_lth_pvr_simulator (progressive variation), USDPC 10% APY ON,
//         window through $endDate (matches the public back-tester / Admin simulator).
// To regenerate: .\gen-chart-js-daily.ps1
//
// GROSS series (all fees = 0) — drives the return-extraction reconstruction & drill-down:
const _lth5_daily      = [$($grossArrays['5yr'])];
const _lth10_daily     = [$($grossArrays['10yr'])];
//
// NET series (real product fees applied) — drives the NAV chart in default config:
const _lth5_daily_net  = [$($netArrays['5yr'])];
const _lth10_daily_net = [$($netArrays['10yr'])];
//
// Authoritative per-period figures from the simulator WITH the real product fees
// (platform 0.75%, performance 10% HWM, trade 8bps, contrib 18bps, USDPC 10% APY ON).
// fee-model.html snaps its summary to these for the default config so the headline
// Ending NAV / fee breakdown match the public back-tester EXACTLY.
const _lthAnchors = {
$anchorsJs
};
//
// Per-day BitWealth exchange rebate (USD) for each period — 50% of all three VALR fee
// legs (BTC/USDT trade + ZAR/USDT contribution + USDPC<->USDT conversion), reflecting the
// REAL daily order sizes. Each period's series sums to _lthAnchors[...].exchRebate. Drives
// the per-day Exchange Rebate in the Detail Explorer & CSV export (default product config only).
const _lthRebateDaily = {
$rebateJs
};
"@

$outPath = Join-Path $PSScriptRoot "docs\chart-data-daily.js"
[System.IO.File]::WriteAllText($outPath, $out, [System.Text.Encoding]::UTF8)
$sz = [math]::Round((Get-Item $outPath).Length / 1024, 1)
Write-Host ""
Write-Host "Written $outPath ($sz KB)"
