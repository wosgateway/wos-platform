$ok = 0
$missing = 0

function Check-File($path) {
    if (Test-Path $path) {
        Write-Host "OK    $path" -ForegroundColor Green
        $script:ok++
    } else {
        Write-Host "MISS  $path" -ForegroundColor Red
        $script:missing++
    }
}

Write-Host "=== Migrations ===" -ForegroundColor Cyan
Check-File "migrations\019_payment_slip_upload.sql"
Check-File "migrations\020b_add_pending_verification_status.sql"
Check-File "migrations\021_payment_security_fixes.sql"

Write-Host ""
Write-Host "=== Frontend pages ===" -ForegroundColor Cyan
Check-File "src\app\[locale]\quote\[orderNumber]\page.tsx"
Check-File "src\app\[locale]\my-trip\[orderNumber]\page.tsx"
Check-File "src\app\[locale]\my-trip\[orderNumber]\payment\page.tsx"
Check-File "src\components\BookingForm.tsx"

Write-Host ""
Write-Host "=== API routes ===" -ForegroundColor Cyan
Check-File "src\app\api\orders\route.ts"
Check-File "src\app\api\quote\[orderNumber]\payments\route.ts"
Check-File "src\app\api\admin\payments\[id]\verify\route.ts"
Check-File "src\app\api\admin\payments\[id]\reject\route.ts"

Write-Host ""
Write-Host "=== QR images ===" -ForegroundColor Cyan
Check-File "public\payments\qr-thb.jpg"
Check-File "public\payments\qr-lak.jpg"
Check-File "public\payments\qr-usd.jpg"

Write-Host ""
Write-Host "=== Content spot-checks ===" -ForegroundColor Cyan

function Check-Content($path, $pattern, $label) {
    if ((Test-Path $path) -and (Select-String -Path $path -Pattern $pattern -Quiet)) {
        Write-Host "OK    $label" -ForegroundColor Green
    } else {
        Write-Host "MISS  $label" -ForegroundColor Red
    }
}

Check-Content "src\app\api\orders\route.ts" "payment_access_token" "orders route returns payment_access_token"
Check-Content "src\components\BookingForm.tsx" "payment_access_token" "BookingForm has the my-trip link with token"
Check-Content "src\app\api\quote\[orderNumber]\payments\route.ts" "loadAuthorizedOrder" "payments route has token auth check"
Check-Content "src\app\api\admin\payments\[id]\verify\route.ts" "waiting_verification" "verify route has the fixed update"

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Found: $ok   Missing: $missing"
if ($missing -eq 0) {
    Write-Host "Files complete" -ForegroundColor Green
} else {
    Write-Host "Missing $missing files - see MISS lines above" -ForegroundColor Yellow
}
