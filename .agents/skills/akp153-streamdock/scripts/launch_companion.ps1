# PowerShell launcher for Bitfocus Companion
$paths = @(
    "C:\Program Files\Companion\Companion.exe",
    "C:\Program Files (x86)\Companion\Companion.exe",
    "$env:LOCALAPPDATA\Programs\companion\Companion.exe",
    "$env:ProgramFiles\Bitfocus\Companion\Companion.exe"
)

$found = $null
foreach ($p in $paths) {
    if (Test-Path $p) {
        $found = $p
        break
    }
}

if (-not $found) {
    $cmd = Get-Command "companion" -ErrorAction SilentlyContinue
    if ($cmd) {
        $found = $cmd.Source
    }
}

if ($found) {
    Write-Host "[+] 找到 Companion 路径: $found" -ForegroundColor Green
    Start-Process -FilePath $found
    Write-Host "[+] Companion 启动成功！" -ForegroundColor Green
} else {
    Write-Host "[-] 未找到 Companion 安装路径，请确认是否已完成安装。" -ForegroundColor Yellow
}
