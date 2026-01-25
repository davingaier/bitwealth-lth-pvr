#!/usr/bin/env pwsh
# Query Davin's personal subaccount transaction history to see transaction types

$subaccountId = "1419286489401798656"
$apiKey = $env:VALR_API_KEY
$apiSecret = $env:VALR_API_SECRET
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$verb = "GET"
$path = "/v1/account/transactionhistory?skip=0&limit=50"

# Create signature payload
$payload = "$timestamp$verb$path$subaccountId"

# Generate HMAC SHA512 signature
$hmac = New-Object System.Security.Cryptography.HMACSHA512
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($apiSecret)
$signatureBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payload))
$signature = [System.BitConverter]::ToString($signatureBytes).Replace("-", "").ToLower()

# Make API request
$headers = @{
    "X-VALR-API-KEY" = $apiKey
    "X-VALR-SIGNATURE" = $signature
    "X-VALR-TIMESTAMP" = $timestamp
    "X-VALR-SUB-ACCOUNT-ID" = $subaccountId
}

$response = Invoke-RestMethod -Uri "https://api.valr.com$path" -Method GET -Headers $headers
$response | ConvertTo-Json -Depth 10
