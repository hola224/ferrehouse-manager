# Instalar Ferrehouse Manager en la tienda

> Sprint 7, tareas 7.1, 7.4 y 7.5. Léelo entero antes de empezar: hay dos
> decisiones —la carpeta de respaldo y la clave— que después cuesta cambiar.

Al terminar, el PC del mostrador queda sirviendo el sistema a los otros
terminales, arranca solo cuando se enciende, se levanta solo si se cae y se
respalda todos los días.

**Qué está probado y qué no.** El respaldo y la restauración tienen 25 pruebas
automáticas que borran la base de verdad y la recuperan. Los scripts `.bat` de
esta carpeta **no están probados**: se escribieron sin una máquina Windows a
mano. Léelos antes de correrlos —son cortos y están comentados— y ten esta
página al lado.

---

## 1. Antes de tocar nada: el PC

| # | Qué | Por qué |
|---|---|---|
| 1 | **IP fija** en el PC servidor (ej. `192.168.1.10`) | Los terminales guardan la dirección en un acceso directo. Si el router le cambia la IP un lunes, dejan de entrar y nadie sabe por qué |
| 2 | **Suspensión y hibernación desactivadas**, también con la tapa cerrada si es notebook | Un servidor suspendido es un servidor caído. Es la causa número uno de "no funciona" a las 15:00 |
| 3 | **Apagado de disco duro: nunca** | SQLite con el disco dormido da errores de escritura raros e intermitentes |
| 4 | **Actualizaciones de Windows en horario fuera de tienda** (Configuración → Windows Update → Horas activas 8:00–21:00) | Un reinicio a las 11 de la mañana cierra la caja abierta sin cerrarla |
| 5 | **Firewall: permitir el puerto 3000 en la red privada** | Sin esto el servidor anda perfecto… y ningún terminal lo alcanza |
| 6 | **UPS** en el PC servidor y en el router | Un corte de luz con la base a medio escribir es justo lo que el modo WAL protege, pero el equipo que se apaga en seco igual pierde la venta que se estaba tecleando |
| 7 | Antivirus: **excluir la carpeta del sistema** | Algunos antivirus abren el `.db` mientras SQLite escribe y lo bloquean |

Para el firewall, en PowerShell como administrador:

```powershell
New-NetFirewallRule -DisplayName "Ferrehouse Manager" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
```

---

## 2. Instalar

1. Instalar **Node 22** (el instalador `.msi` de nodejs.org, opciones por
   defecto).
2. Copiar el repositorio a `C:\Ferrehouse`.
3. Bajar **nssm** de nssm.cc y dejar `nssm.exe` en `C:\Ferrehouse\instalacion`.
   Es un solo archivo, no se instala.
4. Abrir una consola en `C:\Ferrehouse` y correr:

   ```
   pnpm install
   pnpm build
   pnpm --filter @ferrehouse/server db:migrate
   pnpm --filter @ferrehouse/server db:seed
   ```

   El seed **anota los PIN que generó**. Cópialos antes de cerrar esa ventana:
   no se pueden volver a ver, y el seed no los pisa si se corre otra vez.
5. Clic derecho en `instalacion\instalar-servicio.bat` → **Ejecutar como
   administrador**.

El script crea el `.env` con una clave nueva si no existe. **Guarda una copia de
ese archivo**: la clave firma las sesiones, y si se pierde, todos los terminales
quedan afuera en el próximo reinicio.

---

## 3. Comprobar que quedó bien

```
curl http://localhost:3000/api/health
```

Tiene que responder `{"ok":true,...}`. Si no:

| Lo que dice `logs\error.log` | Qué hacer |
|---|---|
| `DATABASE_URL debe llevar connection_limit=1` | Falta en el `.env`. Sin eso, dos ventas simultáneas corrompen el stock **en silencio** |
| `El servidor no puede arrancar: faltan settings…` | Correr `pnpm --filter @ferrehouse/server db:seed` |
| `EADDRINUSE` | Otra cosa ocupa el 3000. Cambiar `PORT` en el `.env` |
| Nada, el archivo está vacío | El servicio no llegó a arrancar: revisar la ruta de `node.exe` en NSSM |

