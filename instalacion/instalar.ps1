<#
    Ferrehouse Manager — instalación completa en el PC de la tienda.

    Esto lo lanza INSTALAR.bat, que se encarga de pedir la elevación. Correrlo
    a mano también sirve:  powershell -ExecutionPolicy Bypass -File instalar.ps1

    Deja el PC sirviendo el sistema a los terminales, arrancando solo al
    encender, levantándose solo si se cae, y con un acceso directo que abre la
    aplicación sin barra de direcciones.

    ES IDEMPOTENTE, y eso es lo que lo hace también el actualizador: correrlo de
    nuevo baja la versión nueva, recompila y reinicia el servicio SIN tocar la
    base de datos, el .env ni los respaldos. Esa es la razón de que cada paso
    pregunte antes de escribir en vez de escribir y ver qué pasa.
#>
[CmdletBinding()]
param(
  [string] $Destino   = "C:\Ferrehouse",
  [int]    $Puerto    = 3000,
  [string] $Rama      = "main",
  [string] $Repo      = "https://github.com/hola224/ferrehouse-manager",
  # Instalar desde una copia ya bajada (pendrive, o el repo de desarrollo) en
  # vez de descargar. Útil sin internet y para probar el instalador.
  [string] $DesdeCarpeta = "",
  # Los 40 productos de ejemplo. En una tienda de verdad NO se cargan: se
  # mezclan con el catálogo real y después hay que ir a buscarlos uno por uno.
  [switch] $ConDemo,
  # Dejar el PC sin suspensión ni apagado de disco. Un servidor suspendido es
  # un servidor caído, y es la causa número uno de "no funciona" a las 15:00.
  [switch] $SinTocarEnergia
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"   # las barras de Invoke-WebRequest son lentísimas

$SERVICIO   = "FerrehouseManager"
$NOMBRE     = "Ferrehouse Manager"
$AQUI       = Split-Path -Parent $MyInvocation.MyCommand.Path
$TRABAJO    = Join-Path $env:TEMP "ferrehouse-instalador"

# ---------------------------------------------------------------- utilidades

$script:paso = 0
function Paso([string]$titulo) {
  $script:paso++
  Write-Host ""
  Write-Host ("  [{0}] {1}" -f $script:paso, $titulo) -ForegroundColor Cyan
}
function Bien([string]$m) { Write-Host "      $m" -ForegroundColor Green }
function Dato([string]$m) { Write-Host "      $m" -ForegroundColor Gray }
function Ojo ([string]$m) { Write-Host "      $m" -ForegroundColor Yellow }
function Morir([string]$m) { Write-Host ""; Write-Host "  $m" -ForegroundColor Red; Write-Host ""; exit 1 }

<#
  Correr un ejecutable y MORIR si falla, en vez de seguir con el paso
  siguiente. Sin esto, un `pnpm install` que se cae por falta de red termina
  con un servicio instalado que apunta a un dist que no existe: el servicio
  queda "instalado y andando" según el administrador de servicios, y en
  pantalla no hay nada. El error tiene que salir donde se produjo.
#>
function Correr([string]$exe, [string[]]$argumentos, [string]$dondeFalla, [string]$cwd = $null) {
  $anterior = $null
  if ($cwd) { $anterior = (Get-Location).Path; Set-Location $cwd }
  try {
    & $exe @argumentos
    if ($LASTEXITCODE -ne 0) { Morir "$dondeFalla (código $LASTEXITCODE)" }
  } finally {
    if ($anterior) { Set-Location $anterior }
  }
}

function RefrescarPath {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User")
}

function Existe([string]$cmd) {
  $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

function BajarVerificando([string]$url, [string]$destino, [string]$sha256) {
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $destino
  if ($sha256) {
    $real = (Get-FileHash $destino -Algorithm SHA256).Hash.ToLower()
    if ($real -ne $sha256.ToLower()) {
      Remove-Item $destino -Force -ErrorAction SilentlyContinue
      Morir "El archivo bajado de $url no coincide con su hash publicado. Se aborta."
    }
  }
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor White
Write-Host "   Ferrehouse Manager - instalar en la tienda" -ForegroundColor White
Write-Host "  ============================================" -ForegroundColor White
Dato "Destino: $Destino"
Dato "Puerto:  $Puerto"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
      ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Morir "Hay que correr esto como administrador. Usa INSTALAR.bat, que lo pide solo."
}

New-Item -ItemType Directory -Force $TRABAJO | Out-Null

# ------------------------------------------------------------------- 1. Node

Paso "Node 22"

$nodeVersion = $null
if (Existe "node") { try { $nodeVersion = (& node --version) } catch {} }
$nodeSirve = $nodeVersion -match '^v(\d+)' -and [int]$Matches[1] -ge 22

if ($nodeSirve) {
  Bien "Ya está: $nodeVersion"
} else {
  if ($nodeVersion) { Ojo "Hay Node $nodeVersion, pero hacen falta 22 o más. Se instala al lado." }
  Dato "Buscando la última versión 22 en nodejs.org..."

  # El nombre del .msi y su hash salen del SHASUMS256.txt oficial, así que no
  # hay ninguna versión escrita a mano en este script que se quede vieja.
  $sumas = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt").Content
  $linea = ($sumas -split "`n" | Where-Object { $_ -match 'node-v[\d.]+-x64\.msi\s*$' } | Select-Object -First 1)
  if (-not $linea) { Morir "No pude averiguar cuál es el instalador de Node 22 en nodejs.org." }
  $sha, $archivo = ($linea.Trim() -split '\s+')

  $msi = Join-Path $TRABAJO $archivo
  Dato "Bajando $archivo ..."
  BajarVerificando "https://nodejs.org/dist/latest-v22.x/$archivo" $msi $sha
  Dato "Instalando en silencio (esto tarda un poco)..."
  Correr "msiexec.exe" @("/i", $msi, "/qn", "/norestart") "Falló la instalación de Node"

  RefrescarPath
  if (-not (Existe "node")) { Morir "Node quedó instalado pero no aparece en el PATH. Reinicia el PC y vuelve a correr esto." }
  Bien "Instalado: $(& node --version)"
}

# ------------------------------------------------------------------- 2. pnpm

Paso "pnpm"

# Por corepack, que respeta el `packageManager` del package.json: instalar pnpm
# suelto con npm deja una versión distinta a la que fijó el proyecto y el
# lockfile empieza a dar diferencias que nadie pidió.
Correr "corepack" @("enable") "No pude habilitar corepack"
Bien "corepack habilitado"

# ---------------------------------------------------- 3. El código de la app

Paso "El código de la aplicación"

# Los papeles de trabajo del desarrollo no van al PC de la tienda: no le sirven
# a nadie ahí y solo confunden a quien abra la carpeta buscando algo.
$carpetasFuera = @(".agents", ".github", ".claude", "design_handoff_marca_ferrehouse")
$archivosFuera = @("CLAUDE.md", "BITACORA.md", "SPRINTS.md", "STATE.md", "STATE UI.md",
                   "REVISION.md", "USE-CASES.md", "UI-BRIEF.md")

if ($DesdeCarpeta) {
  if (-not (Test-Path (Join-Path $DesdeCarpeta "package.json"))) {
    Morir "En $DesdeCarpeta no hay un package.json: esa no es la carpeta del proyecto."
  }
  $origen = (Resolve-Path $DesdeCarpeta).Path
  Bien "Desde la carpeta $origen (sin descargar)"
} else {
  $zip = Join-Path $TRABAJO "ferrehouse.zip"
  $desc = Join-Path $TRABAJO "desempacado"
  Remove-Item $desc -Recurse -Force -ErrorAction SilentlyContinue
  Dato "Bajando $Repo (rama $Rama)..."
  BajarVerificando "$Repo/archive/refs/heads/$Rama.zip" $zip $null
  Expand-Archive -Path $zip -DestinationPath $desc -Force
  $origen = (Get-ChildItem $desc -Directory | Select-Object -First 1).FullName
  if (-not $origen) { Morir "El ZIP bajado venía vacío." }
  Bien "Descargado"
}

# Si el servicio ya existe hay que detenerlo ANTES de escribir: Windows no deja
# reemplazar un archivo que un proceso vivo tiene abierto, y el síntoma sería
# una copia a medias — peor que no haber copiado nada.
if (Get-ScheduledTask -TaskName $SERVICIO -ErrorAction SilentlyContinue) {
  Dato "Ya hay una instalación andando: la detengo para actualizar."
  Stop-ScheduledTask -TaskName $SERVICIO -ErrorAction SilentlyContinue
  # El lazo supervisor relanza `node` a los 5 segundos, así que detener la
  # tarea no alcanza: hay que bajar también el proceso que ya está sirviendo,
  # o el `dist\main.js` sigue abierto y la copia falla a medias.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$($Destino.Replace('\','\\'))*" -or $_.CommandLine -like "*dist\main.js*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 3
}

# Un respaldo antes de tocar nada, si ya había una instalación con base.
$cliRespaldo = Join-Path $Destino "apps\server\dist\respaldar-cli.js"
if (Test-Path $cliRespaldo) {
  Dato "Respaldando la base antes de actualizar..."
  Push-Location (Join-Path $Destino "apps\server")
  try { & node "dist\respaldar-cli.js" | Out-Null; Bien "Respaldo hecho" }
  catch { Ojo "No pude respaldar automáticamente: $($_.Exception.Message)" }
  finally { Pop-Location }
}

New-Item -ItemType Directory -Force $Destino | Out-Null

# Los `dist` viejos se borran antes de copiar: un archivo que dejó de existir
# en el código nuevo se quedaría ahí para siempre, y en la web eso significa
# que el index sigue nombrando un asset que ya nadie genera.
Get-ChildItem -Path (Join-Path $Destino "apps"), (Join-Path $Destino "packages") -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item (Join-Path $_.FullName "dist") -Recurse -Force -ErrorAction SilentlyContinue }

$argsRobo = @($origen, $Destino, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:2")
# `.wa-sesion` va en la lista por la misma razón que la base y el `.env`: son
# las credenciales del número vinculado, y pisarlas obliga a escanear el QR de
# nuevo con el teléfono en la mano.
$argsRobo += "/XD"; $argsRobo += $carpetasFuera; $argsRobo += @("node_modules", "respaldos", "logs", ".wa-sesion")
# `.env`, la base y sus archivos de WAL NO se pisan jamás: son lo único
# irreemplazable que hay en ese PC.
$argsRobo += "/XF"; $argsRobo += $archivosFuera; $argsRobo += @(".env", "*.db", "*.db-wal", "*.db-shm")
& robocopy.exe @argsRobo | Out-Null
if ($LASTEXITCODE -ge 8) { Morir "Falló la copia de archivos a $Destino (robocopy $LASTEXITCODE)" }
Bien "Código instalado en $Destino"

# --------------------------------------------------------------- 4. El .env

Paso "Configuración (.env)"

$envPath = Join-Path $Destino "apps\server\.env"
$publicos = @("cambiar", "cambiar-en-instalacion", "dev-solo-para-desarrollo", "test-secret")

function NuevoSecreto {
  $b = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  ($b | ForEach-Object { $_.ToString("x2") }) -join ""
}
function NuevoPin {
  # 6 dígitos de verdad al azar. Se descartan los que no se pueden dictar por
  # teléfono sin que el otro pregunte dos veces.
  do {
    $b = New-Object byte[] 4
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    $n = [Math]::Abs([BitConverter]::ToInt32($b, 0)) % 1000000
    $pin = $n.ToString("000000")
  } while ($pin -match '^(\d)\1{5}$' -or $pin -eq "123456" -or $pin -eq "000000")
  $pin
}

$pinAdmin = $null; $pinVendedor = $null

if (Test-Path $envPath) {
  Bien "Ya existe: no lo toco (ahí está la clave que firma las sesiones)"
  $actual = Get-Content $envPath -Raw
  if ($actual -match 'JWT_SECRET\s*=\s*"?([^"\r\n]*)"?') {
    if ($publicos -contains $Matches[1]) {
      Ojo "Ese .env todavía tiene la clave de EJEMPLO del repositorio."
      Ojo "Es pública: con ella, cualquiera en la red se firma un token de administrador."
      Ojo "Se reemplaza por una nueva. Los terminales tendrán que entrar de nuevo."
      $actual = $actual -replace 'JWT_SECRET\s*=\s*"?[^"\r\n]*"?', ('JWT_SECRET="' + (NuevoSecreto) + '"')
      [IO.File]::WriteAllText($envPath, $actual, (New-Object Text.UTF8Encoding($false)))
    }
  }
} else {
  $pinAdmin = NuevoPin
  $pinVendedor = NuevoPin
  $contenido = @"
# Generado por el instalador. NO se sube a ningún repositorio.

# connection_limit=1 NO es cosmético: serializa las escrituras. Sin él, dos
# ventas simultáneas del mismo producto corrompen el saldo del libro de stock
# en silencio (ADR-006).
DATABASE_URL="file:./ferrehouse.db?connection_limit=1"

# Firma las sesiones. Si se pierde, todos los terminales quedan afuera en el
# próximo reinicio del servicio. GUARDA UNA COPIA DE ESTE ARCHIVO.
JWT_SECRET="$(NuevoSecreto)"

PORT=$Puerto
NODE_ENV=production

# Solo los usa el PRIMER seed, al crear los usuarios. El instalador borra estas
# dos líneas apenas termina de sembrar: un PIN en texto plano dentro de un
# archivo que nadie vuelve a mirar es un PIN que sigue sirviendo dentro de dos
# años, cuando el vendedor que lo usaba ya no trabaja acá.
SEED_ADMIN_PIN="$pinAdmin"
SEED_SELLER_PIN="$pinVendedor"
"@
  [IO.File]::WriteAllText($envPath, $contenido, (New-Object Text.UTF8Encoding($false)))
  Bien "Creado con clave nueva y PIN sorteados"
}

# ------------------------------------------------ 5. Dependencias y compilar

Paso "Dependencias y compilación"

Dato "pnpm install (la primera vez tarda varios minutos)..."
Correr "pnpm" @("install", "--frozen-lockfile", "--prod=false") "Falló pnpm install" $Destino
Bien "Dependencias instaladas"

# El cliente de Prisma ANTES de compilar: `tsc` del servidor necesita los tipos
# generados. Al revés compila con los tipos de la instalación anterior —o no
# compila— y el error habla de módulos que no existen, no de Prisma.
$servidor = Join-Path $Destino "apps\server"
Correr "pnpm" @("exec", "prisma", "generate") "Falló prisma generate" $servidor

Dato "Compilando el servidor y la pantalla..."
Correr "pnpm" @("build") "Falló la compilación" $Destino

# Sin esto el servidor levanta y contesta el API, pero el terminal que entra
# ve una página en blanco y del lado del servidor no hay ningún síntoma.
$indice = Join-Path $Destino "apps\web\dist\index.html"
if (-not (Test-Path $indice)) { Morir "La compilación terminó sin errores pero no dejó apps\web\dist\index.html." }
Bien "Compilado (la pantalla la sirve el mismo servidor, en el puerto $Puerto)"

# ------------------------------------------------------- 6. Base de datos

Paso "Base de datos"

Correr "pnpm" @("exec", "prisma", "migrate", "deploy") "Fallaron las migraciones" $servidor
Bien "Migraciones al día"

Dato "Sembrando (es idempotente: si ya había datos, no los toca)..."
Correr "pnpm" @("exec", "tsx", "prisma/seed.ts") "Falló el seed" $servidor

if ($ConDemo) {
  Ojo "Cargando los 40 productos de EJEMPLO (--ConDemo)."
  Correr "pnpm" @("exec", "tsx", "prisma/demo.ts") "Falló la carga de demostración" $servidor
}

# Los PIN ya están sembrados y hasheados: las dos líneas del .env dejaron de
# tener utilidad y pasaron a ser solo una copia en texto plano.
if ($pinAdmin) {
  $sinPines = (Get-Content $envPath) | Where-Object { $_ -notmatch '^\s*SEED_(ADMIN|SELLER)_PIN=' }
  [IO.File]::WriteAllLines($envPath, $sinPines, (New-Object Text.UTF8Encoding($false)))
  Bien "PIN sembrados y borrados del .env"
}

# --------------------------------------------------------------- 7. Energía

Paso "Que el PC no se duerma"

if ($SinTocarEnergia) {
  Ojo "Omitido (--SinTocarEnergia). Revisa a mano que no se suspenda."
} else {
  # Enchufado: nunca suspender, nunca apagar el disco, nunca apagar la
  # pantalla no importa. SQLite con el disco dormido da errores de escritura
  # raros e intermitentes, y un servidor suspendido simplemente no está.
  & powercfg /change standby-timeout-ac 0        2>&1 | Out-Null
  & powercfg /change hibernate-timeout-ac 0      2>&1 | Out-Null
  & powercfg /change disk-timeout-ac 0           2>&1 | Out-Null
  # Cerrar la tapa de un notebook no puede apagar la tienda.
  & powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 2>&1 | Out-Null
  & powercfg /setactive SCHEME_CURRENT           2>&1 | Out-Null
  Bien "Suspensión, hibernación y apagado de disco desactivados (con corriente)"
}

# -------------------------------------------------------------- 8. Firewall

Paso "Firewall"

$regla = "Ferrehouse Manager ($Puerto)"
Get-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
# Solo perfil privado: la red de la tienda. En una red pública —un notebook que
# sale a un café— este puerto no tiene por qué estar abierto.
New-NetFirewallRule -DisplayName $regla -Direction Inbound -LocalPort $Puerto `
  -Protocol TCP -Action Allow -Profile Private | Out-Null
Bien "Puerto $Puerto abierto en la red privada"

# -------------------------------------------------------------- 9. Servicio

Paso "Arranque y reinicio automáticos"

<#
  Una tarea programada, no un servicio de Windows.

  Node no sabe hablar con el administrador de servicios, así que un servicio de
  verdad necesita un supervisor externo —NSSM es el clásico—. Pero NSSM hay que
  bajarlo de nssm.cc, que se cae seguido, no publica hash de sus binarios y
  desde varias redes no responde en absoluto. Un instalador que no puede
  terminar porque un sitio de terceros está caído es un instalador roto.

  El Programador de tareas ya viene con Windows: no hay nada que bajar, nada
  que verificar y nada que se pueda caer. Corre como SYSTEM al encender el PC,
  antes de que nadie inicie sesión, igual que un servicio.

  LO QUE SE PIERDE, y hay que decirlo: NSSM apaga mandando un Ctrl+C, que
  `main.ts` sabe atender para consolidar el WAL antes del corte. Acá el apagado
  es abrupto. No corrompe nada —el WAL de SQLite existe justamente para eso y
  se reproduce solo al abrir—, pero es menos prolijo.
#>
$logs = Join-Path $Destino "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

$supervisor = Join-Path $Destino "instalacion\servicio-ferrehouse.cmd"
if (-not (Test-Path $supervisor)) { Morir "Falta $supervisor. La copia del código quedó incompleta." }

Unregister-ScheduledTask -TaskName $SERVICIO -Confirm:$false -ErrorAction SilentlyContinue

$accion = New-ScheduledTaskAction -Execute $supervisor -WorkingDirectory (Join-Path $Destino "instalacion")
$disparo = New-ScheduledTaskTrigger -AtStartup
$quien = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$opciones = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $SERVICIO -Action $accion -Trigger $disparo `
  -Principal $quien -Settings $opciones -Description "Servidor de $NOMBRE." -Force | Out-Null

Start-ScheduledTask -TaskName $SERVICIO
Bien "Tarea '$SERVICIO' creada: arranca al encender y se relanza sola si se cae"

# ------------------------------------------------------ 10. Acceso directo

Paso "Acceso directo"

$icono = Join-Path $Destino "instalacion\ferrehouse.ico"
$url = "http://localhost:$Puerto"

<#
  El acceso directo abre el navegador en modo --app: sin barra de direcciones,
  sin pestañas y con su propio ícono en la barra de tareas. Para quien atiende
  el mesón es una aplicación, no "una página".

  Y NO es un capricho estético: con barra de direcciones, tarde o temprano
  alguien escribe algo ahí, se va a otra parte y llama diciendo que el sistema
  se perdió. Sin barra, no hay dónde escribir.
#>
function BuscarNavegador {
  $candidatos = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($c in $candidatos) { if (Test-Path $c) { return $c } }
  return $null
}

$navegador = BuscarNavegador
if (-not $navegador) {
  Ojo "No encontré Chrome ni Edge. El acceso directo apuntará al navegador por omisión."
}

function CrearAcceso([string]$ruta, [string]$titulo) {
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut($ruta)
  if ($navegador) {
    $lnk.TargetPath = $navegador
    # --app: ventana propia. --window-size: en 1366x768 entra completa.
    $lnk.Arguments = "--app=$url --window-size=1280,900"
  } else {
    $lnk.TargetPath = $url
  }
  $lnk.Description = $titulo
  $lnk.WorkingDirectory = $Destino
  if (Test-Path $icono) { $lnk.IconLocation = "$icono,0" }
  $lnk.Save()
}

# En el escritorio de TODOS los usuarios: quien atiende el mesón muchas veces
# no es el usuario con el que se instaló.
$escritorio = Join-Path $env:PUBLIC "Desktop\$NOMBRE.lnk"
CrearAcceso $escritorio $NOMBRE
Bien "En el escritorio: $NOMBRE"

$menu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\$NOMBRE.lnk"
CrearAcceso $menu $NOMBRE
Bien "En el menú Inicio"

# Que se abra solo al encender el PC, ya con el sistema arriba.
$inicio = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\StartUp\$NOMBRE.lnk"
CrearAcceso $inicio $NOMBRE
Bien "Y al encender el PC se abre sola"

<#
  El vigilante de la bandeja del sistema, también al iniciar sesión.

  Va en la sesión del usuario y no en el servicio porque ahí es donde hay
  bandeja: el servidor corre como SYSTEM, en la sesión 0, donde no existe el
  escritorio. Y tiene que seguir vivo justamente cuando el servidor NO está,
  así que no puede depender de él para nada más que preguntarle.
#>
$vigilanteScript = Join-Path $Destino "instalacion\vigilante.ps1"
if (Test-Path $vigilanteScript) {
  $lnkVigilante = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\StartUp\$NOMBRE - vigilante.lnk"
  $sh = New-Object -ComObject WScript.Shell
  $l = $sh.CreateShortcut($lnkVigilante)
  $l.TargetPath = "powershell.exe"
  # `-WindowStyle Hidden` y `-NoProfile`: nadie tiene que ver una consola azul
  # abrirse al encender el PC del mesón, y el perfil del usuario no tiene por
  # qué influir en un vigilante.
  $l.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$vigilanteScript`" -Puerto $Puerto"
  $l.Description = "Avisa si $NOMBRE deja de responder"
  $l.WorkingDirectory = Join-Path $Destino "instalacion"
  if (Test-Path $icono) { $l.IconLocation = "$icono,0" }
  $l.Save()
  Bien "Vigilante en la bandeja: avisa si el sistema deja de responder"

  # Y arrancarlo ahora, para no obligar a cerrar sesión para verlo.
  Start-Process "powershell.exe" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $vigilanteScript, "-Puerto", $Puerto `
    -WindowStyle Hidden -ErrorAction SilentlyContinue
} else {
  Ojo "No encontré vigilante.ps1: el aviso de caída no queda instalado."
}

# --------------------------------------------------------- 11. Comprobación

Paso "Comprobar que quedó andando"

$ok = $false
foreach ($intento in 1..20) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:$Puerto/api/health" -TimeoutSec 4
    if ($r.ok) { $ok = $true; break }
  } catch { }
}

