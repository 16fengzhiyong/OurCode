@echo off
title Nova Studio IDE - Quick Start
color 0A
cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies ...
    call npm install
)

echo Starting Nova Studio IDE ...
call npm run dev
