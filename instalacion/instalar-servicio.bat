@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Ferrehouse Manager - instalar el servicio

rem ===========================================================
rem  Tarea 7.1 - servicio de Windows con NSSM.
rem
rem  ATENCIÓN: este script NO está probado. Todo lo demás del
rem  Sprint 7 se probó de verdad (el respaldo y la restauración
rem  tienen 22 pruebas automáticas que borran la base y la
rem  recuperan), pero acá no hay ninguna máquina Windows para
rem  ejercitarlo. Léelo antes de correrlo y ten a mano el
rem  README.md de esta misma carpeta.
rem
rem  Los logs los rota NSSM, no la aplicación: AppRotateFiles.
rem  Escribir un rotador en Node sería duplicar algo que el
rem  supervisor ya hace mejor, porque él es el dueño del archivo.
rem ===========================================================

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Esto hay que correrlo COMO ADMINISTRADOR.
  echo  Cierra esta ventana, haz clic derecho en el archivo
  echo  y elige "Ejecutar como administrador".
  echo.
  pause
  exit /b 1
)

rem La carpeta del repositorio: este script vive en <repo>\instalacion
set "REPO=%~dp0.."
pushd "%REPO%"
set "REPO=%CD%"
popd

set "SERVICIO=FerrehouseManager"
set "SERVIDOR=%REPO%\apps\server"
set "LOGS=%REPO%\logs"

echo.
echo  Repositorio: %REPO%
echo  Servicio:    %SERVICIO%
echo.

rem --- Node ---
where node >nul 2>&1
if errorlevel 1 (
  echo  No encuentro node.exe en el PATH. Instala Node 22 y vuelve a intentar.
  pause
  exit /b 1
)
for /f "delims=" %%N in ('where node') do set "NODE=%%N" & goto :tengo_node
:tengo_node
echo  Node:        %NODE%

rem --- NSSM ---
set "NSSM=%~dp0nssm.exe"
if not exist "%NSSM%" (
  where nssm >nul 2>&1
  if errorlevel 1 (
    echo.
    echo  Falta nssm.exe. Bájalo de https://nssm.cc y déjalo en esta carpeta.
    echo  Es un solo archivo, no se instala.
    pause
    exit /b 1
  )
  for /f "delims=" %%N in ('where nssm') do set "NSSM=%%N" & goto :tengo_nssm
)
:tengo_nssm
echo  NSSM:        %NSSM%

rem --- El archivo .env ---
rem El JWT_SECRET de desarrollo NO puede quedar en la tienda: con él
rem cualquiera en la LAN se firma un token de administrador.
if not exist "%SERVIDOR%\.env" (
  echo.
  echo  Creando %SERVIDOR%\.env con una clave nueva...
  for /f "delims=" %%S in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set "SECRETO=%%S"
  > "%SERVIDOR%\.env" echo DATABASE_URL="file:./ferrehouse.db?connection_limit=1"
  >>"%SERVIDOR%\.env" echo JWT_SECRET="!SECRETO!"
  >>"%SERVIDOR%\.env" echo PORT=3000
  >>"%SERVIDOR%\.env" echo NODE_ENV=production
  echo  Listo. Guarda una copia de ese archivo: sin la clave, todos los
  echo  terminales quedan afuera cuando se reinicie el servicio.
) else (
  echo.
  echo  Ya existe %SERVIDOR%\.env, no lo toco.
  findstr /C:"dev-solo-para-desarrollo" "%SERVIDOR%\.env" >nul && (
    echo.
    echo  *** OJO: ese .env todavía tiene la clave de desarrollo. ***
    echo  *** Cámbiala antes de abrir la tienda.                  ***
  )
)

if not exist "%LOGS%" mkdir "%LOGS%"

rem --- El servicio ---
"%NSSM%" status %SERVICIO% >nul 2>&1
if not errorlevel 1 (
  echo.
  echo  El servicio ya existe. Lo detengo para reconfigurarlo.
  "%NSSM%" stop %SERVICIO% >nul 2>&1
) else (
  "%NSSM%" install %SERVICIO% "%NODE%"
)

"%NSSM%" set %SERVICIO% Application "%NODE%"
"%NSSM%" set %SERVICIO% AppParameters "dist\main.js"
"%NSSM%" set %SERVICIO% AppDirectory "%SERVIDOR%"
"%NSSM%" set %SERVICIO% DisplayName "Ferrehouse Manager"
"%NSSM%" set %SERVICIO% Description "Sistema de la ferretería: catálogo, caja, ventas e inventario."
"%NSSM%" set %SERVICIO% Start SERVICE_AUTO_START

rem Reinicio automático. AppThrottle es el que evita el peor modo de falla:
rem el servidor se NIEGA a arrancar si el seed está incompleto, y sin
rem throttle NSSM lo relanzaría varias veces por segundo llenando el disco
rem de logs. Con 10 s, si se cae al arrancar espera antes de reintentar.
"%NSSM%" set %SERVICIO% AppExit Default Restart
"%NSSM%" set %SERVICIO% AppRestartDelay 5000
"%NSSM%" set %SERVICIO% AppThrottle 10000

rem Apagado limpio: Ctrl+C primero, que main.ts sabe atender; matar es el
rem último recurso. Así el WAL queda consolidado antes de que se apague.
"%NSSM%" set %SERVICIO% AppStopMethodConsole 10000
"%NSSM%" set %SERVICIO% AppStopMethodWindow 5000
"%NSSM%" set %SERVICIO% AppStopMethodThreads 5000

rem Logs: los rota NSSM. 10 MB por archivo, en línea (sin detener el
rem servicio para rotar).
"%NSSM%" set %SERVICIO% AppStdout "%LOGS%\servidor.log"
"%NSSM%" set %SERVICIO% AppStderr "%LOGS%\error.log"
"%NSSM%" set %SERVICIO% AppRotateFiles 1
"%NSSM%" set %SERVICIO% AppRotateOnline 1
"%NSSM%" set %SERVICIO% AppRotateBytes 10485760

echo.
echo  Arrancando...
"%NSSM%" start %SERVICIO%

timeout /t 5 /nobreak >nul
echo.
echo  Probando que conteste...
curl -s http://127.0.0.1:3000/api/health
if errorlevel 1 (
  echo.
  echo  No contestó. Mira %LOGS%\error.log: el servidor dice en palabras
  echo  por qué no arrancó (falta el seed, falta connection_limit, etc.).
) else (
  echo.
  echo.
  echo  Servicio instalado y andando.
  echo  Los terminales entran a http://%COMPUTERNAME%:3000
)
echo.
pause
