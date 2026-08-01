@echo off
rem ===========================================================================
rem  El supervisor del servidor. Lo lanza la tarea programada "Ferrehouse
rem  Manager" al encender el PC, como SYSTEM y sin ventana.
rem
rem  POR QUE UN LAZO Y NO UN SERVICIO DE VERDAD. Node no sabe hablar con el
rem  administrador de servicios de Windows, asi que un servicio necesita un
rem  supervisor externo. El candidato clasico es NSSM, que hay que bajar de
rem  nssm.cc — un sitio que se cae, que no publica hash de sus binarios y que
rem  desde varias redes simplemente no responde. Cambiar "la tienda no puede
rem  instalarse hoy" por "el lazo reintenta cada 5 segundos" es un buen
rem  negocio: el Programador de tareas ya viene con Windows y no hay nada que
rem  bajar ni verificar.
rem
rem  Dos redes de proteccion, no una: este lazo levanta el servidor a los 5
rem  segundos de una caida, y si el lazo entero muriera, la tarea programada
rem  esta configurada para relanzarlo.
rem ===========================================================================

setlocal
set "RAIZ=%~dp0.."
set "SERVIDOR=%RAIZ%\apps\server"
set "LOGS=%RAIZ%\logs"
if not exist "%LOGS%" mkdir "%LOGS%"

set "SALIDA=%LOGS%\servidor.log"
set "ERRORES=%LOGS%\error.log"

cd /d "%SERVIDOR%"

:lazo
call :rotar "%SALIDA%"
call :rotar "%ERRORES%"

echo. >> "%SALIDA%"
echo === arrancando %DATE% %TIME% === >> "%SALIDA%"

node "dist\main.js" >> "%SALIDA%" 2>> "%ERRORES%"

echo === se cayo con codigo %ERRORLEVEL% el %DATE% %TIME%, reintento en 5s === >> "%ERRORES%"

rem `ping` y no `timeout`: corriendo como SYSTEM no hay consola, y `timeout`
rem falla en el acto con "no se admite la redireccion de entrada".
ping -n 6 127.0.0.1 >nul 2>&1
goto lazo

rem --- Rotacion de logs -------------------------------------------------------
rem Se hace al arrancar y no mientras corre, porque el archivo esta abierto.
rem Alcanza: este servidor no registra peticiones (Fastify va con logger:false),
rem asi que escribe unas pocas lineas por arranque, no un flujo continuo.
:rotar
if not exist %1 goto :eof
for %%A in (%1) do if %%~zA GTR 10485760 (
  if exist %1.1 del /q %1.1
  move /y %1 %1.1 >nul 2>&1
)
goto :eof
