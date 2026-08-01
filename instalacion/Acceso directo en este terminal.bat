@echo off
chcp 65001 >nul
title Ferrehouse Manager - acceso directo en este terminal

rem  Para los PC que solo USAN el sistema, no el del meson que lo sirve.
rem  No instala nada y no pide permisos de administrador: deja un icono en el
rem  escritorio que abre la aplicacion contra el servidor.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0crear-acceso-terminal.ps1" %*
pause
