# Traspaso: lo que falta, y se termina desde Windows

Escrito el 2026-07-31 para el agente que sigue. Todo lo anterior se desarrolló
en Linux, y lo que queda **necesita una máquina Windows de verdad**: no por
capricho, sino porque son las cuatro cosas que no se pueden ejercitar sin el
hardware y el sistema operativo donde van a correr.

## Por dónde entrar

```bash
git clone https://github.com/hola224/ferrehouse-manager.git
cd ferrehouse-manager
pnpm install
cp .env.example apps/server/.env
pnpm setup      # migra, siembra y carga el catálogo de prueba
pnpm dev        # servidor :3000, web :5173
```

Entra en <http://localhost:5173> con **Administrador / `111111`**. El vendedor
es **`222222`**, y sirve para comprobar en pantalla lo que el servidor le
esconde.

La única señal que vale es **`pnpm check`**: corre offline, tokens, typecheck y
las 523 pruebas, en ese orden. Si está en verde, no rompiste nada de lo que hay
pruebas — que no es lo mismo que no haber roto nada, y más abajo dice dónde no
las hay.

## Lo que ya está y no hay que rehacer

| | |
|---|---|
| Punto de venta | Búsqueda, cantidades, descuentos con PIN, esperas, cobro con pago mixto |
| Caja | Apertura, movimientos, arqueo a ciegas, cierre con diferencia |
| Inventario | Catálogo, kardex, unidades y conversiones, costo promedio |
| Compras | Digitar factura recibida → entrada al kardex → recálculo de costo |
| Devoluciones | Parciales, con nota de crédito |
| Reportes y alertas | Del día, por medio de pago, stock bajo, quiebres |
| Respaldo | `VACUUM INTO`, con restauración probada (22 pruebas) |
| Marca e interfaz | Rediseño completo, doce pantallas — [ADR 007](DECISIONS/007-marca-y-navegacion.md) |

Antes de escribir una línea: **[`STATE.md`](../STATE.md)** (decisiones selladas)
y **[`CLAUDE.md`](../CLAUDE.md)** (las reglas que ninguna prueba ve). Los dos
son cortos y los dos se ganaron su lugar a golpes.

---

# 1. Nadie imprime. Es el hueco que bloquea todo lo demás

**Esto no es un problema de compatibilidad: es que la pieza no existe.**

El servidor genera el ticket en ESC/POS y lo deja en la tabla `PrintJob` como
base64, con `status = "PENDING"`. Se puede verificar en un minuto:

```sql
SELECT id, type, status, createdAt FROM PrintJob ORDER BY createdAt DESC LIMIT 5;
```

Están todos en `PENDING`, porque **ningún proceso lee esa cola**. Hoy la
aplicación no imprime nada, en ninguna impresora. Lo que falta es el consumidor.

**Dónde está lo que ya existe**

| Archivo | Qué hace |
|---|---|
| `apps/server/src/ticket.ts` | Arma el ticket de venta en ESC/POS y el pulso del cajón |
| `apps/server/src/cash-report.ts` | Lo mismo para el cierre de caja |
| `apps/server/src/routes/labels.ts` | Etiquetas de estante con código de barras |
| `apps/server/prisma/schema.prisma` → `model PrintJob` | La cola: `payload` base64, `status`, `attempts`, `lastError` |
| `Station.printerTarget` | Texto libre por caja. Hoy nadie lo interpreta: **el consumidor define qué significa** (nombre de impresora de Windows, `IP:9100`, `COM3`…) |

**Lo que hay que escribir.** Un consumidor que tome los `PENDING`, mande los
bytes a la impresora y marque `DONE` o `FAILED` con `lastError`. Dos caminos
razonables en Windows:

- **Impresión cruda a la cola de Windows** (`RAW` datatype). Es lo que permite
  usar el driver instalado sin que reinterprete los bytes. Ojo: si el trabajo
  sale por un driver que "mejora" el contenido, los ESC/POS llegan como texto
  literal y salen impresos como basura.
- **Socket directo a `IP:9100`** si la impresora va por Ethernet. Es el camino
  más simple y el que menos depende de Windows.

**Tres cosas que el consumidor no puede hacer mal**

1. **El pulso del cajón va en el MISMO trabajo que el ticket.** Está así a
   propósito y `ticket.ts` lo explica en su cabecera: el cajón cuelga de la
   impresora, y partirlo en dos trabajos significa que si la cola se atasca en
   el medio, el vendedor tiene el ticket en la mano y el cajón cerrado con el
   cliente esperando el vuelto. Un trabajo, o ninguno.
2. **Reintentar sin duplicar.** `attempts` está en el modelo. Un ticket impreso
   dos veces no es un detalle estético: es un comprobante duplicado.
