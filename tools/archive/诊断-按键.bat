@echo off
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
if not exist "%~dp0node_modules" (
  echo   [!] 先在本目录执行 npm install
  pause & exit /b 1
)
echo ================================================================
echo   按键诊断（全程约 60 秒，分 4 段）
echo.
echo   第 1~3 段：连续按几个不同的键
echo   第 4 段  ：【按住一个键不要松手】，数到 5 再松手
echo.
echo   每段前面都会有 >>> 提示，看到提示再动手。
echo   跑完会自动给出结论。
echo ================================================================
echo.
echo   [!] 如果本工具打不开设备，说明主程序正占用它：
echo       右键托盘图标退出 AKP153 控制台，再回来跑这个。
echo.
pause
node "%~dp0host\sniff-input.js" 15
echo.
echo 结果已写入 logs\input-sniff.log
pause
