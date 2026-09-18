@echo off
chcp 65001 >nul
title 画师库 - 重新生成网页
cd /d "%~dp0"

echo.
echo   画师库 · 重新生成「画师库.html」
echo   ======================================
echo.
echo   提示：如果你正在浏览器里打开「画师库.html」，请先关闭它。
echo.

call npm run build
if errorlevel 1 goto failed

echo.
echo   校验产物与源码是否一致...
echo.
node build.test.mjs
if errorlevel 1 goto mismatch

echo.
echo   [完成] 「画师库.html」已更新，可以直接双击打开使用。
echo.
pause
exit /b 0

:mismatch
echo.
echo   [警告] 产物与源码不一致！请把上面这段信息发给协助你的人。
echo.
pause
exit /b 1

:failed
echo.
echo   [失败] 构建没有完成，常见原因：
echo     1. 浏览器里还开着「画师库.html」，请关闭后重试；
echo     2. 没有安装 Node.js 20 或更高版本，见 https://nodejs.org 。
echo.
pause
exit /b 1