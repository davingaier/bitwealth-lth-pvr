# Deploy Customer Portal Migrations
# Created: 2025-12-29
# Purpose: Apply all customer portal database migrations to Supabase

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Customer Portal Migration Deployment" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Migration files in order (from supabase/sql/migrations)
$migrations = @(
    "20251229000001_create_customer_portal_tables.sql",
    "20251229000002_add_customer_portal_columns.sql",
    "20251229000003_create_rls_policies.sql",
    "20251229000004_insert_email_templates.sql",
    "20251229000005_create_fee_management_rpc.sql"
)

$sourceDir = "supabase\sql\migrations"
$targetDir = "supabase\migrations"

# Ensure target directory exists
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$totalMigrations = $migrations.Count
$completed = 0
$failed = 0

# Copy migrations to supabase/migrations folder where CLI expects them
Write-Host "Copying migrations to supabase/migrations..." -ForegroundColor Cyan

foreach ($migration in $migrations) {
    $sourcePath = Join-Path $sourceDir $migration
    $targetPath = Join-Path $targetDir $migration
    
    if (-not (Test-Path $sourcePath)) {
        Write-Host "  ERROR: Source file not found - $sourcePath" -ForegroundColor Red
        $failed++
        continue
    }
    
    try {
        Copy-Item -Path $sourcePath -Destination $targetPath -Force
        Write-Host "  Copied: $migration" -ForegroundColor Gray
    } catch {
        Write-Host "  ERROR: Failed to copy $migration - $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""

# Now push all migrations using Supabase CLI
Write-Host "Pushing migrations to Supabase..." -ForegroundColor Yellow
try {
    $output = supabase db push --linked 2>&1 | Out-String
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host $output
        Write-Host "`nSUCCESS: All migrations applied" -ForegroundColor Green
        $completed = $totalMigrations
    } else {
        Write-Host $output -ForegroundColor Red
        Write-Host "`nERROR: Migration push failed" -ForegroundColor Red
        $failed = $totalMigrations
    }
} catch {
    Write-Host "  ERROR: Exception occurred - $($_.Exception.Message)" -ForegroundColor Red
    $failed = $totalMigrations
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Deployment Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total Migrations: $totalMigrations" -ForegroundColor White
Write-Host "Status: $(if ($failed -eq 0) { 'SUCCESS' } else { 'FAILED' })" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host ""

if ($failed -eq 0) {
    Write-Host "All migrations applied successfully!" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "  1. Deploy edge functions: supabase functions deploy ef_send_email" -ForegroundColor White
    Write-Host "  2. Deploy edge functions: supabase functions deploy ef_prospect_submit" -ForegroundColor White
    Write-Host "  3. Deploy edge functions: supabase functions deploy ef_customer_register" -ForegroundColor White
    exit 0
} else {
    Write-Host "Migration deployment failed. Please review errors above." -ForegroundColor Red
    exit 1
}
