Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       Restoring Official Stream Dock AJAZZ Mode" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

Write-Host "[1/3] Stopping Companion processes..." -ForegroundColor Yellow
Stop-Process -Name 'Companion', 'companion-electron', 'companion-service' -Force -ErrorAction SilentlyContinue

Write-Host "[2/3] Waiting for USB HID port release (2s)..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

Write-Host "[3/3] Launching official Stream Dock AJAZZ..." -ForegroundColor Yellow
$officialExe = "C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe"
if (Test-Path $officialExe) {
    Start-Process -FilePath $officialExe -WorkingDirectory (Split-Path $officialExe)
    Write-Host "[+] Stream Dock AJAZZ launched successfully!" -ForegroundColor Green
} else {
    Write-Host "[-] Official executable not found at $officialExe" -ForegroundColor Red
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " Official driver has resumed control." -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan
Start-Sleep -Seconds 2