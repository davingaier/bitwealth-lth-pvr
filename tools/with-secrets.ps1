# tools/with-secrets.ps1 — run any command with BitWealth secrets injected from Infisical (no .env on disk).
#   .\tools\with-secrets.ps1 deno run -A tools/sth_cb_lab/fetch.ts
#   .\tools\with-secrets.ps1 python tools/email_header_navy.py --apply
# Secrets live in sub-folders of the Infisical project, so --recursive is required.
param([Parameter(Mandatory = $true, Position = 0)] [string] $Exe,
      [Parameter(ValueFromRemainingArguments = $true)] [string[]] $Args)
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try { & infisical run --env dev --recursive -- $Exe @Args; exit $LASTEXITCODE } finally { Pop-Location }
