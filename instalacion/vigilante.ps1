<#
    El vigilante de la bandeja del sistema.

    Un ícono al lado del reloj que pregunta por `/api/health` cada pocos
    segundos y avisa cuando el servidor o la base dejan de contestar.

    POR QUÉ ESTO EXISTE Y NO ES PARTE DEL SERVIDOR: el servidor corre como
    SYSTEM, en la sesión 0, donde no hay escritorio ni bandeja. Un ícono al
    lado del reloj tiene que vivir en la sesión de quien atiende el mesón, y
    tiene que seguir vivo justamente cuando el servidor NO está — o sea que no
    puede depender de él para nada más que preguntarle.

    POR QUÉ POWERSHELL Y NO UNA APLICACIÓN: `NotifyIcon` viene con Windows.
    Cualquier otra cosa es un ejecutable más que instalar, firmar y actualizar
    a mano en un PC que se actualiza a mano.

    LO QUE VIGILA NO ES «SI EL PROCESO CORRE» sino si CONTESTA. Un servidor
    vivo con la base bloqueada por el antivirus, o con el disco lleno, tiene su
    proceso en la lista de tareas y no sirve para vender. `/api/health` toca la
    base, así que responder es la única prueba que vale.
#>
[CmdletBinding()]
param(
  [int] $Puerto = 3000,
  [int] $CadaSegundos = 15,
  # Cuántas fallas seguidas antes de gritar. Dos y no una: reiniciar el
  # servicio tras una actualización tarda unos segundos, y un globo cada vez
  # que eso pasa enseña a ignorar los globos.
  [int] $FallasParaAvisar = 2
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$AQUI = Split-Path -Parent $MyInvocation.MyCommand.Path
$URL = "http://127.0.0.1:$Puerto/api/health"

# --- Los dos íconos -----------------------------------------------------------
# El de marca cuando todo anda; uno rojo dibujado acá cuando no. Que el estado
# malo NO sea el logo es a propósito: se distingue de un vistazo y de reojo,
# que es como se mira la bandeja.
$icoArchivo = Join-Path $AQUI "ferrehouse.ico"
if (Test-Path $icoArchivo) {
  $iconoBien = New-Object System.Drawing.Icon($icoArchivo, 16, 16)
} else {
  $iconoBien = [System.Drawing.SystemIcons]::Application
}

function New-IconoAlerta {
  $bmp = New-Object System.Drawing.Bitmap(16, 16)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $rojo = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0xF9, 0x35, 0x3F))
  $g.FillEllipse($rojo, 1, 1, 14, 14)
  $blanco = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillRectangle($blanco, 7, 3, 2, 6)   # el palo del signo
  $g.FillRectangle($blanco, 7, 11, 2, 2)  # el punto
  $g.Dispose()
  $icono = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  return $icono
}
$iconoMal = New-IconoAlerta

# --- El ícono en la bandeja ---------------------------------------------------
$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $iconoBien
$tray.Text = "Ferrehouse Manager"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$abrir = $menu.Items.Add("Abrir Ferrehouse")
$abrir.add_Click({ Start-Process "http://localhost:$Puerto" })

$revisar = $menu.Items.Add("Revisar ahora")

$logs = $menu.Items.Add("Ver el registro de errores")
$logs.add_Click({
  $archivo = Join-Path (Split-Path -Parent $AQUI) "logs\error.log"
  if (Test-Path $archivo) { Start-Process "notepad.exe" $archivo }
  else { [System.Windows.Forms.MessageBox]::Show("Todavia no hay errores registrados.", "Ferrehouse") | Out-Null }
})

$menu.Items.Add("-") | Out-Null
$salir = $menu.Items.Add("Salir del vigilante")
$salir.add_Click({
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$tray.ContextMenuStrip = $menu

# --- El estado ----------------------------------------------------------------
$script:fallas = 0
$script:avisado = $false

function Revisar {
  $ok = $false
  $detalle = ""
  try {
    $r = Invoke-RestMethod $URL -TimeoutSec 5
    $ok = [bool]$r.ok
    if (-not $ok) { $detalle = "El servidor contesto, pero dice que no esta sano." }
  } catch {
    $detalle = $_.Exception.Message
  }

  if ($ok) {
    $script:fallas = 0
    $tray.Icon = $iconoBien
    $tray.Text = "Ferrehouse Manager - andando"
    if ($script:avisado) {
      # Avisar que VOLVIO es tan importante como avisar que se cayo: sin esto,
      # quien vio el globo rojo no tiene forma de saber cuando puede seguir
      # vendiendo, salvo probando.
      $tray.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
      $tray.BalloonTipTitle = "Ferrehouse volvio"
      $tray.BalloonTipText = "El sistema esta contestando de nuevo. Ya se puede vender."
      $tray.ShowBalloonTip(8000)
      $script:avisado = $false
    }
    return
  }

  $script:fallas++
  $tray.Icon = $iconoMal
  $tray.Text = "Ferrehouse Manager - SIN RESPUESTA"

  if ($script:fallas -ge $FallasParaAvisar -and -not $script:avisado) {
    $tray.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
    $tray.BalloonTipTitle = "Ferrehouse no responde"
    # El globo dice QUE HACER, no solo que algo pasa. Quien lo lee esta en el
    # meson con un cliente al frente, no frente a un teclado.
    $tray.BalloonTipText = "No se puede vender. Espera un minuto: se reinicia solo. Si sigue asi, apaga y enciende el PC del meson."
    $tray.ShowBalloonTip(20000)
    $script:avisado = $true
  }
}

$revisar.add_Click({ Revisar })

$reloj = New-Object System.Windows.Forms.Timer
$reloj.Interval = $CadaSegundos * 1000
$reloj.add_Tick({ Revisar })
$reloj.Start()

# Una primera revision inmediata: arrancar y quedarse quince segundos sin saber
# nada es quince segundos en que el icono miente.
Revisar

[System.Windows.Forms.Application]::Run()
$tray.Visible = $false
$tray.Dispose()
