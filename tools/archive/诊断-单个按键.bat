@echo off
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"

if "%~1"=="" (
  echo ================================================================
  echo   单个按键诊断
  echo.
  echo   把一个程序 / 快捷方式 / 文件夹拖到本文件上，
  echo   它会告诉你这个键按下去会发生什么，并真的执行一次。
  echo.
  echo   命令行用法：  npm run check -- "D:\路径\xx.exe" --run
  echo ================================================================
  echo.
  pause
  exit /b 1
)

echo ================================================================
echo   目标: %~1
echo ================================================================
echo.
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0tools\check-target.js" "%~1" --run
echo.
echo 结果同时写入 logs\check-target.log
pause
