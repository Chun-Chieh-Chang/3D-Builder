@echo off
REM 3D-Builder One-Click Start
REM This batch file calls the PowerShell script for better functionality

echo ========================================
echo    3D-Builder One-Click Start
echo ========================================
echo.
echo [INFO] Launching PowerShell script...
echo.

REM Launch PowerShell script with bypass execution policy
powershell -ExecutionPolicy Bypass -File "%~dp0start-all.ps1"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start services.
    echo.
    pause
)
