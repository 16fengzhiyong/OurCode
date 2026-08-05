@echo off
chcp 65001 >nul 2>&1
title Nova Studio IDE - Build ^& Run
color 0B

echo ============================================
echo   Nova Studio IDE - Build and Run Script
echo ============================================
echo.

cd /d "%~dp0"

echo [1/4] Checking node_modules ...
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

echo [2/4] TypeScript type check ...
call npx tsc --noEmit
if errorlevel 1 (
    echo [ERROR] Type check failed
    pause
    exit /b 1
)
echo      Passed
echo.

echo [3/4] Building project ...
call npx electron-vite build
if errorlevel 1 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)
echo      Build success
echo.

echo [4/4] Starting app ...
echo ============================================
echo   App is starting, look for the window
echo   Press Ctrl+C to exit
echo ============================================
echo.
call npm run dev
