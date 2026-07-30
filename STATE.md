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
| ORM / BD | **Prisma 6** + SQLite (modo WAL, `connection_limit=1`) |
| Frontend | React 18 + Vite, Tailwind, shadcn/ui |
| Validación | Zod end-to-end |
| Monorepo | pnpm workspaces |
| Servicio Windows | NSSM (auto-arranque + auto-restart) |

SQLite en vez de MariaDB: una sola tienda, 2-3 terminales, respaldo = copiar un archivo. Si crece a sucursales, Prisma migra a MySQL sin reescribir la capa de datos.

**Prisma 6, no 7.** Con `prisma@7` este schema no valida: la propiedad `url` ya no se admite en el bloque `datasource`. Fijar `prisma@^6` y `@prisma/client@^6` en `package.json`.

## Decisiones selladas

1. **Precios con IVA incluido. Costos netos.** El IVA de compra es crédito fiscal, no costo.
   - En pantalla y repisa: precio final. Al cobrar y en reportes: desglose neto + IVA.
   - Margen de una línea vendida: `round(brutoLinea / (1 + taxRatePercent/100)) − SaleItem.lineCostNet`, donde `brutoLinea` es `lineTotalGross` menos la parte proporcional de `Sale.discountAmount`. Ignorar el descuento de cabecera infla el margen de toda venta con descuento.
   - **El IVA se calcula como residuo**: `neto = round(bruto / 1,19)`, `iva = bruto − neto`. Nunca `neto × 0,19`, porque el redondeo por línea descuadra el total.
   - La tasa se congela en `Sale.taxRatePercent`. Si el IVA cambia algún día, los reportes del año pasado no se mueven.
2. **Dinero en `Int`,** y hay **dos categorías que no se mezclan**:
   - **Montos** (plata que cambia de manos) → pesos exactos. CLP no tiene decimales.
   - **Razones** (costo por unidad) → milésimas de peso, sufijo **`MilliPeso`**. Solo dos campos: `Product.costNetMilliPeso` y `StockMovement.balanceCostNetMilliPeso`. Motivo en [ADR-005](.agents/DECISIONS/005-unidades-y-costos.md): una caja de 1.000 tarugos a $3.500 da $3,5 por tarugo, y redondear eso a entero mete 14% de error en el margen.
3. **Cantidades en `Int` de milésimas, y el nombre del campo dice de qué:**
   - `qtyBaseMilli` → milésimas de la **unidad base** (libro de stock).
   - `qtyMilli` → milésimas de la unidad de **esa línea**, dada por su `unitId`.
   - `qtyBaseMilli = round(qtyMilli × unit.factorMilli / 1000)`, convertido una sola vez al escribir el movimiento.
