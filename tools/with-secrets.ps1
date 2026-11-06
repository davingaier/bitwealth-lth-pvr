# tools/with-secrets.ps1 — run any command with BitWealth secrets injected from Infisical (no .env on disk).
#   .\tools\with-secrets.ps1 deno run -A tools/sth_cb_lab/fetch.ts
#   .\tools\with-secrets.ps1 python tools/email_header_navy.py --apply
# Secrets live in sub-folders of the Infisical project, so --recursive is required.
# NOTE: if you launch powershell (5.1) through this wrapper, embedded double quotes in native-exe arguments are stripped
#       (curl.exe -d '{"a":1}' -> {a:1}). Prefer pwsh, or pass JSON bodies with --data-binary "@file.json".
param([Parameter(Mandatory = $true, Position = 0)] [string] $Exe,
      [Parameter(ValueFromRemainingArguments = $true)] [string[]] $Args)
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try { & infisical run --env dev --recursive -- $Exe @Args; exit $LASTEXITCODE } finally { Pop-Location }

