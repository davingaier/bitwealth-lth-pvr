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
# Plan: 'gross'      -> all fees zero (drives the reconstruction & drill-down)
#       'platform'   -> platform 0.75% on contributions + perf 10% HWM (legacy product)
#       'management' -> management 1% p.a. on NAV + perf 10% HWM (current product)
function Invoke-Sim {
    param([string]$Start, [string]$Plan)
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
    if ($Plan -eq 'gross') {
        # GROSS run: zero every fee so fee-model.html can layer its own structure on
        # top without double-counting the simulator's defaults. Force platform plan so
        # no management fee is applied either.
        $body.fee_plan             = 'platform'
        $body.platform_fee_rate    = 0
        $body.performance_fee_rate = 0
        $body.trade_fee_rate       = 0
        $body.contrib_fee_rate     = 0
    }
    elseif ($Plan -eq 'management') {
        # MANAGEMENT run: 1% p.a. on NAV + perf 10% HWM (trade 8bps, contrib 18bps).
        $body.fee_plan             = 'management'
        $body.management_fee_rate  = 0.01
    }
    else {
        # PLATFORM run: platform 0.75% on contributions + perf 10% HWM.
        $body.fee_plan             = 'platform'
    }
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
$grossArrays   = @{}
$netArrays     = @{}   # platform-fee net
$netMgmtArrays = @{}   # management-fee net
$dailyDefs = @(
    @{ label = "5yr";  start = "2021-06-10" },
    @{ label = "10yr"; start = "2016-06-10" }
)
foreach ($d in $dailyDefs) {
    Write-Host "Fetching $($d.label) GROSS daily..." -NoNewline
    $g = Invoke-Sim -Start $d.start -Plan 'gross'
    $grossArrays[$d.label] = ConvertTo-DailyLiteral $g.daily
    Write-Host " $($g.daily.Count) days"

    Write-Host "Fetching $($d.label) PLATFORM net daily..." -NoNewline
    $n = Invoke-Sim -Start $d.start -Plan 'platform'
    $netArrays[$d.label] = ConvertTo-DailyLiteral $n.daily
    Write-Host " net NAV `$$([math]::Round($n.final_nav_usd,0))"

    Write-Host "Fetching $($d.label) MANAGEMENT net daily..." -NoNewline
    $m = Invoke-Sim -Start $d.start -Plan 'management'
    $netMgmtArrays[$d.label] = ConvertTo-DailyLiteral $m.daily
    Write-Host " net NAV `$$([math]::Round($m.final_nav_usd,0))"
}

# -- Helper: from a NET sim row, derive the per-day exchange-rebate series -----
#   Per-day BitWealth exchange rebate = 50% of ALL THREE VALR fee legs for that day:
#     - BTC/USDT trade fee     : charged in BTC -> convert at that day's BTC price
#     - ZAR/USDT contribution  : exchange_fees_paid_usdt (contribution days only)
#     - USDPC<->USDT conversion: usdpc_conversion_fee_usdt (buy-funding + idle sweep)
#   Summed across days = the period's total rebate, so the daily series ties EXACTLY
#   to the matching anchor's exchRebate.
function Get-RebatePairs {
    param($Row)
    $pairs = @(); $total = 0.0
    foreach ($d in $Row.daily) {
        $btcFeeUsd = [double]$d.exchange_fees_paid_btc * [double]$d.price_usd
        $usdtFee   = [double]$d.exchange_fees_paid_usdt
        $usdpcFee  = 0.0
        if (($d.PSObject.Properties.Name -contains 'usdpc_conversion_fee_usdt') -and $d.usdpc_conversion_fee_usdt) {
            $usdpcFee = [double]$d.usdpc_conversion_fee_usdt
        }
        $reb = ($btcFeeUsd + $usdtFee + $usdpcFee) * 0.5
        $total += $reb
        if ($reb -gt 0) { $pairs += "['$($d.trade_date)',$([math]::Round($reb,4))]" }
    }
    return [pscustomobject]@{ pairs = ($pairs -join ','); total = [math]::Round($total, 2) }
}

# -- Helper: monthly-sampled NET NAV (first trading day of each calendar month) --
function Get-NetMonthlyPairs {
    param($Row)
    $pairs = @(); $seen = ''
    foreach ($d in $Row.daily) {
        $ym = $d.trade_date.Substring(0,7)
        if ($ym -ne $seen) { $pairs += "['$($d.trade_date)',$([math]::Round([double]$d.nav_usd,2))]"; $seen = $ym }
    }
    return ($pairs -join ',')
}

# -- 3. Authoritative anchors for all five fee-model periods — BOTH plans -------
$anchorDefs = @(
    @{ label = "1 Year";   start = "2025-06-10" },
    @{ label = "3 Years";  start = "2023-06-10" },
    @{ label = "5 Years";  start = "2021-06-10" },
    @{ label = "7 Years";  start = "2019-06-10" },
    @{ label = "10 Years"; start = "2016-06-10" }
)
$pltAnchorLines = @(); $pltRebateLines = @(); $pltNetMonthlyLines = @()
$mgAnchorLines  = @(); $mgRebateLines  = @(); $mgNetMonthlyLines  = @()
foreach ($a in $anchorDefs) {
    # PLATFORM plan
    Write-Host "Anchor $($a.label) [platform]..." -NoNewline
    $rp = Invoke-Sim -Start $a.start -Plan 'platform'
    $rebP = Get-RebatePairs -Row $rp
    $pltRebateLines     += "  ""$($a.label)"": [$($rebP.pairs)]"
    $pltNetMonthlyLines += "  ""$($a.label)"": [$(Get-NetMonthlyPairs -Row $rp)]"
    $pltAnchorLines += @"
  "$($a.label)": {
    invested:    $([math]::Round($rp.total_contrib_gross_usdt, 2)),
    netNav:      $([math]::Round($rp.final_nav_usd, 2)),
    platformFee: $([math]::Round($rp.total_platform_fees_usdt, 2)),
    perfFee:     $([math]::Round($rp.total_performance_fees_usdt, 2)),
    exchRebate:  $($rebP.total),
    days:        $($rp.days)
  }
"@
    Write-Host " net NAV `$$([math]::Round($rp.final_nav_usd,0)) - plt `$$([math]::Round($rp.total_platform_fees_usdt,0)) - prf `$$([math]::Round($rp.total_performance_fees_usdt,0)) - rebate `$$($rebP.total)"

    # MANAGEMENT plan
    Write-Host "Anchor $($a.label) [management]..." -NoNewline
    $rm = Invoke-Sim -Start $a.start -Plan 'management'
    $rebM = Get-RebatePairs -Row $rm
    $mgRebateLines     += "  ""$($a.label)"": [$($rebM.pairs)]"
    $mgNetMonthlyLines += "  ""$($a.label)"": [$(Get-NetMonthlyPairs -Row $rm)]"
    $mgAnchorLines += @"
  "$($a.label)": {
    invested:      $([math]::Round($rm.total_contrib_gross_usdt, 2)),
    netNav:        $([math]::Round($rm.final_nav_usd, 2)),
    managementFee: $([math]::Round($rm.total_management_fees_usdt, 2)),
    perfFee:       $([math]::Round($rm.total_performance_fees_usdt, 2)),
    exchRebate:    $($rebM.total),
    days:          $($rm.days)
  }
"@
    Write-Host " net NAV `$$([math]::Round($rm.final_nav_usd,0)) - mgmt `$$([math]::Round($rm.total_management_fees_usdt,0)) - prf `$$([math]::Round($rm.total_performance_fees_usdt,0)) - rebate `$$($rebM.total)"
}
$pltAnchorsJs = $pltAnchorLines -join ",`n"; $pltRebateJs = $pltRebateLines -join ",`n"; $pltNetMonthlyJs = $pltNetMonthlyLines -join ",`n"
$mgAnchorsJs  = $mgAnchorLines  -join ",`n"; $mgRebateJs  = $mgRebateLines  -join ",`n"; $mgNetMonthlyJs  = $mgNetMonthlyLines  -join ",`n"

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
// PLATFORM-fee NET series (legacy product: platform 0.75% + perf 10% HWM):
const _lth5_daily_net  = [$($netArrays['5yr'])];
const _lth10_daily_net = [$($netArrays['10yr'])];
//
// MANAGEMENT-fee NET series (current product: management 1% p.a. on NAV + perf 10% HWM):
const _lth5_daily_net_mgmt  = [$($netMgmtArrays['5yr'])];
const _lth10_daily_net_mgmt = [$($netMgmtArrays['10yr'])];
//
// Authoritative per-period figures — PLATFORM plan (platform 0.75%, perf 10% HWM,
// trade 8bps, contrib 18bps, USDPC 10% APY ON). fee-model.html snaps its summary to
// these when the Platform Fee plan is selected so the headline matches the back-tester.
const _lthAnchors = {
$pltAnchorsJs
};
//
// Authoritative per-period figures — MANAGEMENT plan (management 1% p.a. on NAV,
// perf 10% HWM, trade 8bps, contrib 18bps, USDPC 10% APY ON). fee-model.html snaps its
// summary to these when the Management Fee plan is selected (matches the ABC One-Pager).
const _lthMgmtAnchors = {
$mgAnchorsJs
};
//
// Per-day BitWealth exchange rebate (USD) — PLATFORM plan. Sums to _lthAnchors[...].exchRebate.
const _lthRebateDaily = {
$pltRebateJs
};
//
// Per-day BitWealth exchange rebate (USD) — MANAGEMENT plan. Sums to _lthMgmtAnchors[...].exchRebate.
const _lthMgmtRebateDaily = {
$mgRebateJs
};
//
// Per-period monthly NET NAV — PLATFORM plan (drives the NAV chart when Platform plan selected).
const _lthNetMonthly = {
$pltNetMonthlyJs
};
//
// Per-period monthly NET NAV — MANAGEMENT plan (drives the NAV chart when Management plan selected).
const _lthMgmtNetMonthly = {
$mgNetMonthlyJs
};
"@

$outPath = Join-Path $PSScriptRoot "docs\chart-data-daily.js"
[System.IO.File]::WriteAllText($outPath, $out, [System.Text.Encoding]::UTF8)
$sz = [math]::Round((Get-Item $outPath).Length / 1024, 1)
Write-Host ""
Write-Host "Written $outPath ($sz KB)"