4. **El stock es un libro append-only** (`StockMovement`). `StockLevel` es caché reconstruible. El libro guarda el **monto exacto** del movimiento (`totalCostNet`), no una razón: sumar razones acumula error y el job de reconciliación acusaría divergencias falsas.
5. **Ventas y movimientos de stock nunca se editan ni se borran.** Anulación y devolución = registro contrario que apunta al original.
6. **El costo se congela en `SaleItem.lineCostNet`** (costo neto exacto de la línea completa). Si no, el margen histórico cambia solo cuando sube un precio de proveedor.
7. **Una venta admite N devoluciones parciales.** `reversesId` no es único y `SaleItem.reversesSaleItemId` ata cada línea devuelta a la que revierte. **No existe** un estado "parcialmente devuelta": los reportes de plata **suman todas las filas sin filtrar por estado**, y el par original + reversa suma cero. Ver [ADR-002](.agents/DECISIONS/002-devoluciones-parciales.md).
8. **N pagos por venta** (`SalePayment`). `amount` es siempre **lo imputado a la venta**, y la suma de los pagos es exactamente `totalGross`. El efectivo físico va en `receivedAmount`/`changeAmount`. Ver [ADR-003](.agents/DECISIONS/003-vuelto-y-cuadratura.md).
9. **Redondeo de efectivo a $10**, aplicado a la **pata de efectivo** (nunca al total: la tarjeta se cobra al peso exacto), registrado en `Sale.roundingAmount`. La regla es fija —`round10(x) = signo(x) × round(|x|/10) × 10`, **simétrica** para que el par venta + anulación sume cero— y solo el múltiplo es configurable (`cash.roundTo`).
10. **Sin enums ni Json en Prisma** — SQLite no los soporta. String + validación Zod.
11. **Impresión vía tabla `PrintJob`**, con `Station.printerTarget` como destino.
12. **`Location` existe desde el día uno con una sola fila.** Las consultas de stock filtran por ubicación; la UI la oculta hasta que exista la 2ª bodega (`ui.showLocations`).
13. **`Station` también es tabla, por el mismo motivo que `Location`.** Y "una sola sesión de caja abierta por estación" lo impone la **base de datos**: `CashSession.openStationId Int? @unique` **más dos `CHECK`** que hay que agregar a mano a la migración inicial ([`.agents/MIGRACION-INICIAL.md`](.agents/MIGRACION-INICIAL.md)) — el índice único solo no basta. Ver [ADR-004](.agents/DECISIONS/004-estaciones.md).
14. **La venta en espera vive en tabla aparte** (`SuspendedSale`), sin ninguna relación con caja ni con stock. El aislamiento es estructural, no de disciplina. Ver [ADR-001](.agents/DECISIONS/001-venta-en-espera.md).
15. **WhatsApp e impresión son colas con reintentos.** Una venta jamás se bloquea porque falle una de las dos.
16. **Escrituras serializadas**: `connection_limit=1` en la URL de SQLite. Sin eso, dos ventas simultáneas del mismo producto corrompen el saldo del libro en silencio. Ver [ADR-006](.agents/DECISIONS/006-concurrencia-sqlite.md).
17. **Lo que el vendedor no puede ver no sale del servidor.** USR-03 —el vendedor no ve costos ni márgenes— es regla de negocio, no `display:none`. Los campos de costo (`Product.costNetMilliPeso`, `SaleItem.lineCostNet`, `StockMovement.totalCostNet`, `StockMovement.balanceCostNetMilliPeso` y todo `Purchase`) **se omiten al serializar** cuando el token es de rol `SELLER`. Los DTO por rol viven en `packages/shared` desde el Sprint 0: si se parchan endpoint por endpoint, basta que uno se olvide para que el costo viaje en el JSON aunque la pantalla no lo pinte. El principio 8 del brief de UI ("no existe en su DOM") es inaplicable si el dato ya cruzó la red.

## Decisiones provisionales

Marcadas aparte a propósito: **no están selladas** y se revisan cuando se cierre la pregunta abierta 1.

- **El PMP es global al producto**, no por ubicación (`Product.costNetMilliPeso`). Con una sola `Location` da igual. Es reversible sin perder historia: el libro ya guarda `locationId` y el costo de cada movimiento, así que el PMP por ubicación es recomputable cuando haga falta.
- Como consecuencia, el **inventario valorizado por ubicación** (INV-06) usa el PMP global. Con dos bodegas y compras a distinto precio, el valor por bodega sería aproximado.

## Fuera de alcance

- Emisión de DTE (la boleta la emite el POS tributario; acá solo se registra folio y tipo)
- Fiado / cuenta corriente — **confirmado que no aplica**
- UI de bodegas, traslados y reportes por ubicación — el modelo lo soporta, no se construye aún
- Ecommerce, fidelización, gift cards
- Campañas masivas de WhatsApp (riesgo de bloqueo del número)
- Bloqueo de cuenta por PIN errado. Es una LAN privada de una ferretería con 2-3 terminales; el costo (persistir intentos, sobrevivir al auto-restart de NSSM, desbloquear a alguien en pleno mesón) no se paga con el riesgo que cubre.

## Plan

**La única fuente del plan es [`SPRINTS.md`](SPRINTS.md).** Antes había acá una lista de fases que numeraba distinto que los sprints y decía cosas distintas del 2 en adelante; se eliminó para que no haya dos planes.

**Sprint 0 cerrado el 2026-07-30.** Repo, migración con sus dos `CHECK`, seed
idempotente, auth por PIN con roles, fundación visual y CI. 61 tests en verde.
Detalle en [`BITACORA.md`](BITACORA.md).

**Sprint actual: 1 — Catálogo.**

El schema vive ahora en `apps/server/prisma/schema.prisma` (lo pide Prisma por
convención). Sigue siendo la fuente de verdad del modelo.

## Diseño de interfaz

Dirección visual elegida: **"Mesón"** — industrial, fondo frío, tinta `#16181A`, acento amarillo seguridad `#FFC400`, tipografías Archivo + IBM Plex Mono **servidas desde el repo**. Todo lo visual se rige por [`UI-BRIEF.md`](UI-BRIEF.md), donde viven los tokens.

