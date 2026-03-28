<#
.SYNOPSIS
    Captures the raw ChartInspect API response for debugging purposes.

.DESCRIPTION
    Calls the same endpoint used by ef_fetch_ci_bands and saves the full raw 
    JSON response to a file. Provide this file to Tristan so he can debug
    the band value discrepancy.

.PARAMETER CiApiKey
    Your ChartInspect API key (CI_API_KEY from Supabase project secrets).

.PARAMETER Mode
    Band calculation mode: 'static' (default) or 'cumulative'.

.PARAMETER StartDate
    Start date in YYYY-MM-DD format. Defaults to 30 days ago to give context.

.PARAMETER EndDate
    End date in YYYY-MM-DD format. Defaults to yesterday.

.PARAMETER OutputFile
    Where to write the response. Defaults to 'ci_bands_raw_response.json'.

.EXAMPLE
    .\get-ci-raw-response.ps1 -CiApiKey "ci_live_768ca84ba955c034d19dc9c50fad20cff8642711cb168904a414bd00dfc22289"
    .\get-ci-raw-response.ps1 -CiApiKey "ci_live_768ca84ba955c034d19dc9c50fad20cff8642711cb168904a414bd00dfc22289" -StartDate "2026-01-01"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$CiApiKey,

    [string]$Mode = "static",

    [string]$StartDate = (
        (Get-Date).ToUniversalTime().AddDays(-30).ToString("yyyy-MM-dd")
    ),

    [string]$EndDate = (
        (Get-Date).ToUniversalTime().AddDays(-1).ToString("yyyy-MM-dd")
    ),

    [string]$OutputFile = "ci_bands_raw_response.json"
)

$url = "https://chartinspect.com/api/v1/onchain/lth-pvr-bands?mode=$([Uri]::EscapeDataString($Mode))&start=$([Uri]::EscapeDataString($StartDate))&end=$([Uri]::EscapeDataString($EndDate))"

Write-Host ""
Write-Host "=== ChartInspect API Raw Response Capture ==="
Write-Host "URL:     $url"
Write-Host "Output:  $OutputFile"
Write-Host ""

$headers = @{
    "X-API-Key" = $CiApiKey
}

try {
    $response = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -ErrorAction Stop

    # Save raw body
    $response.Content | Out-File -FilePath $OutputFile -Encoding UTF8

    # Also save response metadata for Tristan
    $metaFile = [System.IO.Path]::ChangeExtension($OutputFile, ".meta.txt")
    @"
=== ChartInspect API Response Metadata ===
Captured:       $(Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC")
URL:            $url
Status:         $($response.StatusCode) $($response.StatusDescription)
Content-Length: $($response.Content.Length) characters

Response Headers:
$($response.Headers | Format-List | Out-String)
"@ | Out-File -FilePath $metaFile -Encoding UTF8

    Write-Host "SUCCESS"
    Write-Host "  Status:  $($response.StatusCode) $($response.StatusDescription)"
    Write-Host "  Size:    $($response.Content.Length) characters"
    Write-Host "  Body:    $OutputFile"
    Write-Host "  Meta:    $metaFile"
    Write-Host ""

    # Parse and summarise rows for quick sanity check
    try {
        $parsed = $response.Content | ConvertFrom-Json
        $rows = $parsed.data
        if ($rows -and $rows.Count -gt 0) {
            Write-Host "  Rows returned: $($rows.Count)"
            Write-Host "  First date:    $($rows[0].date)"
            Write-Host "  Last date:     $($rows[-1].date)"
            Write-Host ""
            Write-Host "  Latest row field names:"
            $lastRow = $rows[-1]
            $lastRow.PSObject.Properties | ForEach-Object {
                Write-Host "    $($_.Name): $($_.Value)"
            }
        } else {
            Write-Host "  WARNING: 'data' array is empty or missing."
            Write-Host "  Full response:"
            Write-Host ($response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 3)
        }
    } catch {
        Write-Host "  (Could not pretty-print response - raw JSON saved to file)"
    }

} catch [System.Net.WebException] {
    $statusCode = [int]$_.Exception.Response.StatusCode
    $statusDesc = $_.Exception.Response.StatusDescription
    Write-Host "FAILED: HTTP $statusCode $statusDesc"

    # Try to read error body
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errorBody = $reader.ReadToEnd()
        Write-Host "Error body: $errorBody"
        $errorBody | Out-File -FilePath ([System.IO.Path]::ChangeExtension($OutputFile, ".error.txt")) -Encoding UTF8
    } catch { }

    exit 1
} catch {
    Write-Host "FAILED: $_"
    exit 1
}

Write-Host ""
Write-Host "Send '$OutputFile' and '$metaFile' to Tristan for debugging."