**El servidor se niega a arrancar antes que arrancar mintiendo.** Si el seed
está incompleto o falta `connection_limit`, no levanta y dice por qué. Eso es a
propósito: un servidor que arranca con el stock mal serializado no da ningún
síntoma hasta que los números no cuadran, semanas después.

---

## 4. Los terminales (tarea 7.5)

En cada terminal, un acceso directo en el escritorio a Chrome:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://192.168.1.10:3000
```

`--app` abre sin barra de direcciones: nadie navega a otra parte sin querer y la
pantalla gana el alto de la barra, que a 1366×768 se nota.

**Cada terminal entra con su estación.** La estación se elige en la pantalla de
entrada, junto al usuario, y define dos cosas: de qué ubicación sale el stock y
a qué impresora van sus tickets. Si hay una sola, se elige sola y no aparece.

Las cajas se administran en el sistema (Panel → Usuarios no; se crean por API o
en la pantalla de estaciones cuando exista). Por ahora el seed deja `CAJA-1`
activa y `CAJA-2` inactiva, lista para el día que se abra la segunda.

---

## 5. El respaldo (tarea 7.2) — **esto es lo que hay que dejar andando**

El sistema respalda **solo, una vez al día**, a las 13:00 por defecto, y también
apenas se enciende el PC si el último respaldo tiene más de 24 horas. No hay que
acordarse de nada.

Pero por defecto el respaldo queda **en el mismo PC**, y eso protege del "borré
algo sin querer" y de nada más. **Antes de irte:**

1. Conecta un pendrive y fíjate en su letra (`E:`, `F:`…).
2. En el sistema, Panel → abajo dice `RESPALDO` → **Configurar la copia**.
3. Escribe la carpeta, por ejemplo `E:\Respaldos Ferrehouse`, y guarda.
   Se prueba escribiendo un archivo ahí mismo: si el pendrive no está, te lo
   dice en el momento.
4. Aprieta **Respaldar ahora** para dejar uno copiado de una vez.

El panel avisa solo si el último respaldo tiene más de 30 horas, o si la copia
externa quedó atrasada porque el pendrive no estaba puesto.

> **Lo mejor es una carpeta de OneDrive o Google Drive**, si algún día hay
> internet: el pendrive que vive conectado al mismo PC se pierde con el PC en un
> robo o un incendio.

Se guardan **30 días**, y siempre los **7 más nuevos** aunque estén todos
vencidos — un equipo apagado seis semanas vuelve y no se queda sin nada.

---

## 6. Restaurar (tarea 7.3)

Si se perdió el PC o la base quedó mal:

1. **Detener el servicio.** En consola de administrador: `nssm stop FerrehouseManager`
2. Si el respaldo está en el pendrive, cópialo a
   `C:\Ferrehouse\apps\server\prisma\respaldos`
3. En `C:\Ferrehouse\apps\server`:

   ```
   node dist\restaurar-cli.js --lista      ver qué hay
   node dist\restaurar-cli.js --ultimo     volver al más reciente
   ```

4. `nssm start FerrehouseManager`

El programa **se niega a correr si el servidor está arriba** —pregunta por
`/api/health` antes de tocar nada—, verifica el respaldo antes de reemplazar la
base, y la base que había **no la borra**: la deja al lado con la fecha, por si
restauraste el respaldo equivocado.

Al arrancar, el servidor vuelve a poner la base en modo WAL y corre sus
autochequeos. Si la base restaurada tuviera algo incompleto, se niega a arrancar
y lo dice.

**Lo que restaurar no deja registrado:** el programa corre fuera del servidor,
así que no queda en la bitácora de auditoría del sistema — queda en la consola y
en `logs\`. Anota a mano en un cuaderno qué día se restauró y por qué.

---

## 7. Mantención, en una línea cada una

- **Actualizar el sistema**: `nssm stop`, `git pull`, `pnpm install`, `pnpm build`,
  `db:migrate`, `nssm start`. **Respalda antes** (`instalacion\Respaldar ahora.bat`).
- **Ver qué pasó**: `logs\servidor.log` y `logs\error.log`. Los rota NSSM cada
  10 MB, no hay que limpiarlos.
- **Reiniciar**: `nssm restart FerrehouseManager`.
- **Quitar el servicio**: `desinstalar-servicio.bat`. No borra la base ni los
  respaldos.
