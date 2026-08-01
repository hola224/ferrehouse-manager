@echo off
chcp 65001 >nul
title Ferrehouse Manager - desinstalar

rem  Quita el arranque automatico, los accesos directos y la regla de firewall.
rem  NO borra la base de datos, ni los respaldos, ni el .env: eso se borra a
rem  mano, a proposito, y despues de mirar que hay adentro.
rem  (ASCII puro a proposito -- ver INSTALAR.bat.)

net session >nul 2>&1
if not errorlevel 1 goto :soy_admin
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
)
exit /b

:soy_admin
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desinstalar.ps1" %*
pause
