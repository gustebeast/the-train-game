@echo off
REM Opens the test VM wall: all four test VMs tiled 2x2, live over VNC.
REM Tiles go dark when a VM is powered off and relight by themselves when a
REM test boots one. Safe to leave open; it never sends input to the guests.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\vmtest\vm-wall.ps1" %*
