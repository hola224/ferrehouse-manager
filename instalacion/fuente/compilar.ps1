<#
    Compila los tres lanzadores de doble clic.

    Esto NO lo corre quien instala la tienda: los .exe van compilados en el
    repositorio, porque quien baja el ZIP tiene que poder hacer doble clic y ya.
    Se corre acá, al cambiar `Lanzador.cs`, y se vuelven a commitear.

    NO HACE FALTA INSTALAR NADA. `csc.exe` viene con el .NET Framework, que
    viene con Windows desde hace más de una década. Cualquier alternativa
    —ps2exe, un SDK, un empaquetador— sería una dependencia más que instalar
    para producir tres archivos de doce kilobytes.
#>
$ErrorActionPreference = "Stop"

$AQUI = Split-Path -Parent $MyInvocation.MyCommand.Path
$SALIDA = Split-Path -Parent $AQUI          # los .exe van en `instalacion\`
$FUENTE = Join-Path $AQUI "Lanzador.cs"
$MANIFIESTO = Join-Path $AQUI "admin.manifest"
$ICONO = Join-Path $SALIDA "ferrehouse.ico"

$csc = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $csc) { throw "No encuentro csc.exe. Hace falta el .NET Framework 4, que viene con Windows." }
foreach ($f in @($FUENTE, $MANIFIESTO, $ICONO)) {
  if (-not (Test-Path $f)) { throw "Falta $f" }
}

Write-Host ""
Write-Host "  Compilando los lanzadores" -ForegroundColor White
Write-Host "    csc: $csc" -ForegroundColor DarkGray
Write-Host ""

<#
  El NOMBRE del ejecutable es lo que decide qué script corre —`Lanzador.cs` se
  mira a sí mismo—, así que los tres salen del mismo fuente sin una sola
  diferencia de código.
#>
foreach ($nombre in @("INSTALAR", "ACTUALIZAR", "DESINSTALAR")) {
  $exe = Join-Path $SALIDA "$nombre.exe"
  $script = Join-Path $SALIDA "$($nombre.ToLower()).ps1"
  if (-not (Test-Path $script)) { throw "No existe $script, que es lo que $nombre.exe va a buscar." }

  & $csc /nologo /target:exe /platform:anycpu /optimize+ `
    /out:"$exe" `
    /win32icon:"$ICONO" `
    /win32manifest:"$MANIFIESTO" `
    "$FUENTE"
  if ($LASTEXITCODE -ne 0) { throw "csc falló compilando $nombre" }

  $kb = [Math]::Round((Get-Item $exe).Length / 1KB, 1)
  Write-Host "    ok  $nombre.exe  ($kb KB)  ->  $(Split-Path $script -Leaf)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Listo. Acuérdate de commitear los .exe." -ForegroundColor White
Write-Host ""
