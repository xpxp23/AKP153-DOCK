@echo off
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"

tasklist /FI "IMAGENAME eq Companion.exe" 2>nul | find /I "Companion.exe" >nul
if not errorlevel 1 (
  echo.
  echo   [!] 检测到 Companion 正在运行，它会独占 AKP153 的 USB 设备。
  echo       请先在 Companion 托盘图标上右键 ^-^> Quit，然后再启动本工具。
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo.
  echo   [!] 没找到 Electron。请在本目录执行：npm install
  echo.
  pause
  exit /b 1
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
