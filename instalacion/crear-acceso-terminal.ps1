<#
    Dejar el acceso directo en un TERMINAL — un PC que no sirve el sistema,
    solo lo usa.

    Acá no se instala nada: el terminal no necesita Node, ni la base, ni el
    código. Necesita un ícono en el escritorio que abra el navegador contra el
    PC del mesón, sin barra de direcciones.

    No pide permisos de administrador a propósito: escribe en el escritorio del
    usuario que lo corre, que es exactamente donde tiene que aparecer.
#>
[CmdletBinding()]
param(
  [string] $Servidor = "",
  [int]    $Puerto   = 3000
)

$ErrorActionPreference = "Stop"
$NOMBRE = "Ferrehouse Manager"

Write-Host ""
Write-Host "  Acceso directo a $NOMBRE" -ForegroundColor White
Write-Host ""

if (-not $Servidor) {
  Write-Host "  Escribe la direccion del PC del meson (el que tiene el sistema)."
  Write-Host "  Es la que dijo el instalador al terminar, por ejemplo 192.168.1.10"
  Write-Host ""
  $Servidor = (Read-Host "  Direccion del servidor").Trim()
}
if (-not $Servidor) { Write-Host "  Sin direccion no hay nada que crear." -ForegroundColor Red; exit 1 }

$url = "http://${Servidor}:$Puerto"

# Se comprueba ANTES de crear el acceso. Un icono que existe y no abre nada es
# peor que ningun icono: se prueba el lunes a las 9, con clientes esperando.
Write-Host ""
Write-Host "  Probando $url ..." -ForegroundColor Gray
try {
  $r = Invoke-RestMethod "$url/api/health" -TimeoutSec 8
  if (-not $r.ok) { throw "contesto algo que no es el sistema" }
  Write-Host "  Contesta." -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "  NO contesta: $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "  Revisa que el PC del meson este encendido, que la direccion sea"
  Write-Host "  esa, y que el firewall de ese PC deje pasar el puerto $Puerto."
  Write-Host ""
  if ((Read-Host "  Crear el acceso directo igual? (s/N)") -notmatch '^[sS]') { exit 1 }
}

# El icono se baja del propio servidor: asi el terminal no depende de que
# alguien haya copiado un archivo suelto a la maquina correcta.
$icono = Join-Path $env:LOCALAPPDATA "Ferrehouse\ferrehouse.ico"
New-Item -ItemType Directory -Force (Split-Path $icono) | Out-Null
try {
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -UseBasicParsing "$url/ferrehouse.ico" -OutFile $icono -TimeoutSec 10
} catch {
  $icono = $null   # sin icono el acceso sirve igual, solo se ve generico
}

function BuscarNavegador {
  foreach ($c in @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )) { if (Test-Path $c) { return $c } }
  return $null
}

$navegador = BuscarNavegador
$destino = Join-Path ([Environment]::GetFolderPath("Desktop")) "$NOMBRE.lnk"

$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut($destino)
if ($navegador) {
  # --app: ventana propia, sin barra de direcciones. Sin barra no hay donde
  # escribir, y nadie se va a otra parte sin querer.
  $lnk.TargetPath = $navegador
  $lnk.Arguments = "--app=$url --window-size=1280,900"
} else {
  $lnk.TargetPath = $url
}
$lnk.Description = "$NOMBRE ($Servidor)"
if ($icono) { $lnk.IconLocation = "$icono,0" }
$lnk.Save()

Write-Host ""
Write-Host "  Listo: '$NOMBRE' en el escritorio, apuntando a $url" -ForegroundColor Green
Write-Host ""
Write-Host "  Recuerda que cada terminal entra con SU estacion: se elige en la"
Write-Host "  pantalla de entrada, al lado del usuario, y define de que ubicacion"
Write-Host "  sale el stock y a que impresora van sus tickets."
Write-Host ""
