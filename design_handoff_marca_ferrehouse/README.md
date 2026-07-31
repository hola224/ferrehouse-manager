# Handoff: marca Ferrehouse + rediseño de interfaz

## Overview

Ferrehouse Manager pasa de una interfaz genérica sin marca a la identidad de
**Ferretería House**: el rojo del logo como acento, radio cero, reglas de 2px,
y —el cambio de fondo— **dos aplicaciones con cascarones distintos** en vez de
una sola barra superior con nueve pestañas.

Tres cosas cambian:

1. **Marca.** El acento pasa del amarillo seguridad #FFC400 al rojo del logo
   #F9353F. El logo aparece en el login (protagonista), en la esquina superior
   y en el favicon.
2. **Navegación.** El POS y el backoffice dejan de compartir barra. El vendedor
   ve cuatro destinos gigantes en un riel lateral; el administrador ve una barra
   lateral oscura con la navegación agrupada.
3. **Alertas.** Dejan de ensuciar el panel: el panel muestra las tres más graves
   y hay una pantalla propia con el resto.

Todo lo demás del producto se conserva: los flujos, las reglas de negocio, los
atajos, el conteo ciego, el vendedor que no ve costos.

## Sobre los archivos de diseño

`prototipo/ferrehouse-manager.html` es una **referencia visual hecha en HTML**:
un prototipo navegable que muestra el aspecto y el comportamiento buscados. **No
es código para copiar y pegar.** El trabajo es recrear estas pantallas en el
entorno que ya tiene el repo — React 18 + Vite + Tailwind + los componentes de
`apps/web/src/components/ui.tsx` — con sus patrones y sus tokens.

Ábrelo en cualquier navegador. Funciona sin servidor y sin internet.

En el prototipo puedes:

- Elegir usuario en el login (Cristian entra al backoffice, Marcela y Iván al POS).
- Navegar el POS por el riel izquierdo y el backoffice por la barra lateral.
- Abrir el diálogo de cobro y probar los botones de billetes.
- Recorrer el cierre de caja en sus 3 pasos.

## Fidelidad

**Alta fidelidad (hifi).** Colores, tipografía, tamaños y espaciados son
finales. Recrear pixel a pixel con los componentes del repo. Donde el prototipo
y esta documentación difieran, manda esta documentación.

El presupuesto de pantalla es **1366×768**, que es el PC de la tienda. Todo lo
que sigue está medido ahí.

## Design tokens

El archivo `tokens.css` de esta carpeta es un reemplazo directo de
`apps/web/src/tokens.css`. Mantiene la convención de canales RGB (no
hexadecimal) que el repo necesita para que `bg-ink/40` funcione — la razón está
comentada en el propio archivo y no se puede cambiar.

### Colores

| Token | Hex | Canales | Uso |
|---|---|---|---|
| `--fh-bg` | `#F4F5F4` | `244 245 244` | Fondo de la aplicación |
| `--fh-surface` | `#FFFFFF` | `255 255 255` | Tarjetas, tablas, paneles |
| `--fh-ink` | `#16181A` | `22 24 26` | Texto principal **y las reglas de 2px** |
| `--fh-ink-soft` | `#6B7075` | `107 112 117` | Texto secundario, etiquetas |
| `--fh-line` | `#DEDFDE` | `222 223 222` | Borde de tarjeta y de tabla |
| `--fh-line-soft` | `#EDEEED` | `237 238 237` | Separador entre filas |
| `--fh-accent` | `#F9353F` | `249 53 63` | **Rojo del logo. Acción principal, y nada más** |
| `--fh-accent-600` | `#D5101C` | `213 16 28` | Hover y presionado del acento |
| `--fh-accent-tint` | `#FDF1F1` | `253 241 241` | Fila seleccionada, superficie de error |
| `--fh-accent-ink` | `#B3111A` | `179 17 26` | El rojo legible en texto chico (6,9:1) |
| `--fh-mono-ink` | `#8A8F94` | `138 143 148` | SKU, folios, códigos |
| `--fh-ok` | `#2F7D46` | `47 125 70` | Caja abierta, WhatsApp conectado, cuadró |
| `--fh-warn` | `#B7791F` | `183 121 31` | Stock bajo, descuadre chico |
| `--fh-error` | `#B3111A` | `179 17 26` | Anulación, quiebre, caja descuadrada |

Colores derivados que aparecen en el prototipo y salen de los de arriba:

- Texto sobre superficie `ok`: `#1F6237` — fondo `rgba(47,125,70,.08)`, borde `#2F7D46`.
- Texto sobre superficie `warn`: `#8C5C15` — fondo `rgba(183,121,31,.1)`, borde `#B7791F`.
- Texto sobre superficie de error: `#B3111A` — fondo `#FDF1F1`, borde `#F9353F`.
- Barra lateral del admin: fondo `#16181A`, texto inactivo `#C9CCCE`, iconos
  inactivos `#8B9094`, etiquetas de grupo `#75797D`, separador `#2C2F32`,
  borde de botón fantasma `#4A4E52`.
- Barra superior del POS: fondo `#16181A`, secundario `#A6ABAF`, separador `#3A3D40`.

### Las dos reglas de contraste que no se negocian

