Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       Switching to AKP153 Companion Mode" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

Write-Host "[1/3] Stopping StreamDock AJAZZ processes..." -ForegroundColor Yellow
Stop-Process -Name 'Stream Dock AJAZZ', 'Watcher', 'SplashScreen', 'streamdockSwitchAudio', 'streamdeck-batplug', 'ScreenCaptureTool' -Force -ErrorAction SilentlyContinue

Write-Host "[2/3] Waiting for USB HID port release (2s)..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

Write-Host "[3/3] Launching Bitfocus Companion..." -ForegroundColor Yellow
$companionExe = "C:\Program Files\Companion\Companion.exe"
$running = Get-Process -Name "Companion" -ErrorAction SilentlyContinue
if (-not $running) {
    if (Test-Path $companionExe) {
        $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine = "`"$companionExe`""; CurrentDirectory = "C:\Program Files\Companion"}
        if ($res.ReturnValue -eq 0) {
            Write-Host "[+] Bitfocus Companion launched successfully (PID: $($res.ProcessId))!" -ForegroundColor Green
        } else {
            Start-Process -FilePath $companionExe -WorkingDirectory "C:\Program Files\Companion"
            Write-Host "[+] Bitfocus Companion launched via fallback!" -ForegroundColor Green
        }
    } else {
        Write-Host "[-] Companion executable not found at $companionExe" -ForegroundColor Red
    }
} else {
    Write-Host "[+] Bitfocus Companion is already running." -ForegroundColor Green
}

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host " Companion Web Admin: http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "====================================================" -ForegroundColor Cyan

Start-Process "http://127.0.0.1:8000"
Start-Sleep -Seconds 2