# Query VALR transaction history for personal subaccount
# This script queries your personal VALR subaccount directly to understand transaction types

param(
    [string]$SubaccountId = "1419286489401798656",
    [string]$ApiKey,
    [string]$ApiSecret
)

# Try environment variables first, then parameters
if (-not $ApiKey) { $ApiKey = $env:VALR_API_KEY }
if (-not $ApiSecret) { $ApiSecret = $env:VALR_API_SECRET }

if (-not $ApiKey -or -not $ApiSecret) {
    Write-Error "VALR credentials must be provided via -ApiKey/-ApiSecret parameters or VALR_API_KEY/VALR_API_SECRET environment variables"
    Write-Host "`nUsage:"
    Write-Host '  .\query-personal-subaccount.ps1 -ApiKey "your_key" -ApiSecret "your_secret"'
    Write-Host '  OR set environment variables:'
    Write-Host '  $env:VALR_API_KEY = "your_key"'
    Write-Host '  $env:VALR_API_SECRET = "your_secret"'
    exit 1
}

$apiKey = $ApiKey
$apiSecret = $ApiSecret

# HMAC SHA-512 signature function
function Get-VALRSignature {
    param(
        [string]$Timestamp,
        [string]$Method,
        [string]$Path,
        [string]$Body,
        [string]$Secret
    )
    
    $message = "$Timestamp$($Method.ToUpper())$Path$Body"
    $hmac = New-Object System.Security.Cryptography.HMACSHA512
    $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
    $hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($message))
    return [System.BitConverter]::ToString($hash).Replace("-", "").ToLower()
}

# Query transaction history
$path = "/v1/account/transactionhistory?skip=0&limit=100"
$method = "GET"
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$signature = Get-VALRSignature -Timestamp $timestamp -Method $method -Path $path -Body "" -Secret $apiSecret

$headers = @{
    "X-VALR-API-KEY" = $apiKey
    "X-VALR-SIGNATURE" = $signature
    "X-VALR-TIMESTAMP" = $timestamp
    "X-VALR-SUB-ACCOUNT-ID" = $SubaccountId
}

Write-Host "`n=== Querying VALR Transaction History ===" -ForegroundColor Cyan
Write-Host "Subaccount ID: $SubaccountId" -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "https://api.valr.com$path" -Method GET -Headers $headers
    
    Write-Host "`nFound $($response.Count) transactions" -ForegroundColor Green
    
    # Group by transaction type
    $typeGroups = $response | Group-Object { $_.transactionType.type } | Sort-Object Count -Descending
    
    Write-Host "`n=== Transaction Type Summary ===" -ForegroundColor Cyan
    foreach ($group in $typeGroups) {
        Write-Host "$($group.Name): $($group.Count) transactions" -ForegroundColor Yellow
    }
    
    # Display detailed transaction info
    Write-Host "`n=== Detailed Transaction List ===" -ForegroundColor Cyan
    foreach ($tx in $response) {
        Write-Host "`n----------------------------------------" -ForegroundColor Gray
        Write-Host "Transaction ID: $($tx.id)" -ForegroundColor White
        Write-Host "  Type: $($tx.transactionType.type)" -ForegroundColor Yellow
        Write-Host "  Description: $($tx.transactionType.description)" -ForegroundColor Yellow
        Write-Host "  Timestamp: $($tx.eventAt)" -ForegroundColor Gray
        
        if ($tx.creditValue -and $tx.creditCurrency) {
            Write-Host "  Credit: $($tx.creditValue) $($tx.creditCurrency)" -ForegroundColor Green
        }
        
        if ($tx.debitValue -and $tx.debitCurrency) {
            Write-Host "  Debit: $($tx.debitValue) $($tx.debitCurrency)" -ForegroundColor Red
        }
        
        if ($tx.additionalInfo) {
            Write-Host "  Additional Info: $($tx.additionalInfo | ConvertTo-Json -Compress)" -ForegroundColor Gray
        }
    }
    
    # Save full JSON for reference
    $outputFile = "personal-subaccount-transactions-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    $response | ConvertTo-Json -Depth 10 | Out-File $outputFile
    Write-Host "`n=== Full JSON saved to: $outputFile ===" -ForegroundColor Green
    
} catch {
    Write-Error "Failed to query VALR API: $_"
    Write-Host "Response: $($_.Exception.Response)" -ForegroundColor Red
    exit 1
}
