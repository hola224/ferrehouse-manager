@echo off
chcp 65001 >nul
title Ferrehouse Manager - actualizar

rem ===========================================================================
rem  Actualizar el sistema a la ultima version publicada.
rem
rem  OJO: este archivo es ASCII puro, a proposito -- ver INSTALAR.bat.
rem
rem  Hace lo mismo que INSTALAR.bat (que es idempotente a proposito) pero
rem  ademas RESPALDA ANTES de tocar nada y comprueba que el sistema quede
rem  contestando al final. Existe como archivo aparte por una razon que no es
rem  tecnica: quien lo va a correr no es quien lo escribio, y "ACTUALIZAR" es
rem  lo que esa persona busca cuando le dicen que hay una version nueva.
rem
rem  NO toca la base de datos, ni el .env, ni los respaldos, ni la sesion de
rem  WhatsApp. Solo el codigo.
rem ===========================================================================

net session >nul 2>&1
if not errorlevel 1 goto :soy_admin
echo.
echo  Pidiendo permisos de administrador...
echo.
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
)
exit /b

:soy_admin
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar.ps1" %*
set "SALIDA=%ERRORLEVEL%"
echo.
if not "%SALIDA%"=="0" echo  La actualizacion NO termino bien. El motivo esta mas arriba.
pause
exit /b %SALIDA%
