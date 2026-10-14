@echo off
rem TAKI Agentic AI - cai dat tren may Windows moi. Bam doi file nay (an toan khi chay lai nhieu lan).
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1" %*
set RC=%ERRORLEVEL%
echo.
if not "%RC%"=="0" (echo CAI DAT CHUA HOAN TAT ^(ma loi %RC%^). Xem file install.log, sua loi roi chay lai INSTALL.cmd.) else (echo CAI DAT XONG. Bam doi start-taki.cmd de chay he thong.)
pause
exit /b %RC%
