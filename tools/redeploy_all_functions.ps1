# tools/redeploy_all_functions.ps1
# Redeploy every Edge Function that has local source, preserving each function's JWT-verification flag from
# tools/edge_function_jwt_flags.json (true  -> platform verifies the caller's JWT;
#                                      false -> deployed with --no-verify-jwt, function authorises in code).
#
#   .\tools\redeploy_all_functions.ps1                       # all functions
#   .\tools\redeploy_all_functions.ps1 -Only ef_poll_orders  # one or more names
#   .\tools\redeploy_all_functions.ps1 -DryRun
param(
  [string[]] $Only = @(),
  [switch]   $DryRun
)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$projectRef = "wqnmxpooabmedvtackji"
$flags = Get-Content (Join-Path $PSScriptRoot "edge_function_jwt_flags.json") -Raw | ConvertFrom-Json

$names = $flags.PSObject.Properties.Name
if ($Only.Count) { $names = $names | Where-Object { $Only -contains $_ } }

$ok = @(); $failed = @()
foreach ($fn in $names) {
  if (-not (Test-Path "supabase\functions\$fn\index.ts")) { Write-Host "skip $fn (no local source)" -ForegroundColor DarkGray; continue }
  $verify = [bool]$flags.$fn
  $args = @("functions", "deploy", $fn, "--project-ref", $projectRef)
  if (-not $verify) { $args += "--no-verify-jwt" }
  Write-Host ("{0,-40} verify_jwt={1}" -f $fn, $verify) -ForegroundColor Yellow
  if ($DryRun) { continue }
  $out = & supabase @args 2>&1
  if ($LASTEXITCODE -eq 0) { $ok += $fn } else { $failed += $fn; Write-Host ($out | Out-String) -ForegroundColor Red }
}
Write-Host ""
Write-Host ("deployed: {0}   failed: {1}" -f $ok.Count, $failed.Count) -ForegroundColor Cyan
if ($failed.Count) { Write-Host ("FAILED: " + ($failed -join ", ")) -ForegroundColor Red; exit 1 }
