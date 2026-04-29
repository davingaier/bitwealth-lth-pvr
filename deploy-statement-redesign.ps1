# Statement Redesign - Deployment Steps
#
# Run these commands from the repo root in PowerShell after the migration has
# been applied (which creates the public `branding` storage bucket).
#
# Prerequisites:
#   - Supabase CLI installed and logged in (`supabase login`)
#   - Project linked: `supabase link --project-ref wqnmxpooabmedvtackji`
#   - Supabase secret BROWSERLESS_TOKEN set in the Edge Functions environment
#     (Project Settings -> Edge Functions -> Secrets).

$PROJECT_REF = "wqnmxpooabmedvtackji"

Write-Host "==> Step 1/3: Apply DB migration (statements_sent + branding bucket)" -ForegroundColor Cyan
supabase db push

Write-Host "==> Step 2/3: Upload brand assets to the public 'branding' bucket" -ForegroundColor Cyan
# The bucket is public-read, authenticated-write, so we use the service-role key.
# We need: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your local env.
if (-not $env:SUPABASE_URL -or -not $env:SUPABASE_SERVICE_ROLE_KEY) {
    Write-Error "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first."
    exit 1
}

function Upload-BrandAsset {
    param(
        [string]$LocalPath,
        [string]$RemoteName,
        [string]$ContentType
    )
    $uri = "$($env:SUPABASE_URL)/storage/v1/object/branding/$RemoteName"
    Write-Host "    -> Uploading $LocalPath as $RemoteName"
    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $LocalPath))
    $headers = @{
        "Authorization" = "Bearer $($env:SUPABASE_SERVICE_ROLE_KEY)"
        "Content-Type"  = $ContentType
        "x-upsert"      = "true"
    }
    Invoke-RestMethod -Uri $uri -Method Put -Headers $headers -Body $bytes | Out-Null
}

Upload-BrandAsset -LocalPath "logos/bitwealth_logo_transparent.svg" -RemoteName "bitwealth_logo_transparent.svg" -ContentType "image/svg+xml"
Upload-BrandAsset -LocalPath "logos/bitwealth_logo_white.svg"       -RemoteName "bitwealth_logo_white.svg"       -ContentType "image/svg+xml"
Upload-BrandAsset -LocalPath "logos/bitwealth_logo_transparent.png" -RemoteName "bitwealth_logo_transparent.png" -ContentType "image/png"

Write-Host "    Verify by visiting: $($env:SUPABASE_URL)/storage/v1/object/public/branding/bitwealth_logo_transparent.svg" -ForegroundColor Yellow

Write-Host "==> Step 3/3: Deploy edge functions" -ForegroundColor Cyan
supabase functions deploy ef_generate_statement          --project-ref $PROJECT_REF --no-verify-jwt
supabase functions deploy ef_monthly_statement_generator --project-ref $PROJECT_REF --no-verify-jwt
supabase functions deploy ef_fee_monthly_close           --project-ref $PROJECT_REF --no-verify-jwt

Write-Host ""
Write-Host "==> Smoke test: generate one statement in HTML preview mode" -ForegroundColor Green
Write-Host "Open in browser:"
Write-Host "  $($env:SUPABASE_URL)/functions/v1/ef_generate_statement?preview=html"
Write-Host "with POST body { customer_id, year, month } and Authorization: Bearer <ANON_KEY>"