3. **Fallar es normal y hay que decirlo.** La venta nunca se bloquea por la
   impresora (decisión sellada 15): la plata ya cambió de manos. Pero el
   servidor sí avisa en pantalla, y `lastError` es lo que el administrador va a
   leer — que sea una frase, no un stack.

## 1.b La impresora del cliente: Bixolon SRP-F310

Revisado contra la ficha del fabricante, no de memoria. Tres hallazgos, y solo
el segundo es de la impresora:

**✅ El juego de comandos es compatible.** La SRP-F310 hace emulación ESC/POS, y
todo lo que usa `ticket.ts` es estándar: `ESC @` (reiniciar), `ESC a`
(alineación), `ESC !` (tamaño), `GS V` (corte), `ESC p` (pulso del cajón). No
hay nada exótico que traducir.

**⚠️ El ancho está mal.** `ticket.ts` línea 24:

```ts
const ANCHO = 32; // caracteres por línea en papel de 58 mm
```

La SRP-F310 es de **3 pulgadas** (2,83" de área de impresión, 180 dpi según la
ficha, con variantes de 203). Con 32 columnas el ticket sale usando dos tercios
del papel: no se rompe, se ve mal y desperdicia rollo.

**No lo cambies a un número adivinado.** 42 y 48 son los dos valores típicos
según resolución y fuente, y cuál corresponde depende de la unidad que esté en
el mesón. Imprime una regla de caracteres (`0123456789` repetido) en la
impresora real, cuenta, y recién ahí fija el valor. Lo correcto es que sea un
ajuste por estación —al lado de `printerTarget`— y no una constante, porque una
tienda puede tener una térmica de 58 en un mesón y una de 80 en otro.

**❓ El cajón hay que probarlo.** `ESC p 0 25 250` es el pulso estándar y la
SRP-F310 tiene puerto de cajón, pero los tiempos (25/250) y el número de pin
(0 ó 1) varían entre modelos. Si el cajón no abre, eso es lo primero que se
mueve.

**Sin verificar:** el corte automático (`GS V 0` es corte total; algunas
unidades quieren `GS V 1`, parcial) y qué pasa con el logo si alguna vez se
imprime en bitmap.

---

# 2. Windows: instalador, dependencias, arranque automático

En [`instalacion/`](../instalacion/) hay cuatro `.bat` y dos guías. **Ninguno de
los `.bat` corrió jamás en un Windows real** — el propio
`instalar-servicio.bat` lo dice en su cabecera. Están razonados, no probados.

| Archivo | Qué pretende |
|---|---|
| `instalar-servicio.bat` | Servicio de Windows con NSSM, con rotación de logs |
| `desinstalar-servicio.bat` | Sacarlo |
| `Respaldar ahora.bat` | Respaldo manual para el dueño |
| `Restaurar respaldo.bat` | Restauración guiada |
| `README.md` | Servicio, red, respaldo, restauración |
| `GUIA-VENDEDOR.md` | Una página para pegar al lado del mesón |

**Lo que hay que resolver de verdad**

- **Node 22 y pnpm en el PC de la tienda.** Hoy el instalador los da por
  puestos. O se documenta como requisito previo, o el instalador los baja — y
  si los baja, deja de ser una instalación offline, que es una decisión con
  consecuencias.
- **Arranque automático.** NSSM con `SERVICE_AUTO_START` es el camino elegido.
  Falta probar que sobrevive a un reinicio, y sobre todo a un **corte de luz**,
  que en una ferretería es el caso normal, no el excepcional.
- **La base y los respaldos fuera de `Archivos de programa`.** Escribir ahí
  necesita permisos que el servicio no debería tener. `%PROGRAMDATA%` es lo
  sensato.
- **El firewall.** Los terminales entran por LAN al :3000. Hay que abrir el
  puerto en el perfil de red privada, y solo en ese.
- **`JWT_SECRET` generado en la instalación.** El `.env.example` dice
  `cambiar-en-instalacion` y nadie lo cambia todavía. Si queda el de ejemplo,
  cualquiera que lea este repositorio público puede firmar un token válido
  contra esa tienda.
- **Los PIN por defecto.** `111111` y `222222` están publicados en el README.
  El instalador debería pedirlos y escribir `SEED_ADMIN_PIN` /
  `SEED_SELLER_PIN` **antes** del primer seed.

**Y una comprobación que solo se puede hacer ahí:** en Usuarios → Cajas y
terminales hay un **probador de teclas**. Hay que correrlo en el Chrome de la
tienda, en Windows, y confirmar cuáles de F2/F4/F6/F8 llegan. Se eligieron esas
cuatro porque F3, F5, F10 y F11 se las queda el navegador, pero eso está
medido en Linux. Si alguna vuelve «no llegó» o «compartida», los atajos se
reasignan en `apps/web/src/lib/atajos.ts` — **y en ninguna otra parte**.

