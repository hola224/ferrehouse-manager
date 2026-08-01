<#
    Ferrehouse Manager — actualizar a la última versión publicada.

    Se apoya en `instalar.ps1`, que es idempotente, y le agrega las tres cosas
    que una actualización necesita y una instalación nueva no:

      1. Un RESPALDO antes de tocar nada, y la ruta escrita en pantalla.
      2. Guardar qué versión había, para poder decirlo si algo sale mal.
      3. Comprobar al final que el sistema volvió a contestar, y si no, decir
         exactamente qué hacer — que es restaurar ese respaldo.

    LO QUE NO HACE, y hay que decirlo derecho: NO vuelve atrás sola. Deshacer
    una migración de base de datos automáticamente es la clase de operación que
    cuando falla deja las cosas peor que el problema que venía a arreglar. Lo
    que sí hace es dejar el respaldo hecho, nombrado y a la vista, para que
    volver atrás sea una decisión de una persona y un solo comando.
#>
[CmdletBinding()]
param(
  [string] $Destino = "C:\Ferrehouse",
  [int]    $Puerto  = 3000,
  [string] $Rama    = "main",
  [string] $Repo    = "https://github.com/hola224/ferrehouse-manager"
)

$ErrorActionPreference = "Stop"
$SERVICIO = "FerrehouseManager"
$AQUI = Split-Path -Parent $MyInvocation.MyCommand.Path

function Bien([string]$m) { Write-Host "   $m" -ForegroundColor Green }
function Dato([string]$m) { Write-Host "   $m" -ForegroundColor Gray }
function Ojo ([string]$m) { Write-Host "   $m" -ForegroundColor Yellow }
function Morir([string]$m) { Write-Host ""; Write-Host "  $m" -ForegroundColor Red; Write-Host ""; exit 1 }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Morir "Hay que correrlo como administrador. Usa ACTUALIZAR.bat, que lo pide solo."
}

Write-Host ""
Write-Host "  ==========================================" -ForegroundColor White
Write-Host "   Ferrehouse Manager - actualizar" -ForegroundColor White
Write-Host "  ==========================================" -ForegroundColor White
Write-Host ""

if (-not (Test-Path (Join-Path $Destino "package.json"))) {
  Morir "En $Destino no hay una instalacion. Para instalar por primera vez usa INSTALAR.bat."
}

$servidor = Join-Path $Destino "apps\server"

# --- 1. Qué versión hay ahora -------------------------------------------------
# Si algo sale mal, «venías en la del 12 de julio» es más útil que «venías en
# la anterior». Sale del `mtime` del build, que es lo único que hay sin git.
$distMain = Join-Path $servidor "dist\main.js"
$versionPrevia = if (Test-Path $distMain) { (Get-Item $distMain).LastWriteTime.ToString("dd-MM-yyyy HH:mm") } else { "desconocida" }
Dato "Version instalada: $versionPrevia"

# --- 2. El respaldo, ANTES de nada -------------------------------------------
Write-Host ""
Write-Host "  [1] Respaldando antes de tocar nada" -ForegroundColor Cyan

$cli = Join-Path $servidor "dist\respaldar-cli.js"
$respaldoHecho = $false
if (Test-Path $cli) {
  Push-Location $servidor
  try {
    & node "dist\respaldar-cli.js"
    if ($LASTEXITCODE -eq 0) { $respaldoHecho = $true; Bien "Respaldo hecho" }
    else { Ojo "El respaldo termino con codigo $LASTEXITCODE" }
  } catch {
    Ojo "No pude respaldar: $($_.Exception.Message)"
  } finally { Pop-Location }
} else {
  Ojo "No encontre el programa de respaldo (la instalacion no esta compilada)."
}

if (-not $respaldoHecho) {
  Write-Host ""
  Ojo "NO SE PUDO RESPALDAR. Actualizar sin respaldo previo significa que si algo"
  Ojo "sale mal no hay a donde volver."
  $r = Read-Host "   Escribe SIGUE para continuar igual, o cualquier cosa para abortar"
  if ($r -ne "SIGUE") { Morir "Abortado. No se toco nada." }
}

$carpetaRespaldos = Join-Path $servidor "prisma\respaldos"
$ultimo = Get-ChildItem $carpetaRespaldos -Filter "*.db" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($ultimo) { Dato "Ultimo respaldo: $($ultimo.FullName)" }

# --- 3. La actualización propiamente tal --------------------------------------
Write-Host ""
Write-Host "  [2] Bajando y compilando la version nueva" -ForegroundColor Cyan
Dato "Esto puede tardar varios minutos."
Write-Host ""

$instalador = Join-Path $AQUI "instalar.ps1"
if (-not (Test-Path $instalador)) { Morir "Falta $instalador, que es quien hace el trabajo." }

& $instalador -Destino $Destino -Puerto $Puerto -Rama $Rama -Repo $Repo -SinTocarEnergia
$codigo = $LASTEXITCODE

# --- 4. ¿Quedó andando? -------------------------------------------------------
Write-Host ""
Write-Host "  [3] Comprobando" -ForegroundColor Cyan

$ok = $false
foreach ($i in 1..20) {
  Start-Sleep -Seconds 2
  try {
    if ((Invoke-RestMethod "http://127.0.0.1:$Puerto/api/health" -TimeoutSec 4).ok) { $ok = $true; break }
  } catch { }
}

if ($ok) {
  $nueva = if (Test-Path $distMain) { (Get-Item $distMain).LastWriteTime.ToString("dd-MM-yyyy HH:mm") } else { "?" }
  Write-Host ""
  Write-Host "  ==========================================" -ForegroundColor Green
  Write-Host "   Actualizado y andando." -ForegroundColor Green
  Write-Host "  ==========================================" -ForegroundColor Green
  Write-Host ""
  Write-Host "   Antes:  $versionPrevia"
  Write-Host "   Ahora:  $nueva"
  Write-Host ""
  Write-Host "   Revisa que el sistema abra y haz una venta de prueba antes"
  Write-Host "   de irte. Si vinculaste WhatsApp, el numero sigue vinculado."
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "   NO quedo andando." -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
Ojo "El instalador termino con codigo $codigo y el sistema no contesta."
Write-Host ""
$errores = Join-Path $Destino "logs\error.log"
if (Test-Path $errores) {
  Write-Host "   Ultimas lineas de $errores :" -ForegroundColor Gray
  Get-Content $errores -Tail 20
  Write-Host ""
}
Write-Host "   PARA VOLVER ATRAS:" -ForegroundColor Yellow
Write-Host "     1. Corre  instalacion\Restaurar respaldo.bat"
if ($ultimo) { Write-Host "     2. Elige:  $($ultimo.Name)" }
Write-Host "     3. Vuelve a levantar:  schtasks /Run /TN `"$SERVICIO`""
Write-Host ""
exit 1