1. **Sobre rojo #F9353F el texto va SIEMPRE en blanco, nunca en tinta.** Blanco
   sobre este rojo da 3,74:1 — alcanza para texto grande y en negrita (≥19px
   bold, que es todo botón principal de este sistema) y para chrome, **no** para
   texto de párrafo. Una frase en rojo usa `--fh-accent-ink`.
2. **El rojo pleno es solo acción.** El error no se pinta de rojo pleno: se
   pinta con superficie `--fh-accent-tint`, borde y la **palabra**. Así "cobrar"
   y "algo salió mal" no se confunden aunque compartan familia. Esta es la
   trampa principal de haber movido el acento al rojo — si se rompe, el sistema
   deja de comunicar.

### Radio

`--fh-radio: 0px`. **Nada se redondea, en ninguna parte.** El logo es todo
ángulo recto y la interfaz lo sigue. La variable se mantiene solo para no tener
que editar cada componente.

### Reglas y bordes

| Uso | Valor |
|---|---|
| Regla fuerte (bajo encabezado de tabla, entre secciones, borde del riel) | `2px solid #16181A` |
| Borde de tarjeta y de tabla | `1px solid #DEDFDE` |
| Separador entre filas | `1px solid #EDEEED` |
| Borde de campo y de botón secundario | `1px solid #C9CAC9` |
| Borde de campo protagonista (escaneo, PIN, conteo) | `2px solid #16181A` |

Las reglas no se suavizan a hairline ni se reemplazan por espacio en blanco.

### Espaciado

Múltiplos de 2 sobre una base de 4. Los que se usan de verdad:

`6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · 26 · 28`

Padding de contenido del backoffice: `22px 24px`. Padding de contenido del POS:
`16px` a `20px`. Padding interno de tarjeta: `16px 18px`. Celda de tabla del
backoffice: `10px 14px`; del POS: `11px 14px`.

### Tipografía

Ya están en el repo, servidas desde `apps/web/public/fonts`. No cambian.

- **Archivo** (variable, 100–900, `font-stretch: 62%–125%`) — todo.
- **IBM Plex Mono** (400 y 600) — SKU, folios, códigos, horas, teclas de
  función, y cualquier número dentro de un campo de entrada.

Escala real usada, con su rol:

| Rol | Tamaño | Peso | Tracking | Dónde |
|---|---|---|---|---|
| Total del POS | 66px | 900 | −0.035em | Panel de cobro |
| Vuelto | 82px | 900 | −0.04em | Diálogo de cobrar |
| Conteo de caja | 76px | 900 | −0.035em | Cierre paso 2 |
| Display de login | 58px | 900 | −0.03em | Panel rojo |
| Cifra de diferencia | 52px | 900 | −0.03em | Cierre paso 3 |
| Número de KPI | 34–40px | 900 | −0.03em | Panel del admin |
| Título de pantalla POS | 28px | 900 | −0.02em | Caja, Catálogo, Devolver |
| Título de pantalla admin | 24px | 900 | −0.02em | Barra superior |
| Nombre de producto en línea de venta | 16px | 600 | — | Tabla de venta |
| Cuerpo | 14px | 400–600 | — | General |
| Celda de tabla | 13.5–14.5px | 400–600 | — | Backoffice |
| Etiqueta de sección | 10.5–11px | 800 | 0.12–0.14em, MAYÚSCULAS | Encabezados, KPIs |
| Chip de estado | 10–10.5px | 800 | 0.1em, MAYÚSCULAS | Estados |
| Mono chico | 11–12.5px | 400/600 | 0.05–0.08em | SKU, folios, horas |

`font-variant-numeric: tabular-nums` en **toda** cifra de plata o cantidad
(clase `.fh-num`, ya existe). Columnas de montos alineadas a la derecha,
siempre. Formato chileno: punto de miles, sin decimales en pesos, coma decimal
en cantidades.

### Alineación

Todo va **alineado a la izquierda**, incluidas las etiquetas dentro de botones
anchos. Un botón más ancho que su etiqueta arranca el texto en el borde
izquierdo del padding y manda la tecla de función al borde derecho con
`justify-content: space-between`. Nada se centra salvo los teclados numéricos.

## Assets

En `brand/`:

| Archivo | Qué es | Dónde va |
|---|---|---|
| `logo.svg` | Lockup completo, fondo blanco, 420×420 | Documentos, ticket impreso |
| `logo-fondo-rojo.svg` | Lockup completo sobre rojo | Material impreso |
| `isotipo-rojo.svg` | Solo la casa + FH, rojo, transparente | Favicon |
| `isotipo-blanco.svg` | Solo la casa + FH, blanco | Barra del POS, barra lateral del admin, login |
| `isotipo-negro.svg` | Solo la casa + FH, tinta | Ticket, impresos en negro |

El isotipo se derivó del logo original recortando el lockup: es la casa con el
monograma FH, sin la palabra. A tamaños de interfaz (30–40px) el lockup
completo es ilegible; el isotipo no.

Copiar a `apps/web/public/brand/`. **Favicon:** `isotipo-rojo.svg`.
**Título de pestaña:** `Ferrehouse Manager`.

