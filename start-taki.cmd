@echo off
rem TAKI Agentic AI - chay he thong tren Windows (API 8787, giao dien 5173, ZL-CRM 3000/5174, PostgreSQL ZL-CRM 5433)
rem Bam doi file nay. Dung: dong cua so nay (hoac Ctrl+C).
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Chua co Node.js - hay chay INSTALL.cmd truoc. & pause & exit /b 1)
where pnpm >nul 2>nul || (echo Chua co pnpm - hay chay INSTALL.cmd truoc. & pause & exit /b 1)
if not exist "node_modules" (echo Chua cai thu vien - hay chay INSTALL.cmd truoc. & pause & exit /b 1)
start "" "http://localhost:5173"
call pnpm dev
pause
