# valr_probe.ps1 — read-only / targeted VALR calls for operational checks (uses .env VALR keys; prints no secrets)
param([string]$Action = 'open', [string]$Sub = '1456357666877767680', [string]$CustomerOrderId = '', [string]$Pair = 'BTCUSDT')
$envLines = Get-Content .env
$key = (($envLines | Where-Object { $_ -match '^VALR_API_KEY=' }) -split '=',2)[1].Trim().Trim('"')
$sec = (($envLines | Where-Object { $_ -match '^VALR_API_SECRET=' }) -split '=',2)[1].Trim().Trim('"')
function Sign($ts, $verb, $path, $body) {
  $h = New-Object System.Security.Cryptography.HMACSHA512
  $h.Key = [Text.Encoding]::UTF8.GetBytes($sec)
  $sig = $h.ComputeHash([Text.Encoding]::UTF8.GetBytes("$ts$verb$path$body$Sub"))
  ($sig | ForEach-Object { $_.ToString('x2') }) -join ''
}
function Call($verb, $path, $bodyObj) {
  $body = if ($null -ne $bodyObj) { $bodyObj | ConvertTo-Json -Compress } else { '' }
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
  $hdr = @{ 'X-VALR-API-KEY' = $key; 'X-VALR-SIGNATURE' = (Sign $ts $verb $path $body); 'X-VALR-TIMESTAMP' = $ts; 'X-VALR-SUB-ACCOUNT-ID' = $Sub; 'Content-Type' = 'application/json' }
  if ($body) { Invoke-RestMethod -Method $verb -Uri "https://api.valr.com$path" -Headers $hdr -Body $body } else { Invoke-RestMethod -Method $verb -Uri "https://api.valr.com$path" -Headers $hdr }
}
switch ($Action) {
  'open'    { Call 'GET' '/v1/orders/open' $null | Select-Object orderId, customerOrderId, side, type, currencyPair, price, originalQuantity, remainingQuantity, status, createdAt | Format-Table -AutoSize }
  'balance' { Call 'GET' '/v1/account/balances' $null | Where-Object { [double]$_.total -gt 0 } | Select-Object currency, available, reserved, total | Format-Table -AutoSize }
  'status'  { Call 'GET' "/v1/orders/$Pair/customerorderid/$CustomerOrderId" $null | ConvertTo-Json -Compress }
  'cancel'  { Call 'DELETE' '/v1/orders/order' @{ customerOrderId = $CustomerOrderId; pair = $Pair }; 'cancel sent' }
  'cancelid'{ Call 'DELETE' '/v1/orders/order' @{ orderId = $CustomerOrderId; pair = $Pair }; 'cancel (by orderId) sent' }
  'openraw' { Call 'GET' '/v1/orders/open' $null | ConvertTo-Json -Compress -Depth 4 }
}