Iconos: **Lucide** (`lucide-react`, ya está en el repo). Los que usa el
prototipo: `barcode`, `package`, `banknote`, `rotate-ccw`, `layout-dashboard`,
`list`, `trending-up`, `truck`, `users`, `message-circle`, `triangle-alert`,
`search`, `log-out`. Trazo 2px, `stroke-linecap="square"` — el redondeado
contradice la dirección.

---

## Navegación

Este es el cambio estructural y conviene hacerlo en su propio PR, con ADR.

**Hoy:** una sola barra superior con las pestañas Venta, Catálogo, Caja,
Devoluciones, Kardex y —si eres admin— además Compras, Panel, Reportes,
WhatsApp, Usuarios. Nueve destinos en una fila para el administrador, y para el
vendedor cinco que casi nunca usa.

**Ahora:** dos cascarones. El rol elige cuál, en `App.tsx`.

### `PosShell` — el vendedor

```
┌──────────────────────────────────────────────────────────────┐
│ ▮ FERREHOUSE │ CAJA 1 · MESÓN     [●CAJA ABIERTA] Marcela ⏱ ⇥│  56px, #16181A
├──────┬───────────────────────────────────────────────────────┤
│      │                                                       │
│ ▮    │                                                       │
│VENTA │                  contenido                            │
│      │                                                       │
│BUSCAR│                                                       │
│      │                                                       │
│ CAJA │                                                       │
│      │                                                       │
│DEVOLV│                                                       │
│      │                                                       │
│──────│                                                       │
│ADMIN │  ← solo si el usuario es administrador                │
└──────┴───────────────────────────────────────────────────────┘
 104px
```

**Barra superior**, 56px, fondo `#16181A`:

- Cuadrado de 56×56 con fondo `--fh-accent` y el isotipo blanco de 30px.
- «FERREHOUSE» 14px/900, `letter-spacing: .16em`, padding lateral 16px.
- Separador vertical 1px `#3A3D40`, 24px de alto.
- «CAJA 1 · MESÓN» en mono 11.5px, `#A6ABAF`.
- A la derecha: chip de estado de caja (borde `#2F7D46`, fondo
  `rgba(47,125,70,.18)`, cuadrito 8×8 `#4FBE74`, «CAJA ABIERTA» 11.5px/800 +
  «desde 09:02» en mono), nombre y rol del usuario en dos líneas, reloj en mono
  15px/600, y botón de salir 34×34 con borde `#3A3D40`.

**Riel izquierdo**, 104px, fondo blanco, `border-right: 2px solid #16181A`:

- Cuatro celdas de 92px de alto: **Venta** (barcode), **Buscar** (package),
  **Caja** (banknote), **Devolver** (rotate-ccw). Icono 25px arriba, etiqueta
  10.5px/800 `letter-spacing: .09em` en mayúsculas abajo, `gap: 7px`.
- Activa: fondo `--fh-accent`, icono y etiqueta blancos. Inactiva: fondo blanco,
  todo en `--fh-ink`. `border-bottom: 1px solid #EDEEED` entre celdas.
- Abajo del todo, si el usuario es admin, una celda de 64px negra que lleva al
  backoffice: icono `layout-dashboard` 18px + «ADMIN» 9.5px/800, con
  `border-top: 2px solid #16181A`.
- Cuatro destinos, no cinco: **Kardex sale del POS.** El vendedor consulta stock
  desde Buscar; el libro de movimientos es del administrador.

### `AdminShell` — el administrador

```
┌──────────┬───────────────────────────────────────────────────┐
│ ▮ FERREH.│ Jueves 30 de julio   Cuatro números... [●] ⏱      │  64px
│  MANAGER │───────────────────────────────────────────────────│  2px #16181A
├──────────┤                                                   │
│ HOY      │                                                   │
│  Panel   │                  contenido                        │
│  Alertas8│                                                   │
│ INVENTAR.│                                                   │
│  Catálogo│                                                   │
│  Kardex  │                                                   │
│  Compras │                                                   │
│ PLATA    │                                                   │
│  Reportes│                                                   │
│  Caja    │                                                   │
│ TIENDA   │                                                   │
│  Usuarios│                                                   │
│  WhatsApp│                                                   │
│──────────│                                                   │
│ Cristian │                                                   │
│ [Ir a    │                                                   │
│  vender] │                                                   │
└──────────┴───────────────────────────────────────────────────┘
   236px
```

**Barra lateral**, 236px, fondo `#16181A`:

- Cabecera de 72px con fondo `--fh-accent`: isotipo blanco 38px + «FERREHOUSE»
  14px/900 `.14em` sobre «MANAGER» 10.5px/700 `.14em` al 85% de opacidad.
- Cuatro grupos con etiqueta 9.5px/800 `letter-spacing: .16em` en mayúsculas,
  color `#75797D`, padding `0 16px 7px`:
  - **Hoy** — Panel, Alertas
  - **Inventario** — Catálogo, Kardex, Compras
  - **Plata** — Reportes, Caja y turnos
  - **Tienda** — Usuarios, WhatsApp
- Ítem: 40px de alto, `padding: 0 16px`, icono Lucide 17px + etiqueta 14px,
  `gap: 11px`. Inactivo: texto `#C9CCCE`, icono `#8B9094`, peso 500. Activo:
  fondo `--fh-accent`, texto e icono blancos, peso 800.
