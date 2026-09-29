# PowerShell launcher for official Ajazz Stream Dock
$officialPath = "C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe"

if (Test-Path $officialPath) {
    Write-Host "[+] 正在拉起黑爵官方驱动: $officialPath" -ForegroundColor Green
    Start-Process -FilePath $officialPath -WorkingDirectory (Split-Path $officialPath)
    Write-Host "[+] 黑爵驱动已成功启动。" -ForegroundColor Green
} else {
    Write-Host "[-] 未找到黑爵官方驱动路径: $officialPath" -ForegroundColor Red
}
