# Instalar Ferrehouse Manager en la tienda

Al terminar, el PC del mostrador queda sirviendo el sistema a los otros
terminales, arranca solo cuando se enciende, se levanta solo si se cae, se
respalda todos los días y tiene un ícono en el escritorio que abre la
aplicación como si fuera un programa instalado.

## Lo corto

1. Copia esta carpeta `instalacion` a un pendrive (o clona el repositorio).
2. En el PC del mostrador, **doble clic en `INSTALAR.bat`** y acepta el aviso de
   administrador.
3. Espera. Baja Node si falta, baja la aplicación, compila, prepara la base,
   abre el firewall, deja el arranque automático y crea el acceso directo.
4. **Anota los dos PIN que muestra al final.** No se pueden volver a ver.
5. Haz los dos pasos que el instalador no puede hacer solo: **la impresora**
   (§3) y **la carpeta de respaldo** (§6).

Correr `INSTALAR.bat` otra vez **actualiza** la instalación: baja la versión
nueva, recompila y reinicia, sin tocar la base de datos, el `.env` ni los
respaldos. Respalda antes de empezar, por si acaso.

---

## 1. Antes de tocar nada: el PC

El instalador se encarga del firewall y de que el PC no se duerma. Lo que sigue
queda en tus manos:

| # | Qué | Por qué |
|---|---|---|
| 1 | **IP fija** en el PC servidor (ej. `192.168.1.10`) | Los terminales guardan la dirección en un acceso directo. Si el router le cambia la IP un lunes, dejan de entrar y nadie sabe por qué |
| 2 | **Actualizaciones de Windows en horario fuera de tienda** (Configuración → Windows Update → Horas activas 8:00–21:00) | Un reinicio a las 11 de la mañana cierra la caja abierta sin cerrarla |
| 3 | **UPS** en el PC servidor y en el router | Un corte de luz con la base a medio escribir es justo lo que el modo WAL protege, pero el equipo que se apaga en seco igual pierde la venta que se estaba tecleando |
| 4 | Antivirus: **excluir `C:\Ferrehouse`** | Algunos antivirus abren el `.db` mientras SQLite escribe y lo bloquean |

---

## 2. Qué hace `INSTALAR.bat`, paso por paso

| Paso | Qué | Detalle |
|---|---|---|
| 1 | **Node 22** | Si falta, lo baja de nodejs.org **verificando el SHA-256 publicado** y lo instala en silencio |
| 2 | **pnpm** | Por corepack, en la versión exacta que fija el `package.json` |
| 3 | **La aplicación** | ZIP de GitHub → `C:\Ferrehouse`. **No copia** los papeles de desarrollo (`CLAUDE.md`, `.agents/`, `BITACORA.md`, `STATE*.md`, `SPRINTS.md`, `REVISION.md`, `USE-CASES.md`, `UI-BRIEF.md`, `design_handoff/`, `.github/`) |
| 4 | **`.env`** | Clave de firma de 64 caracteres al azar y dos PIN sorteados. Si ya existe, **no lo toca** |
| 5 | **Compilar** | `pnpm install` + `pnpm build`. Verifica que quedó `apps/web/dist/index.html` |
| 6 | **Base de datos** | `prisma generate`, migraciones y seed. El seed es idempotente: no pisa nada existente |
| 7 | **Energía** | Sin suspensión, sin hibernación, sin apagado de disco, y la tapa cerrada no apaga nada |
| 8 | **Firewall** | Abre el puerto 3000 **solo en el perfil de red privada** |
| 9 | **Arranque automático** | Tarea programada como SYSTEM al encender, con supervisor que relanza a los 5 s |
| 10 | **Acceso directo** | Escritorio, menú Inicio y arranque de sesión, más el vigilante de la bandeja |
| 11 | **Comprobar** | Pregunta por `/api/health` y verifica que la pantalla se sirva |

### El vigilante de la bandeja

Queda un ícono al lado del reloj que le pregunta al sistema cada 15 segundos si
está vivo. Cuando deja de contestar dos veces seguidas, el ícono se pone rojo y
sale un aviso que dice **qué hacer**, no solo que algo pasa. Cuando vuelve,
también avisa — quien vio el aviso rojo necesita saber cuándo puede seguir
vendiendo sin tener que ir probando.

Vigila que **conteste**, no que el proceso exista: un servidor vivo con la base
bloqueada por el antivirus aparece en el administrador de tareas y no sirve para
vender. `/api/health` toca la base, así que responder es la única prueba que
vale.