- **Contador de alertas** en el ítem Alertas: cuadrito mono de 19px de alto,
  mínimo 20px de ancho, fondo blanco y texto `--fh-accent-ink` cuando hay
  críticas; fondo `#3A3D40` y texto `#C9CCCE` cuando no. Es el único badge de
  toda la aplicación.
- Pie con `border-top: 1px solid #2C2F32`: nombre 13px/700, rol 10.5px en
  mayúsculas `#75797D`, y un botón fantasma de 42px con borde `#4A4E52` que
  dice «Ir a vender».

**Barra superior de contenido**, 64px, fondo blanco,
`border-bottom: 2px solid #16181A`: título de pantalla 24px/900 a la izquierda,
bajada 13px `--fh-ink-soft` al lado, y a la derecha el chip de caja y la fecha
en mono 12px.

Contenido sobre `--fh-bg` con padding `22px 24px`.

### Estaciones e Importar Excel

Siguen sin pestaña, como hoy. Se llega a Estaciones desde Usuarios («Cajas y
estaciones») y a Importar desde el toolbar del Catálogo.

---

## Componentes

Los de `apps/web/src/components/ui.tsx`, actualizados. Radio 0 en todos.

### `Boton`

| Variante | Fondo | Texto | Borde | Hover |
|---|---|---|---|---|
| `principal` | `--fh-accent` | `#FFFFFF` | ninguno | `--fh-accent-600` |
| `secundaria` | `#FFFFFF` | `--fh-ink` | `1px solid #C9CAC9` | fondo `--fh-bg` |
| `fantasma` | transparente | `--fh-ink-soft` | ninguno | texto `--fh-ink` |

- Alto mínimo 44px (dedos con guantes). El botón principal de una pantalla puede
  ser mucho más alto: 78px en el panel de cobro del POS, 64px en el diálogo de
  cobrar, 62px en el cierre de caja.
- **Etiqueta alineada a la izquierda.** Si el botón lleva tecla de función, la
  tecla va al borde derecho: `display:flex; justify-content:space-between`.
- La tecla de función dentro de un botón principal va en mono 12–13px con
  `border: 1px solid rgba(255,255,255,.5)` y `padding: 2px 7px`. Dentro de uno
  secundario, en mono 11px `--fh-ink-soft`, sin borde.
- El texto va en un `<span>`, no suelto como nodo de texto.

### `Chip` (estado)

Cuadrito de color de 7×8px + palabra en 10–11.5px/800 con
`letter-spacing: .1em` en mayúsculas, borde 1px y fondo tintado. **Color y
palabra, nunca solo color.** Sin redondeo — es un rectángulo.

| Tono | Borde | Texto | Fondo |
|---|---|---|---|
| ok | `#2F7D46` | `#1F6237` | `rgba(47,125,70,.08)` |
| warn | `#B7791F` | `#8C5C15` | `rgba(183,121,31,.1)` |
| error | `#F9353F` | `#B3111A` | `#FDF1F1` |
| neutral | `#C9CAC9` | `#6B7075` | `#F4F5F4` |

### `Campo` / `Selector`

Etiqueta 11px/800 `letter-spacing: .12em` en mayúsculas `--fh-ink-soft`, 6px de
margen inferior. Campo de 44–48px, `border: 1px solid #C9CAC9`, fondo blanco,
`padding: 0 14px`, 14–15px.

Los campos protagonistas (escaneo, PIN, conteo, efectivo) llevan
`border: 2px solid #16181A`, fondo `--fh-bg` y tipografía grande — 19px en el
escaneo, 34px en el PIN, 36px en el efectivo, 52px en el conteo.

### `Tarjeta`

Fondo blanco, `border: 1px solid #DEDFDE`, padding `16px 18px`. Si lleva
encabezado, va con `border-bottom: 2px solid #16181A` y padding `11px 18px`,
texto 12px/800 `.14em` en mayúsculas.

Las tarjetas de KPI del panel llevan además `border-top: 4px solid` en un color
que significa algo: tinta por omisión, `--fh-ok` para la caja abierta,
`--fh-accent` para las alertas.

### Tabla

- Encabezado: 10.5px/800 `letter-spacing: .11em` en mayúsculas
  `--fh-ink-soft`, padding `9px 14px`, `border-bottom: 2px solid #16181A`.
  `position: sticky; top: 0` con fondo blanco cuando la tabla scrollea.
- Fila: `border-bottom: 1px solid #EDEEED`.
- Fila seleccionada (solo en Venta): fondo `--fh-accent-tint` y
  `box-shadow: inset 4px 0 0 var(--fh-accent)` como barra izquierda.
- Montos y cantidades a la derecha, con `.fh-num`.

### `Modal`

Velo `rgba(14,15,16,.6)`. Caja de fondo blanco con `border: 2px solid #16181A`,
sin radio, sin sombra. Encabezado en barra negra `#16181A` con el título en
blanco 20px/900 a la izquierda y, cuando corresponde, la cifra a la derecha en
38px/900. Pie con `border-top: 2px solid #16181A` y fondo `--fh-bg`.

### `Acciones`

Como hoy: pegado abajo, `position: sticky`, con `border-top` y fondo de
superficie. Sin margen negativo (el comentario del repo explica por qué).

### Tecla de función suelta

