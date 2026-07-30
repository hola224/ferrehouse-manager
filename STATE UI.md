# STATE.md — Ferrehouse Manager

> Traspaso a Claude Code (WSL). Leer completo antes de escribir código.
> Última actualización: 2026-07-30

## Qué es

Software de gestión para una ferretería en Concepción. Corre **en local**, sobre un PC con Windows que hace de servidor; otros 2-3 terminales acceden por navegador en la LAN.

**No es Aura.** Comparte stack con `aura-core` pero es un producto distinto: no va a xCloud, no tiene license server, no maneja datos clínicos. Las reglas selladas de Aura no aplican acá salvo donde se repiten abajo.

## Stack

| Capa | Elección |
|---|---|
| Runtime | Node 22, TypeScript estricto |
| Backend | Fastify |
| ORM / BD | Prisma + **SQLite** (modo WAL) |
| Frontend | React 18 + Vite, Tailwind, shadcn/ui |
| Validación | Zod end-to-end |
| Monorepo | pnpm workspaces |
| Servicio Windows | NSSM (auto-arranque + auto-restart) |

SQLite en vez de MariaDB: una sola tienda, 2-3 terminales, respaldo = copiar un archivo. Si crece a sucursales, Prisma migra a MySQL sin reescribir la capa de datos.

## Decisiones selladas

1. **Precios con IVA incluido. Costos netos.** Margen = `(priceGross / 1.19) − costNet`. El IVA de compra es crédito fiscal, no costo.
   - En pantalla y repisa: precio final. Al cobrar y en reportes: desglose neto + IVA.
   - **El IVA se calcula como residuo**: `neto = round(bruto / 1.19)`, `iva = bruto − neto`. Nunca `neto × 0.19`, porque el redondeo por línea descuadra el total.
2. **Dinero en `Int`** (CLP no tiene decimales). **Cantidades en `Int` de milésimas** (sufijo `Milli`). SQLite no tiene decimal real.
3. **El stock es un libro append-only** (`StockMovement`). `StockLevel` es caché reconstruible.
4. **Ventas y movimientos de stock nunca se editan ni se borran.** Anulación y devolución = registro contrario que apunta al original.
5. **El costo se congela en `SaleItem`**. Si no, el margen histórico cambia solo cuando sube un precio de proveedor.
6. **N pagos por venta** desde el día uno (`SalePayment` tabla aparte).
7. **Redondeo de efectivo a $10**, registrado como línea propia en `Sale.roundingAmount`.
8. **Sin enums ni Json en Prisma** — SQLite no los soporta. String + validación Zod.
9. **Impresión vía tabla `PrintJob` con `stationId`**, aunque hoy haya una sola impresora USB en el servidor.
9b. **`Location` existe desde el día uno con una sola fila.** Las consultas de stock filtran por ubicación; la UI la oculta hasta que exista la 2ª bodega (`ui.showLocations`). Revierte la decisión anterior de omitirla: la visión del negocio contempla 2 bodegas y 2 cajas.
10. **WhatsApp y impresión son colas con reintentos.** Una venta jamás se bloquea porque falle una de las dos.

## Fuera de alcance

- Emisión de DTE (la boleta la emite el POS tributario; acá solo se registra folio y tipo)
- Fiado / cuenta corriente — confirmado que no aplica
- UI de bodegas, traslados y reportes por ubicación — el modelo lo soporta, no se construye aún
- Ecommerce, fidelización, gift cards
- Campañas masivas de WhatsApp (riesgo de bloqueo del número)

## Fases

- **0** — Repo, schema Prisma, migración inicial, seed de unidades, auth con PIN y roles ← *acá estamos*
- **1** — Catálogo + importador Excel
- **2** — POS: lector, venta, pagos múltiples, redondeo, cierre de caja, ticket + cajón
- **3** — Kardex, compras, ajustes, mermas, costo promedio, reportes de margen
- **4** — Alertas
- **5** — WhatsApp con cola
- **6** — Respaldo automático + instalación en tienda

## Preguntas abiertas

1. **Los 2 puntos de venta futuros: ¿son 2 cajas en la misma tienda, o 2 sucursales en direcciones distintas?** Es la pregunta más importante que queda abierta. 2 cajas = ya está resuelto. 2 sucursales = otro problema (2 servidores + sincronización), y ahí SQLite local deja de alcanzar.
2. Los productos por kg: ¿se pesan en una balanza aparte y se digita el peso? (asumido que sí para el MVP)
3. ¿Cómo se numeran las etiquetas de productos sin código de barras? ¿Formato de SKU?

## Contexto del entorno

- Impresora térmica **USB**, conectada al PC servidor. ESC/POS crudo, no driver gráfico.
- Cajón de dinero cuelga de la impresora, se abre con `ESC p 0 25 250` en el mismo trabajo del ticket.
- Recomendación pendiente: la segunda impresora que se compre, con puerto Ethernet.
- Lector de códigos USB = teclado HID, sin driver.

## Diseño de interfaz

Dirección visual elegida: **"Mesón"** (industrial — blanco frío, tinta #16181A,
acento amarillo seguridad #FFC400, Archivo + IBM Plex Mono servidas en local).
Todo lo visual se rige por `UI-BRIEF.md`; los tokens viven ahí. Primera tarea
de frontend en cada sprint con pantalla nueva: wireframe antes de código.

## Convenciones

- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- Código en inglés, comentarios y commits en español
- Cristian lee los commits para aprender: explicar la jerga la primera vez que aparece
