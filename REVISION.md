# REVISION.md — Hallazgos de la revisión de documentación, y cómo se cerraron

> **Todo lo de este documento está resuelto en los archivos vigentes**, con una
> salvedad: los hallazgos 15 y 18 reaparecen dentro de `STATE UI.md`, una copia
> de la versión anterior que sigue en el directorio (ver `BITACORA.md`).
> Fecha de la revisión y del cierre: 2026-07-30. Se conserva como registro de qué
> se encontró y qué se decidió, no como lista de pendientes.
>
> Las decisiones vigentes están en `STATE.md`; su razonamiento completo, en
> `.agents/DECISIONS/`. El detalle cronológico, en `BITACORA.md`.

## Cómo se revisó

Lectura cruzada de los cuatro documentos, validación ejecutable del schema
(Prisma 6 → `migrate diff` → SQLite real) y un barrido mecánico: para **cada**
caso marcado MVP en `USE-CASES.md`, señalar la tabla o campo concreto que lo
sostiene. Ese último paso es el que encontró lo que importaba: la validación
verde solo prueba que el archivo parsea.

Resultado del barrido inicial: de los 38 casos MVP del catálogo, **2 no tenían
ningún soporte en el modelo** y 4 lo tenían solo en apariencia. Tras esta ronda,
un segundo barrido independiente los verificó los 38 uno por uno.

---

## Hallazgos bloqueantes

| # | Hallazgo | Resolución |
|---|---|---|
| 1 | **El schema no validaba.** `Product.stockLevel StockLevel?` declaraba una relación 1:1 contra una tabla de clave compuesta `[productId, locationId]`. Contradecía la decisión de que `Location` existe desde el día uno | `stockLevels StockLevel[]`. El schema valida y aplica limpio |
| 2 | **POS-08 "venta en espera" no existía en el modelo**, estando marcado MVP | Tablas `SuspendedSale` / `SuspendedSaleItem`, aisladas de caja y stock — [ADR-001](.agents/DECISIONS/001-venta-en-espera.md) |
| 3 | **`Sale.reversesId @unique` impedía la segunda devolución parcial**, con POS-11 marcado MVP | Relación 1:N + `reversalKind` + `SaleItem.reversesSaleItemId` — [ADR-002](.agents/DECISIONS/002-devoluciones-parciales.md) |
| 4 | **No había dónde guardar el vuelto** (POS-06): o la suma de pagos dejaba de cuadrar con el total, o se perdía el efectivo real del cajón | `receivedAmount` / `changeAmount` en `SalePayment` — [ADR-003](.agents/DECISIONS/003-vuelto-y-cuadratura.md) |
| 5 | **Con Prisma 7 el schema no arranca** (`url` ya no va en `datasource`), y el stack decía solo "Prisma" | Fijado `prisma@^6`, anotado en el stack de `STATE.md` |

### Brechas de segundo orden, aparecidas al cerrar las anteriores

| # | Hallazgo | Resolución |
|---|---|---|
| 6 | Habilitar N devoluciones exige imponer "no se devuelve más de lo vendido" **por línea**, y emparejar por `productId` es ambiguo si el mismo producto aparece dos veces en la venta con distinto precio | `SaleItem.reversesSaleItemId` |
| 7 | El costo unitario en `Int` de pesos **pierde precisión**: una caja de 1.000 tarugos a $3.500 da $3,5 por tarugo → 14% de error en el margen | Costos por unidad en milésimas de peso (`MilliPeso`); el libro guarda el **monto exacto** — [ADR-005](.agents/DECISIONS/005-unidades-y-costos.md) |
| 8 | `StockMovement.balanceBaseMilli` se calcula leyendo el saldo anterior: **dos ventas simultáneas corrompen el libro en silencio** | `connection_limit=1` — [ADR-006](.agents/DECISIONS/006-concurrencia-sqlite.md) |

---

## Riesgos de modelado