if (-not $ok) {
  Ojo "El servidor no contestó en 40 segundos."
  Ojo "Mira $logs\error.log: el servidor dice EN PALABRAS por qué no arrancó."
  Write-Host ""
  if (Test-Path (Join-Path $logs "error.log")) { Get-Content (Join-Path $logs "error.log") -Tail 25 }
  Morir "Instalación incompleta."
}
Bien "El API contesta"

try {
  $home1 = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Puerto/" -TimeoutSec 5
  if ($home1.Content -match "Ferrehouse") { Bien "La pantalla también se sirve" }
  else { Ojo "El puerto contesta pero no devolvió la pantalla. Revisa apps\web\dist." }
} catch { Ojo "No pude comprobar la pantalla: $($_.Exception.Message)" }

# ------------------------------------------------------------------- listo

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
       Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   Listo." -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "   En este PC:      el acceso directo del escritorio"
Write-Host "   Los terminales:  http://$ip`:$Puerto"
Write-Host ""

if ($pinAdmin) {
  Write-Host "  ANOTA ESTO AHORA. No se puede volver a ver:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "      Administrador   $pinAdmin" -ForegroundColor White
  Write-Host "      Vendedor        $pinVendedor" -ForegroundColor White
  Write-Host ""
  Write-Host "  Y guarda una copia de $envPath en otra parte:" -ForegroundColor Yellow
  Write-Host "  esa clave firma las sesiones. Sin ella, en el proximo reinicio" -ForegroundColor Yellow
  Write-Host "  ningun terminal puede entrar." -ForegroundColor Yellow
  Write-Host ""
}

Write-Host "  Falta lo que el instalador no puede hacer solo:" -ForegroundColor Cyan
Write-Host "    1. La impresora de CAJA-1 (Usuarios - Cajas y terminales)."
Write-Host "       Sin eso vende, pero no imprime ni abre el cajon."
Write-Host "    2. La carpeta de respaldo externa (Panel - Configurar la copia)."
Write-Host "       Por omision el respaldo queda en ESTE MISMO PC."
Write-Host "    Los dos pasos estan en instalacion\README.md, secciones 3 y 6."
Write-Host ""
