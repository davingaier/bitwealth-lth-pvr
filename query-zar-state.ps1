# Query ZAR conversion state for customer 999
$headers = @{
    "apikey" = $env:SUPABASE_SERVICE_ROLE_KEY
    "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY"
    "Prefer" = "return=representation"
}

$baseUrl = "https://wqnmxpooabmedvtackji.supabase.co/rest/v1"

Write-Host "`n=====================================" -ForegroundColor Cyan
Write-Host "ZAR CONVERSION STATE FOR CUSTOMER 999" -ForegroundColor Cyan
Write-Host "=====================================`n" -ForegroundColor Cyan

# 1. Get ZAR deposits (using RPC function)
Write-Host "1. ZAR DEPOSITS:" -ForegroundColor Yellow
$depositsUrl = "$baseUrl/rpc/get_customer_funding_events"
$depositsBody = @{
    p_customer_id = 999
    p_kind = "zar_deposit"
} | ConvertTo-Json
try {
    $deposits = Invoke-RestMethod -Uri $depositsUrl -Method GET -Headers $headers
    if ($deposits.Count -eq 0) {
        Write-Host "   No ZAR deposits found`n" -ForegroundColor Red
    } else {
        $deposits | ForEach-Object {
            Write-Host "   - ID: $($_.funding_id)"
            Write-Host "     Date: $($_.occurred_at)"
            Write-Host "     Amount: R$($_.amount)"
            Write-Host "     Metadata: $($_.metadata | ConvertTo-Json -Compress)"
            Write-Host ""
        }
    }
} catch {
    Write-Host "   Error: $($_.Exception.Message)`n" -ForegroundColor Red
}

# 2. Get USDT deposits with ZAR conversion metadata
Write-Host "2. ZAR→USDT CONVERSIONS:" -ForegroundColor Yellow  
$conversionsUrl = "$baseUrl/exchange_funding_events?customer_id=eq.999&kind=eq.deposit&asset=eq.USDT&select=funding_id,occurred_at,amount,metadata,created_at&order=occurred_at.desc&limit=10"
try {
    $conversions = Invoke-RestMethod -Uri $conversionsUrl -Method GET -Headers $headers
    $zarConversions = $conversions | Where-Object { $_.metadata.zar_amount -ne $null }
    
    if ($zarConversions.Count -eq 0) {
        Write-Host "   No ZAR conversions found`n" -ForegroundColor Red
    } else {
        $zarConversions | ForEach-Object {
            Write-Host "   - ID: $($_.funding_id)"
            Write-Host "     Date: $($_.occurred_at)"
            Write-Host "     USDT: $($_.amount)"
            Write-Host "     ZAR: R$($_.metadata.zar_amount)"
            Write-Host "     Linked to: $($_.metadata.zar_deposit_id)"
            Write-Host "     Split: $($_.metadata.is_split_allocation)"
            Write-Host ""
        }
    }
} catch {
    Write-Host "   Error: $($_.Exception.Message)`n" -ForegroundColor Red
}

# 3. Get pending conversions table
Write-Host "3. PENDING CONVERSIONS TABLE:" -ForegroundColor Yellow
$pendingUrl = "$baseUrl/pending_zar_conversions?customer_id=eq.999&select=*&order=occurred_at.asc"
try {
    $pending = Invoke-RestMethod -Uri $pendingUrl -Method GET -Headers $headers
    
    if ($pending.Count -eq 0) {
        Write-Host "   No pending conversions`n" -ForegroundColor Green
    } else {
        $pending | ForEach-Object {
            Write-Host "   - Funding ID: $($_.funding_id)"
            Write-Host "     Original: R$($_.zar_amount)"
            Write-Host "     Converted: R$($_.converted_amount)"
            Write-Host "     Remaining: R$($_.remaining_amount)"
            Write-Host "     Date: $($_.occurred_at)"
            Write-Host ""
        }
    }
} catch {
    Write-Host "   Error: $($_.Exception.Message)`n" -ForegroundColor Red
}

# 4. Calculate summary
Write-Host "4. SUMMARY CALCULATION:" -ForegroundColor Yellow
try {
    $totalDeposited = ($deposits | Measure-Object -Property amount -Sum).Sum
    $totalConverted = ($zarConversions | ForEach-Object { [decimal]$_.metadata.zar_amount } | Measure-Object -Sum).Sum
    $shouldRemaining = $totalDeposited - $totalConverted
    
    Write-Host "   Total ZAR Deposited: R$($totalDeposited)"
    Write-Host "   Total ZAR Converted: R$($totalConverted)"
    Write-Host "   Should be Remaining: R$($shouldRemaining)"
    Write-Host "   VALR Reports: R50.00"
    Write-Host "   Discrepancy: R$($shouldRemaining - 50.00)"
    Write-Host ""
} catch {
    Write-Host "   Error calculating: $($_.Exception.Message)`n" -ForegroundColor Red
}

Write-Host "=====================================" -ForegroundColor Cyan
