@echo off
rem Double-click friendly wrapper around run-tui.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-tui.ps1" %*