| # | Hallazgo | Resolución |
|---|---|---|
| 9 | **El PMP es global pero el stock es por ubicación**: el valorizado por bodega usaría un costo que no corresponde a ninguna | Se mantiene global, declarado **provisional** (no sellado) en `STATE.md`: depende de la pregunta abierta 1 y es reversible, porque el libro guarda `locationId` y el costo de cada movimiento |
| 10 | **`stationId` era texto libre**, con criterio opuesto al de `Location`, y "una sesión abierta por estación" no lo imponía nadie | Tabla `Station`; el invariante lo impone la BD con `openStationId @unique`, probado contra SQLite — [ADR-004](.agents/DECISIONS/004-estaciones.md) |
| 11 | `USE-CASES.md` §4 prometía una tabla puente `ProductUnit`; el schema tenía dos claves foráneas | Se mantienen las dos FK y se corrigió el documento: cada formato es un SKU propio, como ya decidía CAT-10 |
| 12 | **La convención de unidades era asimétrica** entre `PurchaseItem`, `StockMovement` y `SaleItem` — una fábrica de bugs de conversión | El nombre del campo dice el denominador: `qtyBaseMilli` vs `qtyMilli` + `unitId` |
| 13 | Invariantes que la BD no puede imponer, sin dueño declarado | Listados sprint por sprint en `SPRINTS.md`, en el sprint que los estrena. Una segunda pasada agregó los que faltaban: la transacción del saldo, la unidad de la línea de devolución, el prorrateo del costo y la fila de `StockLevel` de un producto nuevo |
| 14 | `@@index([qtyMilli])` en `StockLevel` no servía a la consulta que lo justificaba | Eliminado |

---

## Contradicciones entre documentos

| # | Hallazgo | Resolución |
|---|---|---|
| 15 | **`STATE.md` tenía 7 fases y `SPRINTS.md` 8 sprints**, que del 2 en adelante no hablaban de lo mismo. El marcador "acá estamos" quedaba ambiguo | Se eliminó la lista de fases: `SPRINTS.md` es la única fuente del plan y `STATE.md` solo apunta al sprint actual |
| 16 | **`USE-CASES.md` §5 estaba obsoleto**: 5 de 6 preguntas ya resueltas, incluida una contradicción directa — `STATE.md` daba el fiado por descartado y POS-15 seguía diciendo "confirmar si aplica" | §5 reescrita como tabla de resoluciones; POS-15 pasa a descartado |
| 17 | `SPRINTS.md` referenciaba `BITACORA.md` y `.agents/DECISIONS/`, que no existían | Creados, con seis ADR y la primera entrada de bitácora |
| 18 | Numeración duplicada en las decisiones selladas (dos ítems "9") | Renumeradas 1-16 |

---

## Detalles menores, todos cerrados

`AuditLog.userId` sin usuario para los jobs → usuario `SYSTEM` en el seed, que no
puede iniciar sesión · `AuditLog.entityId` era `Int` y no podía referenciar
`PrintJob`/`WhatsAppJob`, que usan uuid → pasa a texto · `PrintJob` sin `saleId`
para reimprimir → agregado, con `isReprint` · `Product.active` y `deletedAt` se
solapaban → semántica definida, y el SKU no se reutiliza jamás porque está
impreso en etiquetas físicas · `Customer.phone` sin normalizar → E.164 antes de
guardar · settings que los sprints daban por hecho → lista completada, incluido
el destino de impresión, que no tenía dónde vivir · el job de reconciliación no
tenía dónde registrar divergencias → `Alert` tipo `STOCK_RECONCILE_DIFF` ·
`Alert` no sabía en qué bodega faltaba el producto → `locationId` · el tope de
descuento del vendedor se podía burlar repartiéndolo entre líneas → se evalúa
sobre el total de la venta.

---

## Lo que se decidió NO hacer

Los diseños propuestos traían bastante más de lo necesario. Se descartó, aplicando
la regla del propio proyecto (*"si aparece la tentación de meterlo ya que estamos,
la respuesta es no"*):

- **Tabla `Device`** para registrar navegadores. La estación se elige al iniciar sesión.
- **`@@unique([fiscalDocType, fiscalFolio])`.** No habría funcionado —el índice
  único ignora las filas con `NULL` y el tipo de documento es opcional— y donde sí
  actuara, convertiría un error de tipeo en un estado incorregible. La cuadratura
  de folios es un **reporte** (5.4), no una restricción.
- **Desglose neto/IVA congelado por línea.** Se deriva por residuo, que es
  determinista; basta congelar la tasa en la venta.
- **Dos cantidades por línea** (`qtyUnitMilli` + `qtyBaseMilli`). Dos columnas que
  deben concordar, que la base no concilia y que se consumen por caminos distintos.
- **`Alert.dedupeKey` con upsert.** Habría borrado quién resolvió la alerta.
- **Numerar las copias de un ticket reimpreso.** La cola se purga y el contador
  reiniciaría solo, volviendo a imprimir "original".
- **Un mutex por `productId`.** Interbloqueo en la ruta más caliente del sistema.
- **Bloqueo de cuenta por PIN errado.** Es una LAN privada de una ferretería.
- Un tercio de los settings propuestos, y hacer configurable la regla de redondeo.
