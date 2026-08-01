<#
    Ferrehouse Manager — quitar la instalación de este PC.

    Deshace lo que puso el instalador en el SISTEMA: la tarea programada, los
    accesos directos y la regla de firewall.

    NO borra la carpeta, ni la base de datos, ni los respaldos, ni el .env.
    Eso queda donde está, y a propósito: la razón más común para correr esto
    es reinstalar o mover el sistema a otro PC, y ahí borrar los datos sería
    exactamente lo contrario de lo que se quería. Lo dice al terminar, con la
    ruta, para que quien de verdad quiera borrarlos sepa dónde están.
#>
[CmdletBinding()]
param(
  [string] $Destino = "C:\Ferrehouse",
  [int]    $Puerto  = 3000
)

$ErrorActionPreference = "Continue"
$SERVICIO = "FerrehouseManager"
$NOMBRE   = "Ferrehouse Manager"

function Bien([string]$m) { Write-Host "   $m" -ForegroundColor Green }
function Dato([string]$m) { Write-Host "   $m" -ForegroundColor Gray }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "  Hay que correrlo como administrador. Usa DESINSTALAR.bat." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  Quitando $NOMBRE de este PC" -ForegroundColor White
Write-Host "  (la base de datos y los respaldos NO se tocan)" -ForegroundColor Gray
Write-Host ""

# --- El arranque automático ---
if (Get-ScheduledTask -TaskName $SERVICIO -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $SERVICIO -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $SERVICIO -Confirm:$false -ErrorAction SilentlyContinue
  Bien "Tarea programada quitada"
} else {
  Dato "No había tarea programada"
}

# El supervisor relanza `node` a los 5 segundos, así que hay que bajarlo
# después de quitar la tarea, no antes.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*dist\main.js*" } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Bien "Servidor detenido (pid $($_.ProcessId))"
  }

# --- Los accesos directos ---
$accesos = @(
  (Join-Path $env:PUBLIC "Desktop\$NOMBRE.lnk"),
  (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\$NOMBRE.lnk"),
  (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\StartUp\$NOMBRE.lnk"),
  (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\StartUp\$NOMBRE - vigilante.lnk")
)
$quitados = 0
foreach ($a in $accesos) {
  if (Test-Path $a) { Remove-Item $a -Force -ErrorAction SilentlyContinue; $quitados++ }
}
if ($quitados) { Bien "$quitados acceso(s) directo(s) quitado(s)" } else { Dato "No había accesos directos" }

# --- El vigilante de la bandeja ---
# Corre en la sesión del usuario, así que no lo alcanza nada de lo de arriba:
# hay que bajarlo por su línea de comandos, que es lo único que lo distingue de
# cualquier otro PowerShell abierto.
$vigilantes = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*vigilante.ps1*" }
if ($vigilantes) {
  $vigilantes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Bien "Vigilante de la bandeja detenido"
}

# --- El firewall ---
$regla = Get-NetFirewallRule -DisplayName "Ferrehouse Manager*" -ErrorAction SilentlyContinue
if ($regla) {
  $regla | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  Bien "Regla de firewall quitada"
} else {
  Dato "No había regla de firewall"
}

Write-Host ""
Write-Host "  Listo." -ForegroundColor Green
Write-Host ""
Write-Host "  Lo que NO se borro y sigue en el disco:" -ForegroundColor Yellow
Write-Host "    $Destino\apps\server\prisma\ferrehouse.db   la base de datos"
Write-Host "    $Destino\apps\server\prisma\respaldos\      los respaldos"
Write-Host "    $Destino\apps\server\.env                   la clave de firma"
Write-Host ""
Write-Host "  Si vas a reinstalar o mudar el sistema a otro PC, eso es"
Write-Host "  justamente lo que hay que llevarse."
Write-Host ""