En la barra de ayuda del POS: mono 11px/600, `border: 1px solid #C9CAC9`, fondo
blanco, `padding: 2px 7px`, seguida de la acción en 12.5px `--fh-ink-soft`.

---

## Pantallas

### 1. Login

Dos columnas a pantalla completa, sin barra.

**Izquierda, 560px**, fondo `--fh-accent`, texto blanco, padding `56px 52px`,
`justify-content: space-between`:

- Isotipo blanco 132×132.
- «FERRETERÍA HOUSE» 15px/800 `letter-spacing: .22em` al 85% de opacidad.
- «Ferrehouse / Manager» en dos líneas, 58px/900, `line-height: .95`,
  `letter-spacing: -.03em`.
- Regla blanca de 72×4px.
- «Punto de venta, inventario y caja. Corre en la tienda, sin internet.»
  16px, `line-height: 1.5`, ancho máximo 340px.
- Abajo, en mono 11.5px al 80%: dirección del servidor y nombre de la caja.

**Derecha**, fondo blanco, padding `56px 60px`:

- «ENTRAR AL SISTEMA» 11px/800 `.14em` `--fh-ink-soft`.
- «¿Quién eres?» 34px/900.
- Lista de usuarios: filas de 60px, `border: 2px solid`, `gap: 8px`. Sin
  elegir: borde `#E3E4E3`, fondo blanco. Elegido: borde `--fh-ink`, fondo
  `--fh-bg`. Cada fila lleva un cuadrado de 34px con la inicial (fondo
  `--fh-accent` y letra blanca si está elegido; `#EDEEED` y `#6B7075` si no),
  el nombre en 18px/700 y el rol en 11px/800 `.12em` en mayúsculas a la derecha.
- PIN: campo de 66px con `border: 2px solid #16181A`, fondo `--fh-bg`, mono
  34px/600 con `letter-spacing: .38em`. Cuando está vacío muestra `____`.
- **Teclado numérico en pantalla** (nuevo): rejilla de 3×4, teclas de 68×56px,
  `border: 1px solid #D6D7D6`, mono 20px/600, `gap: 6px`. Dígitos 1–9, `C`, `0`,
  `←`. No reemplaza el teclado físico: el foco sigue en el PIN y se puede
  teclear. Existe porque en el mesón hay tablets y hay dedos con guantes.
- Botón «Entrar» de 64px, ancho completo, con «ENTER» en mono al borde derecho.

El vendedor entra a **Venta**; el administrador, al **Panel**.

### 2. Venta (POS)

`PosShell`. Contenido en dos columnas: lista a la izquierda (flexible), panel de
total a la derecha (372px fijo).

**Columna izquierda**, padding `16px 0 0 16px`:

- **Caja de escaneo**: 64px, `border: 2px solid #16181A`, fondo blanco, icono
  `barcode` 22px, input 19px/600 con placeholder «Escanea el código, o escribe
  el nombre», y a la derecha en mono 11px `#8A8F94`: «EL FOCO VUELVE SOLO ACÁ».
  Esa leyenda no es decoración: es la promesa que hace que el vendedor no
  persiga el cursor.
- **Sugerencias** desde la tercera letra: lista absoluta pegada bajo la caja,
  `border: 2px solid #16181A` sin borde superior,
  `box-shadow: 0 18px 34px rgba(22,24,26,.18)`. Cada fila: SKU en mono 11.5px
  (78px de ancho), nombre 15px/600, stock en mono 12px (`--fh-warn` si está
  bajo), precio 15px/800 alineado a la derecha (92px). Marcada: fondo
  `--fh-bg`. Última fila: «↑↓ ELEGIR · ENTER AGREGAR · ESC CERRAR» en mono 11px
  sobre `--fh-bg`.
- **Tabla de líneas**: encabezado pegajoso. Producto (nombre 16px/600 + SKU y
  unidad en mono 11px `#8A8F94` debajo), Cantidad (130px, 17px/700), P. unit.
  (118px, 15px `--fh-ink-soft`), Total (130px, 17px/800). Fila seleccionada con
  tinte y barra roja de 4px.
- **Barra de atajos**, 42px: F2 cobrar · F4 descuento · F6 guardar espera ·
  F8 ver esperas · ↑↓ moverse · Supr quitar línea.

**Panel derecho**, 372px, fondo blanco, `border-left: 2px solid #16181A`:

- «TOTAL A PAGAR» 11px/800 `.14em`, cifra 66px/900 `letter-spacing: -.035em`,
  y debajo «4 líneas · 24,5 unidades» en 12.5px `--fh-ink-soft`.
- Desglose: Subtotal, Redondeo a $10, Neto y IVA 19% (los dos últimos en
  `--fh-ink-soft`). Se muestra siempre, no solo al cobrar.
- Botón **Cobrar** de 78px, rojo, «Cobrar» 24px/900 a la izquierda y «F2» al
  borde derecho.
- Dos botones secundarios de 48px en rejilla: Descuento (F4) y Espera (F6).
- Abajo, sobre `--fh-bg` y con `border-top`: «VENTAS EN ESPERA» y las esperas
  como filas clicables. Deja de ser un diálogo escondido tras F8: si hay una
  venta esperando, se ve.

### 3. Cobrar (diálogo sobre Venta)

980px de ancho, alto máximo 720px.