**No hay un sprint de UI**, y el propio brief explica por qué: el diseño va repartido. Una **fundación visual** —tokens, tematizado de shadcn, fuentes— que es un PR propio dentro del Sprint 0, antes de cualquier pantalla; y después **una pantalla clave por sprint**: catálogo (S1), cierre de caja (S2), venta (S3), kardex (S4), dashboard (S5). Esas cinco pasan por wireframe aprobado antes de codearse.

### Estados visibles de una venta

El brief pide "estados imposibles de confundir" y ofrece dos etiquetas —COMPLETADA / ANULADA—, pero el modelo produce **cinco**. La UI los deriva: **no son un campo**, no se guardan y no tocan la decisión sellada 7, porque los reportes de plata siguen sumando todas las filas sin filtrar por estado.

| Lo que ve el usuario | De dónde sale |
|---|---|
| **Completada** | `status = COMPLETED`, sin reversas |
| **Con devoluciones** | tiene reversas, pero no agotan las líneas |
| **Devuelta** | las devoluciones agotan todas las líneas. Anularla se rechaza: ya no queda nada vivo |
| **Anulada** | `status = REVERSED` (anulación total) |
| **Devolución** / **Anulación** | la fila **es** la reversa (`reversalKind` RETURN / VOID). Es un documento propio: aparece en el listado del día y lleva su folio de nota de crédito |

Sin esta tabla, la pantalla de venta se diseña con dos chips y el Sprint 4 obliga a rehacerla.

## Preguntas abiertas

1. **Los 2 puntos de venta futuros: ¿son 2 cajas en la misma tienda, o 2 sucursales en direcciones distintas?** Sigue siendo la pregunta más importante. 2 cajas = ya está resuelto. 2 sucursales = otro problema (2 servidores + sincronización), ahí SQLite local deja de alcanzar y el PMP pasa a ser por ubicación.
2. **¿Cuántos vendedores y cuántos turnos por día?** Define si la caja es por turno o por día, y cuántas estaciones sembrar.
3. Los productos por kg: ¿se pesan en una balanza aparte y se digita el peso? (asumido que sí para el MVP)
4. **¿Qué navegador corren los terminales, y en modo normal o kiosco?** Nadie lo anotó nunca. Define qué teclas de función se pueden capturar: F5, F3 y F11 se las queda el navegador, y F10 le abre la barra de menú. El brief promete atajos F2/F4/F6/F8/F10 impresos en pantalla, y no se pueden imprimir antes de saber cuáles sobreviven.

### Cerradas en esta ronda

- ~~Formato de SKU~~ → `FH-` + correlativo de 5 dígitos (`FH-00001`), vía tabla `Counter`. Todo producto lleva SKU interno, incluidos los que traen código de fabricante: el código del fabricante va a `ProductBarcode` como alias.
- ~~¿Precio con IVA incluido?~~ → sellada, decisión 1.
- ~~¿Bodega separada?~~ → resuelta por la decisión 12.
- ~~¿Se vende fiado?~~ → no aplica, está en Fuera de alcance.
- ~~Nombre del producto~~ → Ferrehouse Manager.

## Contexto del entorno

- Impresora térmica **USB**, conectada al PC servidor. ESC/POS crudo, no driver gráfico.
- Cajón de dinero cuelga de la impresora, se abre con `ESC p 0 25 250` en el mismo trabajo del ticket.
- El destino de impresión de cada estación vive en `Station.printerTarget`: hoy el nombre del recurso compartido de Windows; mañana `host:9100`.
- Recomendación pendiente: la segunda impresora que se compre, con puerto Ethernet.
- Lector de códigos USB = teclado HID, sin driver.
- Los terminales trabajan a **1366×768**. Es el presupuesto de layout, no una aspiración: el POS a dos columnas, con total de ≥40px y botones de ≥44px, tiene que caber ahí.
- **La tienda no tiene internet.** Fuentes, íconos y toda dependencia visual se sirven desde el repo. Un `<link>` a Google Fonts anda en el PC del desarrollador y cae al fallback en el mesón, sin avisar.

## Convenciones

- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- Código en inglés, comentarios y commits en español
- Cristian lee los commits para aprender: explicar la jerga la primera vez que aparece
- Decisiones nuevas → ADR en [`.agents/DECISIONS/`](.agents/DECISIONS/). Bitácora de avance → [`BITACORA.md`](BITACORA.md). Datos iniciales → [`.agents/SEED.md`](.agents/SEED.md). Diseño de interfaz → [`UI-BRIEF.md`](UI-BRIEF.md).
