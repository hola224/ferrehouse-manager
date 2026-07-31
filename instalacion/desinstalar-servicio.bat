@echo off
chcp 65001 >nul
title Ferrehouse Manager - quitar el servicio

net session >nul 2>&1
if errorlevel 1 (
  echo  Hay que correrlo como administrador.
  pause
  exit /b 1
)

set "NSSM=%~dp0nssm.exe"
if not exist "%NSSM%" set "NSSM=nssm"

echo.
echo  Esto quita el SERVICIO, no borra la base de datos ni los respaldos.
echo.
pause

"%NSSM%" stop FerrehouseManager
"%NSSM%" remove FerrehouseManager confirm
echo.
echo  Listo.
pause