- **Encabezado negro**: «A cobrar» 20px/900 blanco, total 38px/900 a la derecha.
- **Dos columnas**: Efectivo recibido (campo de 70px con
  `border: 2px solid #16181A`, mono 36px/800) y Débito o crédito (mismo campo
  con borde de 1px y `#8A8F94` cuando está en cero, más el campo de
  comprobante).
- **Botonera de billetes** bajo el efectivo (nueva): $10.000, $20.000, $50.000,
  $100.000, cuatro botones de 44px que rellenan el campo. Es lo que el cliente
  pone sobre el mesón el 90% de las veces.
- **Vuelto**: separado por `border-top: 2px solid #16181A`, etiqueta 11px/800 y
  cifra **82px/900**. A la derecha, el efectivo a cobrar y el redondeo
  explicados en 13px. El vuelto aparece mientras se escribe, no después de
  cobrar.
- **Documento**: tres botones-radio de 46px (Boleta, Factura, Ninguno) con un
  cuadrito de 12px que se rellena de rojo al elegir; el elegido lleva
  `border: 2px solid #16181A` y fondo `--fh-bg`. Al lado, el folio en mono.
- **Cliente para el WhatsApp**: plegado, como un botón de borde punteado
  «+ Cliente para el WhatsApp». No cambia respecto de hoy.
- **Pie** sobre `--fh-bg` con `border-top: 2px solid`: «Cobrar e imprimir» en
  rojo 64px/900 con F2, «Volver» secundario, y a la derecha «Al cobrar sale el
  ticket y se abre el cajón.»

### 4. Caja (turno abierto)

- Título «Caja» 28px/900; a la derecha, en mono, «TURNO ABIERTO 09:02 · MARCELA SOTO».
- Tarjeta con encabezado de `border-bottom: 2px solid`: chip «ABIERTA», «desde
  las 09:02 · 38 ventas en el turno», y a la derecha los botones Retiro (F4),
  Ingreso (F6) y **Cerrar caja** (F2, rojo).
- Cuerpo: a la izquierda el texto que explica el conteo ciego (ancho máximo
  420px, `line-height: 1.55`); a la derecha tres cifras de 30px/900 — Fondo
  inicial, Retiros, Ingresos. **Nunca el saldo esperado**: para el vendedor el
  servidor no lo sirve.
- Libro de movimientos: Hora (mono), Movimiento, Motivo, Quién, Monto (retiros
  en `--fh-accent-ink`, ingresos en `#1F6237`).

### 5. Cierre de caja (3 pasos)

Reemplaza la pantalla de turno. Arriba, un **stepper de tres celdas iguales**
con `border-right: 1px solid #EDEEED` entre ellas: número en cuadrado de 30px
(rojo si es el paso actual, tinta si ya pasó, `#EDEEED` si falta), título
14px/800 y bajada 12px. Paso actual con fondo `--fh-accent-tint`.

1. **Cuenta.** «Cuenta toda la plata del cajón y escribe el total.» 20px/800.
   Campo de 96px con `border: 2px solid #16181A`, mono 52px/600. Teclado
   numérico de 3×4 con teclas de 84×56px. El texto explica por qué no se muestra
   el esperado. Botón «Continuar» de 62px.
2. **Confirma.** «CONTASTE» + la cifra en **76px/900**. Debajo, un bloque con
   `border-left: 4px solid var(--fh-accent)` y fondo `--fh-accent-tint`: «Este
   es el punto de no retorno.» y la explicación. Botones «Ver diferencia»
   (rojo) y «Volver a contar» (secundario).
3. **Diferencia.** Lista: Debería haber / Contaste, y luego «DIFERENCIA» sobre
   `border-top: 2px solid #16181A` con la cifra en 52px/900 en el color del
   estado. Chip con la palabra («CUADRÓ», «FALTA PLATA», «SOBRÓ PLATA»),
   explicación en 15px, campo de nota, y «Imprimir el respaldo y terminar». Al
   pie, en 12.5px: «La caja quedó cerrada y la diferencia registrada al ver este
   número.»

Si el descuadre es grave (`estado.franja` del servidor), la franja diagonal
rojo/negro de 12px va arriba del paso 3. **Una por pantalla, nunca dos.**

### 6. Devoluciones

- Campo de folio de 58px con `border: 2px solid #16181A`, ancho máximo 640px,
  mono 18px.
- Tarjeta de la venta, ancho máximo 900px: encabezado con folio y hora
  17px/800, la línea «Marcela Soto · Boleta 88214 · efectivo» en 13px, y el chip
  de estado a la derecha.
- Tabla: casilla de 20px con `border: 2px solid #16181A` (rellena de rojo si
  está marcada), producto con SKU, Vendido, A devolver, Monto. Fila marcada con
  fondo `--fh-accent-tint`.
- Pie sobre `--fh-bg` con `border-top: 2px solid`: Motivo (flexible), PIN admin
  (150px, mono) y el botón rojo con el monto en la etiqueta:
  «Devolver $12.580». El botón dice cuánto — un botón que dice «Confirmar» no
  dice nada.

### 7. Panel (admin)

- **Cuatro tarjetas** en rejilla de 4 columnas, `gap: 14px`, con
  `border-top: 4px solid`: Venta del día, Margen del día, Caja, Alertas.
  Etiqueta 10.5px/800, cifra 40px/900 (34px si pasa de 9 caracteres — el caso
  del sábado de más de un millón), nota 12.5px.
