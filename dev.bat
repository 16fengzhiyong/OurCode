@echo off
title Nova Studio IDE - Quick Start
color 0A
cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies ...
    call npm install
)

echo.
echo [1/2] Checking for a running instance ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ourcode-instance.ps1" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [WARN] A running instance of OurCode IDE was detected.
    echo        This app is single-instance: the new window will NOT appear,
    echo        it would only focus the old window.
    echo        Close it first, or let this script kill it for you.
    echo.
    choice /C YN /M "Kill old instances and continue"
    if not errorlevel 2 (
        echo      Closing old instances ...
        powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ourcode-instance.ps1" -Kill >nul 2>&1
        timeout /t 1 /nobreak >nul
        echo      Done
    ) else (
        echo      Skipped - the new UI may not show up.
    )
    echo.
) else (
    echo      No running instance found
)
echo.

echo [2/2] Starting app ...
echo Starting Nova Studio IDE ...
echo Press Ctrl+C to exit
call npm run dev
