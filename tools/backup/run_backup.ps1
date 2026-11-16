# tools/backup/run_backup.ps1 - scheduled entry point for BitWealth off-platform backups.
#
#   One-time setup (interactive, pulls DATABASE_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from Infisical):
#       infisical login
#       .\tools\with-secrets.ps1 powershell -NoProfile -File tools\backup\run_backup.ps1 -Action setup
#     -> writes a DPAPI-encrypted credential file (%LOCALAPPDATA%\BitWealth\backup.cred, readable only by this Windows
#        user on this PC), prints the BACKUP_PASSPHRASE ONCE if it had to generate one, and registers two scheduled
#        tasks: "BitWealth\Backup Storage (weekly)" Mon 08:00 and "BitWealth\Backup Database (weekly)" Mon 08:30.
#
#   Scheduled / manual runs (no Infisical needed - reads the DPAPI file):
#       .\tools\backup\run_backup.ps1 -Action storage|db|all
#       .\tools\backup\run_backup.ps1 -Action show       # recent archives + task state + last results
#       .\tools\backup\run_backup.ps1 -Action verify -Path <zip>
#
# Why DPAPI and not Infisical here: the Infisical CLI login session expires and re-auth needs a browser, which a
# scheduled task cannot do. DPAPI needs nothing interactive and the blob is useless on another PC / user account.
[CmdletBinding()]
param(
    [ValidateSet('setup', 'register', 'storage', 'db', 'all', 'show', 'verify', 'extract', 'passphrase')]
    [string] $Action = 'all',
    [string] $Path,
    [string] $Dest,
    [string] $BackupRoot = (Join-Path $env:USERPROFILE 'Dropbox\BitWealth\Backups'),
    [switch] $NoAlert
)
$ErrorActionPreference = 'Stop'
$repoRoot  = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPy  = Join-Path $PSScriptRoot 'backup.py'
$credDir   = Join-Path $env:LOCALAPPDATA 'BitWealth'
$credFile  = Join-Path $credDir 'backup.cred'
$taskPath  = '\BitWealth\'
$taskStore = 'Backup Storage (weekly)'
$taskDb    = 'Backup Database (weekly)'

function Protect-Json([hashtable] $h) {
    $json = $h | ConvertTo-Json -Compress
    return (ConvertTo-SecureString -String $json -AsPlainText -Force | ConvertFrom-SecureString)   # DPAPI, current user
}
function Unprotect-Json([string] $blob) {
    $sec = ConvertTo-SecureString -String $blob
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | ConvertFrom-Json) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function New-Passphrase {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ([Convert]::ToBase64String($bytes) -replace '[/+=]', '').Substring(0, 36)
}
function Load-Creds {
    if (-not (Test-Path $credFile)) { throw "credential file not found: $credFile - run -Action setup first (via with-secrets.ps1)" }
    $c = Unprotect-Json (Get-Content $credFile -Raw)
    foreach ($k in 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BACKUP_PASSPHRASE') {
        if (-not $c.$k) { throw "credential file is missing $k - re-run setup" }
        Set-Item -Path "Env:$k" -Value $c.$k
    }
}
function Get-Python {
    $p = Get-Command python -ErrorAction SilentlyContinue
    if ($p) { return $p.Source }
    $c = 'C:\Python313\python.exe'; if (Test-Path $c) { return $c }
    throw 'python not found'
}

function Do-Setup {
    foreach ($k in 'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY') {
        if (-not (Get-Item "Env:$k" -ErrorAction SilentlyContinue).Value) {
            throw "$k is not in the environment - run setup through .\tools\with-secrets.ps1 (after 'infisical login')"
        }
    }
    $dbUrl = $env:DATABASE_URL
    if ($dbUrl -match ':6543/') { $dbUrl = $dbUrl -replace ':6543/', ':5432/'; Write-Host 'DATABASE_URL used the transaction pooler port; stored the session-mode (5432) variant for pg_dump.' }
    $pass = $env:BACKUP_PASSPHRASE
    $generated = $false
    if (-not $pass) {
        if (Test-Path $credFile) {
            $old = Unprotect-Json (Get-Content $credFile -Raw)
            if ($old.BACKUP_PASSPHRASE) { $pass = $old.BACKUP_PASSPHRASE; Write-Host 'Kept the existing BACKUP_PASSPHRASE from the credential file.' }
        }
        if (-not $pass) { $pass = New-Passphrase; $generated = $true }
    }
    New-Item -ItemType Directory -Force -Path $credDir | Out-Null
    Set-Content -Path $credFile -Value (Protect-Json @{
        DATABASE_URL = $dbUrl; SUPABASE_URL = $env:SUPABASE_URL
        SUPABASE_SERVICE_ROLE_KEY = $env:SUPABASE_SERVICE_ROLE_KEY; BACKUP_PASSPHRASE = $pass
    }) -NoNewline
    Write-Host "Credential file written: $credFile (DPAPI, this Windows user only)"
    if ($generated) {
        Write-Host ''
        Write-Host '==================== BACKUP_PASSPHRASE (shown once) ====================' -ForegroundColor Yellow
        Write-Host $pass -ForegroundColor Yellow
        Write-Host '========================================================================' -ForegroundColor Yellow
        Write-Host 'Store it NOW as BACKUP_PASSPHRASE in Infisical AND in your password manager.'
        Write-Host 'Without it every archive is unreadable; with it anyone can read them.'
    }
    Do-Register
}