- **«Qué hay que mirar hoy»**: encabezado con `border-bottom: 2px solid #16181A`
  y, a la derecha, «Ver las 8 alertas». **Solo las 3 más graves.** Cada fila:
  etiqueta de nivel de 78px (CRÍTICA / AVISO / INFO) con borde y fondo tintados,
  mensaje 14.5px, referencia en mono, y un botón de acción de 112×34px. Las
  acciones ocupan el mismo ancho para poder barrerlas sin leerlas.
- **Últimas ventas** (1.2fr) y **Respaldo** (1fr) en dos columnas. El respaldo
  muestra «Hoy 12:00» en 34px/900, el estado de la copia externa con cuadrito de
  color y palabra, y dos botones: «Configurar la copia» (rojo, porque es la
  acción que cierra la alerta crítica) y «Respaldar ahora» (secundario).

Que las alertas se recorten a tres en el panel es una decisión, no una omisión:
el panel es de cuatro números, y una lista larga ahí lo convierte en bandeja de
entrada.

### 8. Alertas (pantalla nueva)

- Filtros: Todas / Críticas / Avisos / Info. Botones de 38px; el activo con
  fondo `--fh-ink` y texto blanco.
- Lista completa, misma fila que en el panel pero con una segunda línea en mono
  11px `#8A8F94` que dice desde cuándo está abierta. Una alerta sin fecha no
  deja saber si es de hoy o de hace tres semanas.

### 9. Catálogo (admin)

- Toolbar: buscador de 48px con `border: 2px solid #16181A` (máx. 460px),
  «Stock bajo (6)», «Sin movimiento», y a la derecha «Importar Excel» y
  «Nuevo producto» (rojo).
- Tabla: SKU (mono, 104px), Producto, Precio (110px, 15px/800), Costo neto
  (110px, `--fh-ink-soft`), Margen (100px, `--fh-accent-ink` si está bajo),
  Stock (120px), Estado (118px, chip: OK / STOCK BAJO / MARGEN BAJO).
- La fila entera lleva al kardex de ese producto.
- **Costo, margen y el filtro «Sin movimiento» no existen para el vendedor.**
  Su catálogo es la pantalla Buscar del POS, que solo trae SKU, nombre, precio,
  stock y ubicación.

### 10. Kardex

- **Cabecera del producto**: tarjeta partida. A la izquierda, SKU y código de
  barras en mono 12px, nombre 26px/900, y la línea de unidad y ubicación en
  13.5px. A la derecha, tres celdas de 150px separadas por
  `border-left: 1px solid #EDEEED`: Saldo hoy (38px/900, en `--fh-warn` si está
  bajo el mínimo, con «sacos · mín. 10» debajo), Precio y Costo prom. (30px/900).
- **Tabla**: Cuándo (mono, 150px), Movimiento (chip de tipo), Cantidad (16px/800,
  verde si es entrada), Saldo, Quién, Referencia (mono).
- Chips por tipo: Venta neutral, Compra `ok`, Merma error, Ajuste `warn`.

### 11. Reportes

- Pestañas: Ventas del día / Márgenes / Inventario valorizado. A la derecha,
  «Exportar Excel» e «Imprimir».
- Cuatro tarjetas de resumen: Total bruto, Neto, Efectivo, Ticket promedio.
  Cifra 32px/900.
- Tabla con encabezado de sección: Folio, Hora, Vendedor, Pago, Estado, Neto,
  Total.
- **Cinco estados, no dos**: COMPLETADA, CON DEVOLUCIÓN, DEVUELTA, ANULADA, y la
  fila que *es* la devolución o la anulación. La tabla canónica está en
  `STATE.md`; se deriva en el servidor.

### 12. Compras

- Toolbar: buscador (máx. 420px), «Por recibir (3)», «Nuevo proveedor»,
  «Nueva orden» (rojo).
- Tabla: Orden (mono), Proveedor, Fecha, Contenido, Estado (POR RECIBIR /
  PARCIAL / RECIBIDA), Neto, y un botón «Recibir» de 32px en la última columna.
- Al pie, en 13px `--fh-ink-soft`: «Recibir una orden escribe el movimiento de
  entrada en el kardex y recalcula el costo promedio. No se puede editar
  después: se corrige con un ajuste, que también queda registrado.»

### 13. Caja y turnos (admin)

Tabla de turnos cerrados: Día, Quién, Horario (mono), Esperado, Contado,
Diferencia (16px/800 en verde si es cero, ámbar si no) y Estado (CUADRÓ /
FALTÓ PLATA / SOBRÓ PLATA / ABIERTO).

Al pie: «El conteo es a ciegas: el vendedor nunca vio la columna "esperado"
antes de escribir la suya. Por eso la diferencia significa algo.»

### 14. Usuarios

- «Nueva persona» (rojo) y «Cajas y estaciones» (secundario).
- Rejilla de 2 columnas con una tarjeta por persona: cuadrado de 46px con la
  inicial (tinta y blanco si está activa, `#EDEEED` y `#8A8F94` si no), nombre
  17px/800, rol y último ingreso en 12.5px, estado del PIN en mono 11px. A la
  derecha, chip ACTIVA / DESACTIVADA y botón «Cambiar PIN».
