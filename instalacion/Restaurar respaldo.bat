@echo off
chcp 65001 >nul
title Ferrehouse - restaurar un respaldo

rem El programa se niega solo si el servidor está arriba: pregunta por
rem /api/health antes de tocar nada. Igual conviene detenerlo primero.

cd /d "%~dp0..\apps\server"
node dist\restaurar-cli.js --lista
echo.
echo  Para volver al más reciente, escribe:   node dist\restaurar-cli.js --ultimo
echo.
cmd /k