function Do-Register {
    $ps = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
    if (-not $ps) { $ps = (Get-Command powershell.exe).Source }
    $common = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -BackupRoot `"$BackupRoot`""
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    $trigStore = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 08:00
    Register-ScheduledTask -TaskPath $taskPath -TaskName $taskStore -Force `
        -Action (New-ScheduledTaskAction -Execute $ps -Argument "$common -Action storage" -WorkingDirectory $repoRoot) `
        -Trigger $trigStore -Settings $settings -Principal $principal `
        -Description 'BitWealth: encrypted export of all Supabase Storage buckets to Dropbox\BitWealth\Backups\storage' | Out-Null

    $trigDb = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 08:30
    Register-ScheduledTask -TaskPath $taskPath -TaskName $taskDb -Force `
        -Action (New-ScheduledTaskAction -Execute $ps -Argument "$common -Action db" -WorkingDirectory $repoRoot) `
        -Trigger $trigDb -Settings $settings -Principal $principal `
        -Description 'BitWealth: encrypted pg_dump of the production database to Dropbox\BitWealth\Backups\db' | Out-Null
    Write-Host "Scheduled tasks registered under Task Scheduler Library > BitWealth:"
    Get-ScheduledTask -TaskPath $taskPath | ForEach-Object {
        $i = $_ | Get-ScheduledTaskInfo
        Write-Host ("  {0,-28} state={1,-8} next={2}" -f $_.TaskName, $_.State, $i.NextRunTime)
    }
}

function Do-Run([string] $job) {
    Load-Creds
    $env:BACKUP_ROOT = $BackupRoot
    if ($NoAlert) { $env:BACKUP_NO_ALERT = '1' }
    $logDir = Join-Path $BackupRoot 'logs'; New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $log = Join-Path $logDir ("backup_{0}_{1}.log" -f $job, (Get-Date -Format 'yyyy-MM-dd_HHmmss'))
    Push-Location $repoRoot
    try {
        # native stderr must not become a terminating error under $ErrorActionPreference='Stop'
        $ErrorActionPreference = 'Continue'
        & (Get-Python) $scriptPy $job 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $log
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
    } finally { Pop-Location }
    Get-ChildItem $logDir -Filter 'backup_*.log' | Sort-Object Name -Descending | Select-Object -Skip 40 | Remove-Item -ErrorAction SilentlyContinue
    if ($code -ne 0) { Write-Host "backup $job FAILED (exit $code) - see $log" -ForegroundColor Red }
    exit $code
}

function Do-Show {
    Write-Host "Backup root: $BackupRoot"
    foreach ($sub in 'db', 'storage') {
        $dir = Join-Path $BackupRoot $sub
        Write-Host "`n[$sub]"
        if (Test-Path $dir) {
            Get-ChildItem $dir -Filter '*.zip' | Sort-Object Name -Descending | Select-Object -First 6 |
                ForEach-Object { Write-Host ("  {0,-36} {1,8:N1} MB  {2}" -f $_.Name, ($_.Length / 1MB), $_.LastWriteTime) }
        } else { Write-Host '  (none yet)' }
    }
    Write-Host "`n[scheduled tasks]"
    Get-ScheduledTask -TaskPath $taskPath -ErrorAction SilentlyContinue | ForEach-Object {
        $i = $_ | Get-ScheduledTaskInfo
        Write-Host ("  {0,-28} state={1,-8} last={2} result={3} next={4}" -f $_.TaskName, $_.State, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime)
    }
    Write-Host "`n[credential file] $(if (Test-Path $credFile) { 'present' } else { 'MISSING - run setup' })"
}

switch ($Action) {
    'setup'    { Do-Setup }
    'register' { Do-Register }
    'show'     { Do-Show }
    'verify'   { if (-not $Path) { throw '-Path <zip> is required' }; Load-Creds; & (Get-Python) $scriptPy verify $Path; exit $LASTEXITCODE }
    'extract'  {
        if (-not $Path) { throw '-Path <zip> is required' }; Load-Creds
        $extra = @(); if ($Dest) { $extra = @('--dest', $Dest) }
        & (Get-Python) $scriptPy extract $Path @extra; exit $LASTEXITCODE
    }
    'passphrase' {
        # reveal the archive passphrase from the DPAPI file - run this yourself in a private terminal
        Load-Creds; Write-Host "BACKUP_PASSPHRASE = $env:BACKUP_PASSPHRASE"
        Write-Host 'Store it in Infisical (dev / BACKUP_PASSPHRASE) and your password manager; it opens every archive.'
    }
    default    { Do-Run $Action }
}