- Al pie: «Una persona que se va se desactiva, no se borra: su nombre tiene que
  seguir apareciendo en las ventas y en los cierres que hizo.»

### 15. WhatsApp

- Columna izquierda de 340px: chip CONECTADO, número en 22px/900, antigüedad de
  la sesión en mono, y tres cifras — Enviados hoy, En cola (ámbar), Fallidos hoy
  (rojo). Debajo, el recordatorio de que la venta nunca se bloquea por el
  WhatsApp, y «Volver a vincular el teléfono».
- Derecha: cola de mensajes con Hora, Cliente, Teléfono, Venta y Estado (EN COLA
  / ENVIADO / FALLÓ) más el número de intento o el motivo del fallo al lado.

---

## Interacciones y comportamiento

Todo lo del brief vigente sigue igual y esta parte no lo cambia:

- **Teclado primero.** F2/F4/F6/F8 visibles en pantalla. F3, F5, F10 y F11 están
  tomadas por Chrome y no se usan.
- **El foco vuelve siempre a la caja de escaneo** después de cerrar un diálogo,
  de cambiar una cantidad y de cobrar.
- **Escanear algo que ya está suma a esa línea**, no crea una segunda.
- **`Delete` es del campo mientras el foco está en un campo de texto**, y de la
  línea de venta cuando no.
- **Sugerencias desde la tercera letra**, con 160ms de espera, y ninguna marcada
  por omisión (`sugerido = -1`): Enter vuelve a buscar en el servidor.
- **Sin animación decorativa.** Transiciones ≤150ms solo donde comunican.
  `prefers-reduced-motion` respetado.
- **Foco visible** en todo lo interactivo: `outline: var(--fh-foco)` con
  `outline-offset: 2px`. Con el acento rojo el anillo pasa a ser rojo, que es lo
  que hace el resto del sistema y contrasta mejor sobre las superficies claras
  que la tinta.

Hover nuevos que introduce esta dirección:

- Botón principal: `--fh-accent-600`.
- Botón secundario: fondo `--fh-bg`.
- Ítem del riel del POS inactivo: fondo `--fh-bg`.
- Ítem de la barra lateral del admin inactivo: fondo `#22262A`.
- Fila de tabla clicable (Catálogo, Compras): fondo `--fh-bg`.

## Estado

No hay estado nuevo respecto de lo que ya maneja la aplicación, salvo:

- `AdminShell` necesita el conteo de alertas abiertas y de críticas para el
  badge. Ya viene en `/dashboard` (`alertas.total`, `alertas.criticas`); si el
  badge tiene que estar en todas las pantallas del admin, conviene subirlo a un
  contexto o a un `useAlertas()` con refresco cada pocos minutos, no una
  consulta por pantalla.
- La pantalla de Alertas necesita el listado completo con filtro por severidad.
  Hoy `/dashboard` trae solo `primeras`. Hace falta `GET /alerts?severity=`.
- El teclado numérico del login y del cierre es estado local del componente.

## Definition of done visual

Lo mismo que pide el brief, y no cambia:

- [ ] El flujo completo funciona solo con teclado
- [ ] Legible en 1366×768 y usable en tablet
- [ ] Foco visible en todos los elementos interactivos
- [ ] Números tabulares y alineados en toda columna de montos
- [ ] Estados vacío / cargando / error diseñados, no improvisados
- [ ] Cero colores fuera de `tokens.css` (`pnpm check:tokens`)
- [ ] Ningún corner redondeado
- [ ] Ninguna etiqueta de botón centrada
- [ ] El rojo pleno aparece una sola vez por pantalla (la acción principal)
- [ ] `pnpm check:offline` pasa

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `README.md` | Este documento. Se basta solo. |
| `PROMPT-CLAUDE-CODE.md` | Lo que hay que pegarle a Claude Code, y en qué orden |
| `tokens.css` | Reemplazo directo de `apps/web/src/tokens.css` |
| `ADR-marca-y-navegacion.md` | Por qué se cambió, para `.agents/DECISIONS/` |
| `brand/` | Los cinco SVG del logo |
| `prototipo/ferrehouse-manager.html` | El prototipo navegable. Referencia visual, no código |

## Archivos del repo que hay que tocar

| Archivo | Qué le pasa |
|---|---|
| `apps/web/src/tokens.css` | Reemplazo completo |
| `apps/web/tailwind.config.js` | Nombres nuevos: `accent-600`, `accent-tint`, `accent-ink`, `line-soft` |
| `apps/web/src/tokens.test.ts` | Actualizar las aserciones del acento |
| `apps/web/index.html` | Favicon y título |
| `apps/web/public/brand/` | Nueva carpeta con los SVG |
| `apps/web/src/components/ui.tsx` | Radio 0, variantes de botón, chip rectangular, modal con barra negra |
| `apps/web/src/App.tsx` | `PosShell` y `AdminShell` en vez del `Layout` único |
| `apps/web/src/pages/*.tsx` | Las 15 pantallas, en el orden del prompt |
| `.agents/DECISIONS/` | El ADR |
| `UI-BRIEF.md` | Nota al inicio: la dirección "Mesón" amarilla queda como registro |
