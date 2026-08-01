@echo off
chcp 65001 >nul
title Ferrehouse Manager - instalar

rem ===========================================================================
rem  Doble clic aca y listo.
rem
rem  OJO: este archivo es ASCII puro, a proposito. cmd relee el .bat byte a
rem  byte mientras lo ejecuta, y con `chcp 65001` activo una letra acentuada
rem  (dos bytes) corre la cuenta: cmd retoma la lectura a mitad de una linea
rem  y ejecuta pedazos de estos comentarios como si fueran comandos.
rem
rem  Este archivo no hace nada por su cuenta: pide la elevacion y le pasa el
rem  trabajo a instalar.ps1, que esta al lado. La logica vive alla porque un
rem  instalador que baja archivos, verifica hashes, edita el .env y registra
rem  una tarea programada no se escribe en lenguaje de lotes sin que termine
rem  siendo imposible de leer -- y esto lo va a leer alguien alguna vez.
rem
rem  Correrlo de nuevo ACTUALIZA la instalacion: baja la version nueva,
rem  recompila y reinicia, sin tocar la base de datos ni la configuracion.
rem
rem  Opciones (poco frecuentes), pasandoselas a este mismo .bat:
rem    INSTALAR.bat -Puerto 3001
rem    INSTALAR.bat -Destino "D:\Ferrehouse"
rem    INSTALAR.bat -DesdeCarpeta "E:\ferrehouse-manager"   (pendrive, sin bajar)
rem    INSTALAR.bat -ConDemo                                (40 productos falsos)
rem ===========================================================================

net session >nul 2>&1
if not errorlevel 1 goto :soy_admin

echo.
echo  Pidiendo permisos de administrador...
echo  (hacen falta para el firewall, el arranque automatico y la carpeta C:\)
echo.
rem  Sin argumentos no se puede pasar -ArgumentList: PowerShell rechaza una
rem  lista vacia y la elevacion muere antes de empezar.
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
)
exit /b

:soy_admin
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1" %*
set "SALIDA=%ERRORLEVEL%"

echo.
if not "%SALIDA%"=="0" (
  echo  La instalacion NO termino bien. El motivo esta mas arriba.
)
pause
exit /b %SALIDA%