---

# 3. WhatsApp: falta un archivo, y está especificado

Esta es la más ordenada de las cuatro. Todo el Sprint 6 se apoya en una
interfaz y **abajo de ella falta un solo archivo**.

| Está escrito y probado | Falta |
|---|---|
| `whatsapp/cola.ts` — encolar, reintentos, backoff | `whatsapp/whatsapp-web.js.ts` — el adaptador |
| `whatsapp/entrante.ts` — respuestas y baja | |
| `whatsapp/transporte.ts` — la interfaz | |
| `routes/whatsapp.ts` + `pages/WhatsApp.tsx` — el panel con el QR | |
| Captura de cliente y consentimiento en el cobro | |

**Lee `apps/server/src/whatsapp/transporte.ts` completo antes de escribir el
adaptador.** Su cabecera es la especificación: explica por qué no está escrito
—instanciarlo abre una sesión real y manda mensajes a teléfonos reales— y
enumera lo que tiene que hacer. De ahí, las dos trampas que más cuestan:

- **Resolver el JID con `getNumberId(e164)`, no pegarle `@c.us` al número.**
  Concatenar funciona hasta que no.
- **El evento `qr` no entrega un dibujo**, entrega el payload crudo
  (`2@aBcD…`). El panel lo pinta tal cual dentro de un `<pre>`, así que lo que
  devuelva `qr()` tiene que ser **el QR ya dibujado con caracteres**. Guardar
  el payload deja al administrador mirando una línea de basura que ningún
  teléfono escanea.

Y `LocalAuth` con la carpeta de sesión **fuera del repositorio**, o el QR hay
que reescanearlo en cada reinicio del servicio.

---

# 4. Excel: falta la mitad de exportación

Lo que anda hoy, con ExcelJS:

- **Importar catálogo** — `routes/import.ts`, con plantilla, validación fila a
  fila y previsualización antes de aplicar. 21 pruebas.
- **Exportar catálogo** — `GET /api/products/export.xlsx`, solo admin.

Lo que falta:

- **Reportes exportables.** El botón «Exportar Excel» de Reportes no está
  puesto porque **falta el endpoint**, no porque falte el botón.
- **El desglose venta por venta** en Reportes (folio, hora, vendedor, medio de
  pago, estado, neto, total). Misma razón.

---

# 5. Cosas menores que quedaron anotadas

**Filtros de catálogo que no existen en el servidor.** «Stock bajo» y «Sin
movimiento» están en el traspaso de diseño y no se dibujaron: `GET /api/products`
no sabe filtrar por eso. Dibujar el filtro antes que el endpoint es dibujar un
botón que no hace nada.

**Recepción de órdenes de compra.** El traspaso de diseño describe órdenes con
estados «Por recibir / Parcial / Recibida» y un botón «Recibir». **Ese flujo no
existe en esta aplicación**: acá se digita una factura que ya llegó. Si se
quiere, es una funcionalidad nueva —modelo, endpoints y pantalla—, no un ajuste.

**El rojo pleno aparece tres veces por pantalla.** Bloque del logo, celda activa
del riel y la acción principal. `CLAUDE.md` y el
[ADR 007](DECISIONS/007-marca-y-navegacion.md) dicen «una sola vez por
pantalla», sin excepción para el cascarón. **Es una decisión pendiente del
dueño**, no un bug: o el riel activo deja de ser bloque pleno, o la regla se
reescribe diciendo que el rojo del cascarón significa «dónde estoy» y no
«aprieta acá».

---

# Dónde NO hay red de protección

Vale la pena saberlo antes de confiar en el verde.

**`apps/web` no tiene pruebas de DOM.** No hay jsdom ni testing-library: su
único test corre en Node y lee CSS. Ningún `onKeyDown`, ningún foco y ninguna
pantalla están cubiertos. **Tres defectos de la misma familia —un atajo
anunciado en pantalla que no se podía alcanzar— aparecieron mirando la
aplicación, y ninguno lo vio una prueba:**

- el diálogo de cantidad, inalcanzable sin mouse;
- F2 y F4 muertas en el cierre de caja;
- ↑↓ y Supr en Venta, que solo funcionaban después de hacer clic.

Si vas a tocar interfaz, **abre la aplicación y manéjala**. Agregar jsdom y
testing-library es una decisión de dependencias que quedó sin tomar; si la
tomas, empieza por los atajos.

**Los `.bat` no tienen ninguna prueba** y nunca corrieron. El respaldo y la
restauración que invocan sí: 22 pruebas que borran la base y la recuperan.

**El ticket ESC/POS nunca salió por una impresora.** Los bytes se generan y hay
pruebas de que se generan; que impriman bien es exactamente lo que falta
comprobar.
