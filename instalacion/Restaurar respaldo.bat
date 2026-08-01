@echo off
chcp 65001 >nul
title Ferrehouse - restaurar un respaldo

rem  El restaurador se niega a correr con el servidor arriba: pregunta por
rem  /api/health antes de tocar nada. Así que acá se detiene primero y se
rem  vuelve a levantar al final — sin eso, el supervisor relanza el servidor a
rem  los 5 segundos y la restauración choca contra su propio sistema.

net session >nul 2>&1
if not errorlevel 1 goto :soy_admin
echo.
echo  Pidiendo permisos de administrador (hay que detener el servidor)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b

:soy_admin
echo.
echo  Deteniendo el servidor...
schtasks /End /TN "FerrehouseManager" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*dist\main.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
timeout /t 3 /nobreak >nul

cd /d "%~dp0..\apps\server"
echo.
node dist\restaurar-cli.js --lista
echo.
echo  ---------------------------------------------------------------
echo   Para volver al mas reciente:   node dist\restaurar-cli.js --ultimo
echo   Para uno en particular:        node dist\restaurar-cli.js --archivo NOMBRE
echo.
echo   La base que hay AHORA no se borra: queda al lado con la fecha,
echo   por si restauraste el respaldo equivocado.
echo.
echo   Cuando termines, cierra esta ventana y el servidor vuelve solo
echo   (o corre:  schtasks /Run /TN "FerrehouseManager" ).
echo  ---------------------------------------------------------------
echo.
cmd /k
