$url = "https://wqnmxpooabmedvtackji.supabase.co/functions/v1/ef_run_lth_pvr_simulator"
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxbm14cG9vYWJtZWR2dGFja2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQwNTY3OTksImV4cCI6MjA2OTYzMjc5OX0.kiNGXtYrUoeud-rKav-o2Vs5b7BZdgG_GVF6MLWE-zs"
$headers = @{ "Authorization" = "Bearer $key"; "Content-Type" = "application/json" }
$progId = "f7ec6155-5b31-4ba2-9d44-f3516f76c1a7"
$consId = "b8763e40-1bf5-4847-ae6a-f670cbb509e0"

$periods = @(
    @{ label="1yr";  start="2025-03-19" },
    @{ label="2yr";  start="2024-03-19" },
    @{ label="3yr";  start="2023-03-19" },
    @{ label="5yr";  start="2021-03-19" },
    @{ label="7yr";  start="2019-03-19" },
    @{ label="10yr"; start="2016-03-19" }
)

$summary = @()
$chartData = @{}

foreach ($p in $periods) {
    Write-Host "Running $($p.label)..." -NoNewline
    $body = @{
        start_date    = $p.start
        end_date      = "2026-03-19"
        upfront_usd   = 2400
        monthly_usd   = 200
        variation_ids = @($progId, $consId)
    } | ConvertTo-Json
    $r = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body

    # Summary line
    $std = $r.std_dca
    $stdNav  = [math]::Round($std.final_nav_usd, 0)
    $stdInv  = [math]::Round($std.total_contrib_gross_usdt, 0)
    $stdCagr = [math]::Round($std.final_cagr_percent, 1)
    $stdDD   = [math]::Round($std.max_drawdown_percent, 1)
    $stdSh   = [math]::Round($std.sharpe_ratio, 2)
    $stdRoi  = [math]::Round($std.final_roi_percent, 1)
    $summary += "=== $($p.label) ==="
    $summary += "  [STD_DCA]  NAV=$stdNav Inv=$stdInv CAGR=$stdCagr DD=$stdDD Sharpe=$stdSh ROI=$stdRoi"

    foreach ($row in $r.results) {
        $nav    = [math]::Round($row.final_nav_usd, 0)
        $inv    = [math]::Round($row.total_contrib_gross_usdt, 0)
        $cagr   = [math]::Round($row.final_cagr_percent, 1)
        $dd     = [math]::Round($row.max_drawdown_percent, 1)
        $sharpe = [math]::Round($row.sharpe_ratio, 2)
        $roi    = [math]::Round($row.final_roi_percent, 1)
        $summary += "  [$($row.variation_name)]  NAV=$nav Inv=$inv CAGR=$cagr DD=$dd Sharpe=$sharpe ROI=$roi"
    }

    # Save chart data for 5yr and 10yr
    if ($p.label -eq "5yr" -or $p.label -eq "10yr") {
        # Sample every 7th day for chart (weekly granularity) to keep JSON compact
        $progRow = $r.results | Where-Object { $_.variation_name -eq "progressive" } | Select-Object -First 1
        $sampledProg = @()
        $sampledStd  = @()
        for ($i = 0; $i -lt $progRow.daily.Count; $i += 7) {
            $d = $progRow.daily[$i]
            $s = $r.std_dca.daily[$i]
            $sampledProg += @{ t = $d.trade_date; n = [math]::Round($d.nav_usd, 2) }
            $sampledStd  += @{ t = $s.trade_date; n = [math]::Round($s.nav_usd, 2) }
        }
        # Always include the last day
        $lastD = $progRow.daily[-1]
        $lastS = $r.std_dca.daily[-1]
        $sampledProg += @{ t = $lastD.trade_date; n = [math]::Round($lastD.nav_usd, 2) }
        $sampledStd  += @{ t = $lastS.trade_date; n = [math]::Round($lastS.nav_usd, 2) }

        $chartData[$p.label] = @{
            lth_pvr = $sampledProg
            std_dca = $sampledStd
        }
    }

    Write-Host " done"
}

$summary | Out-File -FilePath "sim-full-results.txt" -Encoding utf8
$chartData | ConvertTo-Json -Depth 10 | Out-File -FilePath "sim-chart-data.json" -Encoding utf8
Write-Host "ALL DONE"
