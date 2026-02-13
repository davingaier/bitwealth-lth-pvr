# Query VALR API for customer 999 transactions
$subaccountId = "1419286489401798656"
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$method = "GET"
$path = "/v1/account/transactionhistory?skip=0&limit=30"

# Create HMAC signature
$message = "$timestamp$method$path$subaccountId"
$hmac = New-Object System.Security.Cryptography.HMACSHA512
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($env:VALR_API_SECRET)
$signatureBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($message))
$signature = [BitConverter]::ToString($signatureBytes).Replace("-","").ToLower()

# Call VALR API
$headers = @{
    "X-VALR-API-KEY" = $env:VALR_API_KEY
    "X-VALR-SIGNATURE" = $signature
    "X-VALR-TIMESTAMP" = $timestamp
    "X-VALR-SUB-ACCOUNT-ID" = $subaccountId
}

Write-Host "Querying VALR API..."
$transactions = Invoke-RestMethod -Uri "https://api.valr.com$path" -Headers $headers -Method GET

Write-Host "`n✓ Retrieved $($transactions.Count) transactions`n"
Write-Host "Looking for ZAR/USDT transactions from last 24 hours..."
Write-Host "=" * 80

$transactions | Where-Object {
    ($_.creditCurrency -eq "ZAR" -or $_.debitCurrency -eq "ZAR" -or 
     $_.creditCurrency -eq "USDT" -or $_.debitCurrency -eq "USDT") -and
    ([DateTime]$_.eventAt) -gt ([DateTime]::UtcNow.AddDays(-1))
} | ForEach-Object {
    Write-Host "`nTransaction Type: $($_.transactionType.type)"
    Write-Host "Event Time: $($_.eventAt)"
    Write-Host "Credit: $($_.creditCurrency) $($_.creditValue)"
    Write-Host "Debit: $($_.debitCurrency) $($_.debitValue)"
    Write-Host "ID: $($_.id)"
    Write-Host "-" * 80
}

# Save full output for analysis
$transactions | ConvertTo-Json -Depth 10 | Out-File "valr-customer-999-transactions.json"
Write-Host "`n✓ Full transaction data saved to: valr-customer-999-transactions.json"
