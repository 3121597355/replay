@echo off
cd /d "%~dp0"
"K:\node.exe" server.mjs
if errorlevel 1 pause
