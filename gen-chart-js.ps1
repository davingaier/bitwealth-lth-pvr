Add-Type -AssemblyName System.Web
$j = [System.IO.File]::ReadAllText("sim-chart-data.json") | ConvertFrom-Json

$y5 = $j.'5yr'
$y10 = $j.'10yr'

function Build-Array($arr) {
    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.Append("[")
    for ($i = 0; $i -lt $arr.Count; $i++) {
        if ($i -gt 0) { [void]$sb.Append(",") }
        [void]$sb.Append("['$($arr[$i].t)',$($arr[$i].n)]")
    }
    [void]$sb.Append("]")
    return $sb.ToString()
}

$lth5  = Build-Array $y5.lth_pvr
$std5  = Build-Array $y5.std_dca
$lth10 = Build-Array $y10.lth_pvr
$std10 = Build-Array $y10.std_dca

$out = "const _lth5=$lth5;`nconst _std5=$std5;`nconst _lth10=$lth10;`nconst _std10=$std10;"
[System.IO.File]::WriteAllText("chart-data-compact.js", $out, [System.Text.Encoding]::UTF8)
$sz = (Get-Item "chart-data-compact.js").Length
Write-Host "Written $sz bytes"
Write-Host "5yr lth: $($y5.lth_pvr.Count) pts, std: $($y5.std_dca.Count) pts"
Write-Host "10yr lth: $($y10.lth_pvr.Count) pts, std: $($y10.std_dca.Count) pts"
