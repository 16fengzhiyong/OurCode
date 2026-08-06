@echo off
chcp 65001 >nul 2>&1
title Nova Studio IDE - Build ^& Run
color 0B

echo ============================================
echo   Nova Studio IDE - Build and Run Script
echo ============================================
echo.

cd /d "%~dp0"

echo [1/5] Checking node_modules ...
if not exist "node_modules" (
    echo      Installing dependencies ...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    echo      Done
) else (
    echo      Already exists, skipping
)
echo.

echo [2/5] TypeScript type check ...
call npx tsc --noEmit
if errorlevel 1 (
    echo [ERROR] Type check failed
    pause
    exit /b 1
)
echo      Passed
echo.

echo [3/5] Building project ...
call npx electron-vite build
if errorlevel 1 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)
echo      Build success
echo.

echo [4/5] Checking for a running instance ...
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

echo [5/5] Starting app ...
echo ============================================
echo   App is starting, look for the window
echo   Press Ctrl+C to exit
echo ============================================
echo.
call npm run dev
