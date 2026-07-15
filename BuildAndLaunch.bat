@echo off
title TheTrainGame - Build ^& Launch
cd /d "%~dp0"

echo ============================================
echo   TheTrainGame - building and launching...
echo ============================================
echo.

call npm run test
if errorlevel 1 (
    echo.
    echo ********************************************
    echo   BUILD FAILED - the map was NOT launched.
    echo   See the errors above.
    echo ********************************************
    echo.
    pause
    exit /b 1
)
