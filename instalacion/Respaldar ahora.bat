@echo off
chcp 65001 >nul
title Ferrehouse - respaldar ahora

rem Acceso directo del escritorio. Se puede correr con la tienda vendiendo:
rem VACUUM INTO lee por la conexión y no bloquea nada más que un instante.

cd /d "%~dp0..\apps\server"
node dist\respaldar-cli.js
echo.
pause
