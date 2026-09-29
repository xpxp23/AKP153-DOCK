@echo off
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"
echo ================================================================
echo   休眠方案对比测试（约 30 秒）
echo.
echo   会依次测试 4 种休眠指令顺序，每种都会先唤醒再休眠，
echo   中间停 4 秒。请盯着设备屏幕，记住：
echo     哪一个方案让屏幕【彻底黑掉】，而不是【变暗/微亮】
echo.
echo   跑完把结果告诉助手即可。日志：logs\sleep-test.log
echo ================================================================
echo.
node "%~dp0host\sniff-sleep.js"
pause
