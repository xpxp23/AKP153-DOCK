@echo off
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
echo   调试模式：Electron 在前台运行，报错会直接显示在这里。
echo   日志同时写入 logs\main.log
echo   --------------------------------------------------------
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
echo   --------------------------------------------------------
echo   Electron 已退出。
pause