Vive en la sesión del usuario y no en el servicio porque ahí es donde hay
bandeja —el servidor corre como SYSTEM, en la sesión 0, sin escritorio— y porque
tiene que seguir vivo justamente cuando el servidor no está.

**Un solo puerto.** El servidor sirve el API **y** la interfaz en el 3000. En
desarrollo la pantalla la sirve Vite en el 5173; en la tienda no hay Vite. Un
solo puerto es una sola regla de firewall y una sola dirección que recordar.

### Opciones

```
INSTALAR.bat -Puerto 3001                        otro puerto
INSTALAR.bat -Destino "D:\Ferrehouse"            otra carpeta
INSTALAR.bat -DesdeCarpeta "E:\ferrehouse"       desde pendrive, sin bajar
INSTALAR.bat -ConDemo                            40 productos de EJEMPLO
INSTALAR.bat -SinTocarEnergia                    no cambiar el plan de energía
```

`-ConDemo` **no se usa en una tienda de verdad**: esos 40 productos se mezclan
con el catálogo real y después hay que ir a buscarlos uno por uno.

### Por qué una tarea programada y no un servicio de Windows

Node no sabe hablar con el administrador de servicios, así que un servicio de
verdad necesita un supervisor externo. El candidato clásico es NSSM, y hay que
bajarlo de nssm.cc: un sitio que se cae, que no publica hash de sus binarios y
que desde varias redes simplemente no responde. Un instalador que no puede
terminar porque un sitio de terceros está caído es un instalador roto.

El Programador de tareas ya viene con Windows. Corre como SYSTEM al encender,
antes de que nadie inicie sesión, igual que un servicio, y no hay nada que bajar
ni que verificar.

**Lo que se pierde, dicho derecho:** NSSM apaga mandando un Ctrl+C, que
`main.ts` sabe atender para consolidar el WAL antes del corte. Acá el apagado es
abrupto. No corrompe nada —el WAL de SQLite existe justamente para eso y se
reproduce solo al abrir la base— pero es menos prolijo.

---

## 3. La impresora de la caja — **si no, no sale ningún ticket**

El seed deja `CAJA-1` **sin impresora**, y una caja sin impresora vende igual
pero no imprime nada ni abre el cajón. La venta se registra y la pantalla lo
avisa, pero es un aviso que se aprende a ignorar el segundo día.

**El orden importa**, y no es el que uno haría: la impresora **no se puede
cambiar con la caja abierta** —la sesión en curso ya mandó trabajos a una
impresora, y cambiarla a mitad de turno parte el reporte de cierre en dos— pero
vender y anular **sí exigen la caja abierta**. Así que: primero la impresora,
después el turno.

1. Comparte la térmica en Windows con un nombre corto y sin espacios (por
   ejemplo `TERMICA`).
2. Con la caja **cerrada** —en una instalación nueva lo está—: **Usuarios →
   Cajas y terminales → Editar CAJA-1**, y en «Impresora» escribe la ruta del
   recurso compartido, con la forma `\\NOMBRE-DEL-PC\TERMICA`.
3. Ahora sí: **Caja → Abrir**, con $0 de fondo.
4. Haz una venta de prueba de $100 en efectivo y comprueba dos cosas: que sale
   el ticket **y que se abre el cajón**. El cajón cuelga de la impresora y se
   abre con el mismo trabajo; si sale el papel pero no se abre, el problema es
   el cable del cajón, no el sistema.
5. **Devoluciones → busca esa venta por su número → Anular la venta entera.**
   La plata vuelve al cajón y el arqueo cierra en cero.
6. **Caja → Cerrar**, contando $0. Queda un arqueo de prueba en la historia,
   que es lo correcto: la venta y su anulación también quedan, y esa es la
   forma en que este sistema registra las cosas — nada se borra.

Un terminal de consulta —uno que solo mira precios y stock— se deja **sin
impresora** a propósito: es la forma de decir que no imprime.

---

## 4. Comprobar que quedó bien

```
curl http://localhost:3000/api/health
```

Tiene que responder `{"ok":true,...}`. Si no:

| Lo que dice `logs\error.log` | Qué hacer |
|---|---|
| `DATABASE_URL debe llevar connection_limit=1` | Falta en el `.env`. Sin eso, dos ventas simultáneas corrompen el stock **en silencio** |
| `JWT_SECRET todavía tiene el valor de ejemplo` | El `.env` quedó con la clave del repositorio, que es pública. Corre `INSTALAR.bat` de nuevo: la reemplaza |
| `El servidor no puede arrancar: faltan settings…` | Correr `pnpm --filter @ferrehouse/server db:seed` |
| `EADDRINUSE` | Otra cosa ocupa el 3000. Reinstalar con `INSTALAR.bat -Puerto 3001` |
| `interfaz: NO hay build en …` | Faltó compilar. Correr `pnpm build` en `C:\Ferrehouse` |
| Nada, el archivo está vacío | La tarea no llegó a arrancar: `schtasks /Query /TN FerrehouseManager /V /FO LIST` |

**El servidor se niega a arrancar antes que arrancar mintiendo.** Si el seed
está incompleto, falta `connection_limit` o la clave de firma es la pública del
repositorio, no levanta y dice por qué. Eso es a propósito: un servidor que
arranca con el stock mal serializado no da ningún síntoma hasta que los números
no cuadran, semanas después.

---

## 5. Los terminales

En cada terminal, corre **`Acceso directo en este terminal.bat`** desde el
pendrive. Pregunta la dirección del PC del mostrador, comprueba que conteste
antes de crear nada, se baja el ícono del propio servidor y deja el acceso en el
escritorio. **No instala nada y no pide administrador.**

Si prefieres hacerlo a mano, el acceso directo apunta a:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://192.168.1.10:3000
```

`--app` abre sin barra de direcciones: nadie navega a otra parte sin querer, y
la pantalla gana el alto de la barra, que a 1366×768 se nota.

**Cada terminal entra con su estación.** La estación se elige en la pantalla de
entrada, junto al usuario, y define dos cosas: de qué ubicación sale el stock y
a qué impresora van sus tickets. Si hay una sola, se elige sola y no aparece.

**Las cajas se administran en Usuarios → Cajas y terminales.** El seed deja una
sola, `CAJA-1`; la segunda se agrega ahí cuando exista. El nombre va como
`CAJA-2` —se dice en voz alta y sale impreso en el reporte de cierre— y se
normaliza solo.

---

## 6. El respaldo — **esto es lo que hay que dejar andando**

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

**Y guarda una copia de `C:\Ferrehouse\apps\server\.env` fuera de ese PC.** Esa
clave firma las sesiones: sin ella, restaurar la base en otro equipo deja a
todos los terminales afuera.

---

## 7. Restaurar

Si se perdió el PC o la base quedó mal, doble clic en
**`Restaurar respaldo.bat`**. Pide administrador, detiene el servidor, lista lo
que hay y deja una consola abierta para elegir:

```
node dist\restaurar-cli.js --ultimo            volver al más reciente
node dist\restaurar-cli.js --archivo NOMBRE    uno en particular
```

Si el respaldo está en el pendrive, cópialo antes a
`C:\Ferrehouse\apps\server\prisma\respaldos`.

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

## 8. Actualizar

Doble clic en **`ACTUALIZAR.bat`**. Respalda antes de tocar nada, baja la
versión publicada, recompila, migra y reinicia. **No toca** la base de datos, ni
el `.env`, ni los respaldos, ni la sesión de WhatsApp: solo el código.

Si al terminar el sistema no contesta, te muestra las últimas líneas del log y
los tres pasos para volver atrás con el respaldo que acaba de hacer.

> **No vuelve atrás sola, y es a propósito.** Deshacer una migración de base de
> datos automáticamente es la clase de operación que cuando falla deja las cosas
> peor que el problema que venía a arreglar. Lo que sí hace es dejar el respaldo
> hecho, nombrado y a la vista, para que volver atrás sea una decisión de una
> persona y un solo comando.

Después de actualizar, **haz una venta de prueba antes de irte**.

---

## 9. Mantención, en una línea cada una

- **Actualizar**: `ACTUALIZAR.bat` (ver arriba).
- **Ver qué pasó**: `logs\servidor.log` y `logs\error.log`. Rotan solos a los
  10 MB, al arrancar.
- **Reiniciar**: `schtasks /End /TN FerrehouseManager` y después
  `schtasks /Run /TN FerrehouseManager`.
- **Ver si está andando**: `schtasks /Query /TN FerrehouseManager`.
- **Quitarlo de este PC**: `DESINSTALAR.bat`. No borra la base, ni los
  respaldos, ni el `.env`.
